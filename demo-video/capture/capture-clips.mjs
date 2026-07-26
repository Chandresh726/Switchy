import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.resolve(currentDirectory, "../public/clips");
const baseUrl = process.env.SWITCHY_CAPTURE_URL ?? "http://localhost:3000";
const requestedClip = process.env.SWITCHY_DEMO_CLIP;

const DEMO_REPLACEMENTS = [
  ["Chandresh", "Alex"],
  ["1585 jobs", "342 jobs"],
  ["3705", "124"],
  ["2045", "48"],
  ["1437", "38"],
  ["75", "12"],
  ["95/95 companies", "24/24 companies"],
  ["95", "24"],
  ["this week", "since the latest scan"],
  ["Partial", "Complete"],
  ["Mark Applied", "Track application"],
  ["Status: Viewed", "Status: New"],
  ["viewed", "new"],
  ["Experian", "Northstar Systems"],
];

const SYNTHETIC_ANALYSIS =
  "Strong match for a backend and platform engineering role, with relevant API design, cloud infrastructure, delivery automation, and distributed-systems experience. The analysis also calls out the few areas worth validating before applying.";

const waitForPage = async (page, delay = 1100) => {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(delay);
};

const installDemoLayer = async (context) => {
  await context.addInitScript(
    ({ replacements, syntheticAnalysis }) => {
      const install = () => {
        if (!document.documentElement) {
          requestAnimationFrame(install);
          return;
        }

        if (!document.getElementById("switchy-demo-styles")) {
          const style = document.createElement("style");
          style.id = "switchy-demo-styles";
          style.textContent = `
            nextjs-portal,
            [data-next-badge-root],
            [data-sonner-toaster],
            [data-sonner-toast] {
              display: none !important;
            }

            #switchy-demo-cursor {
              position: fixed;
              left: 0;
              top: 0;
              width: 17px;
              height: 23px;
              z-index: 2147483646;
              pointer-events: none;
              opacity: 0;
              transform: translate3d(30px, 30px, 0);
              transition:
                transform 520ms cubic-bezier(.22,.72,.18,1),
                opacity 140ms ease;
              filter: drop-shadow(0 2px 2px rgba(0, 0, 0, .28));
            }

            #switchy-demo-cursor::before {
              content: "";
              position: absolute;
              inset: -8px;
              border: 2px solid rgba(16, 185, 129, .72);
              border-radius: 999px;
              opacity: 0;
              transform: scale(.25);
            }

            #switchy-demo-cursor[data-pulse="true"]::before {
              animation: switchy-demo-pulse 360ms ease-out;
            }

            @keyframes switchy-demo-pulse {
              0% { opacity: .34; transform: scale(.3); }
              100% { opacity: 0; transform: scale(1.15); }
            }

            #switchy-demo-privacy {
              position: fixed;
              inset: 0;
              z-index: 2147483647;
              background: #f7f8fa;
            }
          `;
          document.documentElement.append(style);
        }

        if (!document.getElementById("switchy-demo-privacy")) {
          const privacy = document.createElement("div");
          privacy.id = "switchy-demo-privacy";
          document.documentElement.append(privacy);
        }

        const ensureCursor = () => {
          let cursor = document.getElementById("switchy-demo-cursor");
          if (cursor) return cursor;

          cursor = document.createElement("div");
          cursor.id = "switchy-demo-cursor";
          cursor.innerHTML = `
            <svg viewBox="0 0 36 48" width="17" height="23" aria-hidden="true">
              <path d="M4 3.2v34.4l8.7-8.2 6.2 14.3 7.1-3.2-6.2-13.9H32L4 3.2Z"
                fill="#fff" stroke="#10131a" stroke-width="2.1" stroke-linejoin="round"/>
            </svg>
          `;
          document.documentElement.append(cursor);
          return cursor;
        };

        const redact = () => {
          if (!document.body) return;

          const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT
          );
          const nodes = [];

          while (walker.nextNode()) {
            nodes.push(walker.currentNode);
          }

          for (const node of nodes) {
            if (
              node.parentElement?.closest(
                "#switchy-demo-cursor, #switchy-demo-privacy"
              )
            ) {
              continue;
            }

            let value = node.nodeValue ?? "";
            for (const [search, replacement] of replacements) {
              value = value.replaceAll(search, replacement);
            }
            if (value !== node.nodeValue) {
              node.nodeValue = value;
            }
          }

          for (const paragraph of document.querySelectorAll("p")) {
            if (
              paragraph.textContent?.startsWith(
                "Strong match for cloud-native software"
              )
            ) {
              paragraph.textContent = syntheticAnalysis;
            }
          }
        };

        let redactionQueued = false;
        const observer = new MutationObserver(() => {
          if (redactionQueued) return;
          redactionQueued = true;
          requestAnimationFrame(() => {
            redactionQueued = false;
            redact();
          });
        });

        if (document.body) {
          observer.observe(document.body, {
            childList: true,
            characterData: true,
            subtree: true,
          });
          redact();
        } else {
          document.addEventListener(
            "DOMContentLoaded",
            () => {
              observer.observe(document.body, {
                childList: true,
                characterData: true,
                subtree: true,
              });
              redact();
            },
            { once: true }
          );
        }

        window.__switchyDemo = {
          moveCursor(x, y) {
            const cursor = ensureCursor();
            const previousX = Number(cursor.dataset.x ?? x);
            const previousY = Number(cursor.dataset.y ?? y);
            const distance = Math.hypot(x - previousX, y - previousY);
            const duration = Math.min(760, Math.max(360, 300 + distance * 0.34));
            cursor.style.transitionDuration = `${duration}ms, 140ms`;
            cursor.style.opacity = "1";
            cursor.style.transform = `translate3d(${x - 2}px, ${y - 1}px, 0)`;
            cursor.dataset.x = String(x);
            cursor.dataset.y = String(y);
            return duration;
          },
          pulseCursor() {
            const cursor = ensureCursor();
            cursor.dataset.pulse = "false";
            void cursor.offsetWidth;
            cursor.dataset.pulse = "true";
          },
          reveal() {
            redact();
            document.getElementById("switchy-demo-privacy")?.remove();
            ensureCursor();
          },
          redact,
        };
      };

      install();
    },
    {
      replacements: DEMO_REPLACEMENTS,
      syntheticAnalysis: SYNTHETIC_ANALYSIS,
    }
  );
};

const revealPage = async (page) => {
  await page.evaluate(() => window.__switchyDemo?.reveal());
  await page.waitForTimeout(500);
};

const moveCursor = async (page, locator, pause = 620) => {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();

  if (!box) {
    throw new Error("Could not determine the target position for the demo cursor.");
  }

  const duration = await page.evaluate(
    ({ x, y }) => window.__switchyDemo?.moveCursor(x, y),
    {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    }
  );
  await page.waitForTimeout(Math.max(pause, Number(duration ?? 0) + 100));
};

const clickWithCursor = async (page, locator) => {
  await moveCursor(page, locator);
  await page.evaluate(() => window.__switchyDemo?.pulseCursor());
  await page.waitForTimeout(180);
  await locator.click();
};

const animateScroll = async (page, targetTop, duration = 1000) => {
  await page.evaluate(
    ({ destination, animationDuration }) =>
      new Promise((resolve) => {
        const start = window.scrollY;
        const distance = destination - start;
        const startedAt = performance.now();

        const step = (now) => {
          const progress = Math.min(1, (now - startedAt) / animationDuration);
          const eased =
            progress < 0.5
              ? 4 * progress * progress * progress
              : 1 - Math.pow(-2 * progress + 2, 3) / 2;
          window.scrollTo(0, start + distance * eased);

          if (progress < 1) {
            requestAnimationFrame(step);
          } else {
            resolve();
          }
        };

        requestAnimationFrame(step);
      }),
    { destination: targetTop, animationDuration: duration }
  );
};

const smoothScrollTo = async (page, locator, offset = 120, duration = 1000) => {
  const targetTop = await locator.evaluate(
    (element, topOffset) =>
      element.getBoundingClientRect().top + window.scrollY - topOffset,
    offset
  );
  await animateScroll(page, targetTop, duration);
  await page.waitForTimeout(260);
};

const smoothScrollBy = async (page, distance, duration = 1000) => {
  const targetTop = await page.evaluate((delta) => window.scrollY + delta, distance);
  await animateScroll(page, targetTop, duration);
  await page.waitForTimeout(260);
};

const smoothScrollElementBy = async (locator, distance, duration = 1000) => {
  await locator.evaluate(
    (element, { delta, animationDuration }) =>
      new Promise((resolve) => {
        const start = element.scrollTop;
        const destination = Math.min(
          element.scrollHeight - element.clientHeight,
          Math.max(0, start + delta)
        );
        const scrollDistance = destination - start;
        const startedAt = performance.now();

        const step = (now) => {
          const progress = Math.min(1, (now - startedAt) / animationDuration);
          const eased =
            progress < 0.5
              ? 4 * progress * progress * progress
              : 1 - Math.pow(-2 * progress + 2, 3) / 2;
          element.scrollTop = start + scrollDistance * eased;

          if (progress < 1) {
            requestAnimationFrame(step);
          } else {
            resolve();
          }
        };

        requestAnimationFrame(step);
      }),
    { delta: distance, animationDuration: duration }
  );
  await locator.page().waitForTimeout(260);
};

const recordClip = async (browser, name, run) => {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    recordVideo: {
      dir: outputDirectory,
      size: { width: 1600, height: 900 },
    },
    colorScheme: "light",
    locale: "en-US",
    serviceWorkers: "block",
  });
  await installDemoLayer(context);

  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: "light" });
  const video = page.video();
  const startedAt = performance.now();
  const timeline = {};
  const mark = (name) => {
    timeline[name] = Number(((performance.now() - startedAt) / 1000).toFixed(3));
  };

  try {
    await run(page, mark);
    await page.waitForTimeout(700);
  } finally {
    await page.close();
    await context.close();
  }

  if (!video) {
    throw new Error(`Playwright did not create a video for ${name}.`);
  }

  const outputPath = path.join(outputDirectory, `${name}.webm`);
  await video.saveAs(outputPath);
  await writeFile(
    path.join(outputDirectory, `${name}.timeline.json`),
    `${JSON.stringify(timeline, null, 2)}\n`
  );
  process.stdout.write(`Recorded ${outputPath}\n`);
};

const shouldRecord = (name) => !requestedClip || requestedClip === name;

const resolveFirstJobHref = async (page) => {
  const href = await page
    .locator('a[href^="/jobs/"]')
    .first()
    .getAttribute("href");

  if (!href) {
    throw new Error("Could not resolve a job-detail link from the Jobs page.");
  }

  return href;
};

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });

try {
  if (shouldRecord("continuous")) {
    await recordClip(browser, "continuous-flow-v4", async (page, mark) => {
      await page.goto(baseUrl);
      await waitForPage(page);
      await revealPage(page);
      mark("appVisible");
      await page.waitForTimeout(700);

      const recentlyFoundHeading = page.getByRole("heading", {
        name: "Recently Found",
        exact: true,
      });
      await smoothScrollTo(page, recentlyFoundHeading, 155, 900);
      const recentlyFoundCard = recentlyFoundHeading.locator(
        "xpath=ancestor::div[contains(@class, 'rounded-xl')][1]"
      );
      const recentlyFoundList = recentlyFoundCard
        .locator("div.overflow-y-auto")
        .first();
      const firstRecentJob = recentlyFoundList
        .locator('a[href^="/jobs/"]')
        .first();
      const hoverTarget = (await firstRecentJob.count())
        ? firstRecentJob
        : recentlyFoundList;
      await moveCursor(page, hoverTarget);
      await hoverTarget.hover();
      mark("scraperLabel");
      await page.waitForTimeout(650);
      await smoothScrollElementBy(recentlyFoundList, 145, 1150);
      await page.waitForTimeout(800);

      const jobsLink = page.getByRole("link", { name: "Jobs", exact: true });
      await clickWithCursor(page, jobsLink);
      await page.waitForURL("**/jobs");
      await waitForPage(page, 850);
      await revealPage(page);

      const search = page.getByPlaceholder(
        "Search job titles, descriptions..."
      );
      await moveCursor(page, search);
      await search.click();
      await search.pressSequentially("AI engineer", { delay: 76 });
      mark("jobsSearch");
      await page.waitForTimeout(1450);

      const jobLink = page.locator('a[href^="/jobs/"]').first();
      await jobLink.waitFor({ state: "visible" });
      const jobHref = await jobLink.getAttribute("href");
      if (!jobHref) {
        throw new Error("Could not resolve the first filtered job.");
      }
      await moveCursor(page, jobLink);
      await page.waitForTimeout(480);
      await clickWithCursor(page, jobLink);
      await page.waitForURL(`**${jobHref}`);
      await waitForPage(page, 900);
      await revealPage(page);
      mark("matchLabel");

      const analysis = page.getByRole("heading", { name: "Match Analysis" });
      await smoothScrollTo(page, analysis, 135, 1050);
      await moveCursor(page, analysis);
      await page.waitForTimeout(650);

      const showDetails = page.getByRole("button", {
        name: "Show details",
        exact: true,
      });
      if (await showDetails.isVisible().catch(() => false)) {
        await clickWithCursor(page, showDetails);
        await page.waitForTimeout(620);
        await smoothScrollBy(page, 330, 1100);
        await page.waitForTimeout(850);
      }

      const coverLetter = page.getByRole("button", {
        name: "Cover Letter",
        exact: true,
      });
      await smoothScrollTo(page, coverLetter, 115, 1100);
      await moveCursor(page, coverLetter, 720);
      await page.waitForTimeout(250);
      await clickWithCursor(page, coverLetter);
      await page.waitForURL("**/cover-letter");
      await waitForPage(page, 650);

      const editable = page.locator('[aria-readonly]').first();
      await editable.waitFor({ state: "visible" });
      await page.evaluate(() => window.__switchyDemo?.redact());
      await revealPage(page);
      mark("coverLetterLabel");

      const prompt = page.getByPlaceholder(
        "Ask for changes (e.g., 'Make it shorter', 'Use a friendlier tone')."
      );
      await page.waitForFunction(
        () => {
          const editor = document.querySelector('[contenteditable="true"]');
          const textarea = document.querySelector(
            'textarea[placeholder^="Ask for changes"]'
          );
          return (
            (editor?.textContent?.trim().length ?? 0) > 120 &&
            textarea instanceof HTMLTextAreaElement &&
            !textarea.disabled
          );
        },
        undefined,
        { timeout: 90_000 }
      );
      mark("initialGenerationReady");
      await page.waitForTimeout(1900);

      await moveCursor(page, prompt);
      await prompt.click();
      await prompt.pressSequentially(
        "Make it concise and focus on backend systems and cloud infrastructure.",
        { delay: 52 }
      );
      await page.waitForTimeout(600);

      const sendButton = prompt.locator("xpath=following-sibling::button");
      await clickWithCursor(page, sendButton);
      mark("refinementSent");
      await page.waitForTimeout(850);
      mark("appCut");
    });
  }

  if (shouldRecord("scraper")) {
    await recordClip(browser, "scraper-flow-v3", async (page) => {
    await page.goto(baseUrl);
    await waitForPage(page);
    await revealPage(page);
    await page.waitForTimeout(900);

    const latestScan = page.getByRole("link", { name: /Latest Scan/i });
    await moveCursor(page, latestScan);
    await page.waitForTimeout(900);

    const jobsLink = page.getByRole("link", { name: "Jobs", exact: true });
    await clickWithCursor(page, jobsLink);
    await page.waitForURL("**/jobs");
    await waitForPage(page, 900);
    await revealPage(page);

    const search = page.getByPlaceholder(
      "Search job titles, descriptions..."
    );
    await moveCursor(page, search);
    await search.click();
    await search.pressSequentially("AI engineer", { delay: 76 });
    await page.waitForTimeout(1350);
    await smoothScrollBy(page, 430, 1150);
    await page.waitForTimeout(1250);
  });
  }

  if (shouldRecord("match")) {
    await recordClip(browser, "match-flow-v3", async (page) => {
    await page.goto(`${baseUrl}/jobs`);
    await waitForPage(page);
    await revealPage(page);
    await page.waitForTimeout(850);

    const jobLink = page.locator('a[href^="/jobs/"]').first();
    await moveCursor(page, jobLink);
    await page.waitForTimeout(650);
    const jobHref = await resolveFirstJobHref(page);
    await clickWithCursor(page, jobLink);
    await page.waitForURL(`**${jobHref}`);
    await waitForPage(page, 950);
    await revealPage(page);

    const analysis = page.getByRole("heading", { name: "Match Analysis" });
    await smoothScrollTo(page, analysis, 150);
    await moveCursor(page, analysis);
    await page.waitForTimeout(800);

    const showDetails = page.getByRole("button", {
      name: "Show details",
      exact: true,
    });
    if (await showDetails.isVisible().catch(() => false)) {
      await clickWithCursor(page, showDetails);
      await page.waitForTimeout(720);
      await smoothScrollBy(page, 390, 1180);
      await page.waitForTimeout(1100);
    }
  });
  }

  if (shouldRecord("cover-letter")) {
    await recordClip(browser, "cover-letter-flow-v3", async (page) => {
    await page.goto(`${baseUrl}/jobs`);
    await waitForPage(page);
    const jobHref = await resolveFirstJobHref(page);

    await page.goto(new URL(jobHref, baseUrl).toString());
    await waitForPage(page);
    await revealPage(page);
    await page.waitForTimeout(1100);

    const coverLetter = page.getByRole("button", {
      name: "Cover Letter",
      exact: true,
    });
    await moveCursor(page, coverLetter, 760);
    await page.waitForTimeout(340);
    await page.evaluate(() => window.__switchyDemo?.pulseCursor());
    await page.waitForTimeout(140);
    await coverLetter.click();
    await page.waitForURL("**/cover-letter");
    await waitForPage(page, 950);

    const editable = page.locator('[contenteditable="true"]').first();
    await editable.waitFor({ state: "visible" });
    const initialContent = await editable.textContent();
    await editable.evaluate((element) => {
      element.style.visibility = "hidden";
    });
    await page.evaluate(() => window.__switchyDemo?.redact());
    await revealPage(page);
    await page.waitForTimeout(650);

    const prompt = page.getByPlaceholder(
      "Ask for changes (e.g., 'Make it shorter', 'Use a friendlier tone')."
    );
    await moveCursor(page, prompt);
    await prompt.click();
    await prompt.pressSequentially(
      "Make it concise and focus on backend systems and cloud infrastructure.",
      { delay: 52 }
    );
    await page.waitForTimeout(650);

    const sendButton = prompt.locator("xpath=following-sibling::button");
    const streamResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/ai/content/stream") &&
        response.request().method() === "POST",
      { timeout: 90_000 }
    );
    await clickWithCursor(page, sendButton);
    const streamResponse = await streamResponsePromise;

    if (!streamResponse.ok()) {
      throw new Error(
        `Cover-letter generation returned HTTP ${streamResponse.status()}.`
      );
    }

    await page.waitForFunction(
      ({ selector, previous }) => {
        const element = document.querySelector(selector);
        const text = element?.textContent ?? "";
        return text.length >= 18 && text !== previous;
      },
      {
        selector: '[contenteditable="true"]',
        previous: initialContent ?? "",
      },
      { timeout: 90_000 }
    );
    await editable.evaluate((element) => {
      element.style.visibility = "visible";
    });
    await streamResponse.finished();
    await page.waitForFunction(
      () => {
        const element = document.querySelector(
          'textarea[placeholder^="Ask for changes"]'
        );
        return element instanceof HTMLTextAreaElement && !element.disabled;
      },
      undefined,
      { timeout: 90_000 }
    );
    await page.waitForTimeout(1700);
    });
  }

  if (shouldRecord("cover-letter-replay")) {
    await recordClip(browser, "cover-letter-response-v3", async (page) => {
      await page.goto(`${baseUrl}/jobs`);
      await waitForPage(page);
      const jobHref = await resolveFirstJobHref(page);

      await page.goto(new URL(`${jobHref}/cover-letter`, baseUrl).toString());
      await waitForPage(page, 900);

      const editable = page.locator('[contenteditable="true"]').first();
      await editable.waitFor({ state: "visible" });
      await page.waitForFunction(
        () => {
          const element = document.querySelector('[contenteditable="true"]');
          return (element?.textContent?.trim().length ?? 0) > 120;
        },
        undefined,
        { timeout: 60_000 }
      );

      const generatedText = await editable.innerText();
      await editable.evaluate((element) => {
        element.style.visibility = "hidden";
      });
      await page.evaluate(() => window.__switchyDemo?.redact());
      await revealPage(page);
      await page.waitForTimeout(650);

      await editable.evaluate(async (element, text) => {
        element.style.visibility = "visible";
        element.style.whiteSpace = "pre-wrap";
        element.textContent = "";

        const output = document.createElement("span");
        const caret = document.createElement("span");
        caret.textContent = "▍";
        caret.style.color = "#10b981";
        caret.style.animation = "switchy-demo-caret 700ms step-end infinite";
        element.append(output, caret);

        const style = document.createElement("style");
        style.textContent = `
          @keyframes switchy-demo-caret {
            0%, 54% { opacity: 1; }
            55%, 100% { opacity: 0; }
          }
        `;
        document.head.append(style);

        const tokens = text.match(/\S+\s*/g) ?? [];
        for (let index = 0; index < tokens.length; index += 3) {
          output.textContent += tokens.slice(index, index + 3).join("");
          await new Promise((resolve) => window.setTimeout(resolve, 58));
        }

        caret.remove();
      }, generatedText);
      await page.waitForTimeout(1450);
    });
  }
} finally {
  await browser.close();
}

process.stdout.write(
  "Recorded sanitized Switchy interactions, including the authorized streamed AI cover-letter variant.\n"
);
