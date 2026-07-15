# AI Architecture

Switchy's AI subsystem is local-first. SQLite stores all durable state, provider API keys remain encrypted on the user's machine, and local workers execute restart-sensitive matching work. The design deliberately excludes hosted infrastructure, accounts, billing, a general agent loop, and embeddings.

## Capability runtime

Every provider call belongs to one named capability:

- `job_analysis` extracts structured evidence from untrusted job text.
- `match_adjudication` performs structured semantic comparison when requirement evidence is ambiguous or potentially transferable.
- `writing_cover_letter`, `writing_referral`, and `writing_recruiter_follow_up` produce grounded drafts.
- `resume_parse` normalizes deterministically extracted resume text.

The shared runtime resolves and decrypts the configured provider once for a logical execution, applies the capability policy, disables AI SDK retries, composes cancellation and timeout signals, validates structured output, and records the result in `aiRuns`. Application retries therefore remain the only retry owner, while still honoring the AI SDK provider error's retryability signal and retry delay. A configured model that is unavailable fails explicitly; model discovery happens only in provider settings, except for the one-time initialization of installations that have no concrete default model.

`aiRuns` records provider and model identifiers, capability and subject, prompt/schema/policy versions, input fingerprint, attempts, usage, timing, finish reason, cache status, quality result, and sanitized failures. It never stores raw prompts, resumes, API keys, or full job descriptions. Resume and job inputs are marked as untrusted data in prompts so instructions embedded in source text are not followed.

## Versioned evidence and freshness

Matching uses immutable artifacts rather than mutable score columns:

```mermaid
flowchart LR
  P["Profile and matching preferences"] --> C["Candidate snapshot"]
  J["Job fields"] --> A["Job analysis"]
  C --> M["Deterministic match result"]
  A --> M
  M -->|"when requirement evidence needs reasoning"| D["Semantic requirement assessment"]
  D --> M
```

Canonical JSON is hashed with SHA-256. Candidate fingerprints include the summary, normalized skills, non-overlapping experience, education, and matching preferences. Job fingerprints include title, description, location and location type, seniority, department, employment type, and compensation text. Ordering and optional values are normalized before hashing.

A match is fresh only when its candidate fingerprint, job fingerprint, and scoring-policy version exactly match the current inputs. Status, saved, and application changes do not change these fingerprints. A profile-only change creates a candidate snapshot while reusing unchanged job analyses. Legacy job match columns are retained for data preservation and may still be presented as explicitly labeled legacy results, but the current engine never updates them or treats them as fresh evidence artifacts.

JSON text columns are accessed through repository methods that validate their contents with Zod. Corrupt or incompatible data fails at the repository boundary instead of propagating unchecked objects.

## Evidence-based scoring

Job analysis v5 extracts typed requirement atoms rather than treating every technology name as mandatory. Each atom records its type, exact source evidence, terms and alternatives, importance (`critical`, `important`, `preferred`, or `contextual`), explicitness, scoped experience, and confidence. Source excerpts are normalized and checked against the supplied job before an atom can be persisted. Technology names that merely describe the employer's stack are contextual and do not lower the match. Changed jobs remain cached and batched by both job count and prompt characters. A failed extraction produces conservative, low-confidence evidence under a separate fallback extractor version, so a later provider recovery retries structured extraction instead of treating fallback evidence as permanent.

Candidate evidence includes explicit skills plus bounded references to the summary, role descriptions, highlights, and education. Evidence items are bounded before concatenation, and the complete semantic prompt has a hard serialized-size budget. Deterministic comparison recognizes exact evidence and conservative technology families. When more reasoning is needed, the model returns one evidence-cited assessment per requirement: direct, equivalent, transferable, partial, missing, unknown, or not applicable. Scoped experience and management assessments feed the calibrated components instead of being reduced to total years or a binary title heuristic. Low-confidence semantic labels remain unresolved or are weighted toward the neutral prior; they cannot receive full status credit. The model does not invent the final score.

The calibrated role-fit score uses these base component weights:

| Component | Weight |
| --- | ---: |
| Requirement fit | 50 |
| Relevant experience | 35 |
| Seniority and management | 15 |

Requirements are weighted by importance rather than counted equally. Unknown evidence lowers coverage instead of becoming a failure. The score is shrunk toward a neutral prior when the job exposes fewer score-bearing components, so one known component cannot become a misleading `100`; evidence coverage instead reports how much of the available job evidence could be resolved. An experience difference of six months or less receives full credit; larger gaps use a gradual curve without arbitrary hard caps. Significant experience gaps and multi-level seniority differences also apply gradual whole-role calibration so strong keyword overlap cannot misleadingly produce a top-band result. Scoped duration claims require dated experience entries that both cover the requested duration and support the requested scope. Location, authorization, license, and employment constraints are presented separately so a strong role fit can still explain why a job is unavailable or outside the user's preferences.

Scores are ordinal compatibility values, not probabilities. The primary interpretation is High, Good, Possible, Stretch, Low, or More evidence needed. The UI separately reports score confidence, extraction confidence, evidence coverage, and the type and importance of each requirement. Dashboard and company promotion views query the authoritative semantic High/Good bands on the server rather than scanning numeric thresholds in the browser; blocking eligibility constraints remain visible on promoted roles.

Economy requests semantic comparison only for unresolved critical requirements. Balanced reviews unresolved critical and important requirements, including possible transferable matches. Quality reviews all meaningful requirements. These rules are based on evidence state rather than an arbitrary numeric score window.

The committed synthetic corpus covers score bands, six-month experience tolerance, contextual stack mentions, transferable technologies, missing information, separated constraints, and pairwise rankings without personal data. A scoring-policy cutover requires deterministic checks and at least 85 percent pairwise ranking accuracy.

## Durable matching queue

Manual, company, unmatched, and post-scrape matching all create a match session and `aiWorkItems` transactionally. API callers receive `202` and poll the common session endpoint; cancellation is a durable request rather than a process-local flag. When an entry point has zero jobs, it records an immediately completed, pollable session without creating an empty work item.

Workers claim leased items, heartbeat while running, renew ownership, checkpoint progress, schedule retries, and fence data operations. Expired leases are recoverable after restart. Startup conversion imports nonterminal legacy scrape-match outbox work idempotently while leaving completed legacy rows as history. The legacy unmatched-session response delegates to the current session implementation during compatibility migration.

An in-memory limiter is shared per provider process. Rate-limit responses reduce concurrency by one and honor provider retry delay when supplied. Twenty consecutive successes increase concurrency by one, never above the configured per-provider concurrency limit. This adaptive state does not mutate user settings.

## Writing

Writing uses one evidence packet containing the candidate snapshot, job analysis, match evidence, allowed links, and content-specific settings. Modification requests include the selected parent draft, and persisted variants retain their ancestry and associated AI run.

Streaming emits text deltas, followed by a complete event containing the atomically persisted content response and run ID. Aborted or invalid streams produce failed runs and no content variant. The compatibility synchronous endpoint calls the same service. Selected, copied, discarded, and manual-edit signals remain local; edit distance is computed server-side. Historical drafts are not sent with unrelated requests.

## Resume parsing

File handling and AI normalization are separate stages. PDF, DOCX, and text extractors produce plain untrusted text; the capability runtime then normalizes it using versioned prompts and schemas. Validation reports malformed dates, missing required values, duplicate skills, and suspicious URLs. The resume stores the parse run and parser version, while profile replacement remains an explicit user action.

## Observability and privacy

The AI history screen summarizes calls, success rate, tokens, latency, full match-result cache reuse, and sanitized failures over 7 or 30 days. Job-analysis reuse remains implicit in immutable artifact lookup rather than being counted as a provider call or full-result hit. Writing variants and match results link to safe run summaries. Switchy does not estimate currency because direct-provider pricing is not reliably available.

Sensitive source data stays in purpose-specific local tables and is sent only for the requested capability. Logs, API failures, match history, and run records use fingerprints, safe subjects, bounded metadata, and sanitized error codes/messages. Raw AI SDK provider errors are sanitized before crossing those boundaries because they may contain request values or response bodies. Never add raw provider payloads, prompts, keys, resumes, or full job descriptions to telemetry.

## Evaluation and version maintenance

Run deterministic AI evaluations with:

```bash
pnpm ai:eval
```

The suite covers matcher scoring and ranking, writing validators, and resume normalization. Live-provider evaluation is opt-in and remains outside `pnpm verify`.

When changing a prompt, schema, scoring rule, or execution behavior:

1. Increment the corresponding prompt, schema, semantic-assessment, scoring-policy, extractor, parser, or execution-policy version.
2. Add or update synthetic fixtures that demonstrate the intended behavior and failure cases.
3. Run `pnpm ai:eval` and the focused unit/integration tests.
4. Confirm existing fingerprints remain stable unless their canonical inputs intentionally changed.
5. Document any compatibility or artifact-freshness consequence.

Database migrations must be produced with `pnpm db:generate`; do not hand-write SQL. Migration tests set a temporary `HOME` and exercise both a fresh database and an upgrade fixture. Never point migration tests at the user's real `~/.switchy` state.
