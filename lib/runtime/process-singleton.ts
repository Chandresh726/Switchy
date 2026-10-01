type SingletonStore = Map<string, unknown>;

const globalSingletons = globalThis as typeof globalThis & {
  __switchyProcessSingletons?: SingletonStore;
};

// Next.js compiles instrumentation and route handlers into separate module
// graphs, so module-level state is instantiated once per graph. In-process
// gates, runners, and dispatchers must be shared through globalThis instead.
// Vitest re-imports modules between tests, so it keeps module scope there.
const singletons: SingletonStore = process.env.VITEST
  ? new Map()
  : (globalSingletons.__switchyProcessSingletons ??= new Map());

export function processSingleton<T>(key: string, create: () => T): T {
  if (!singletons.has(key)) singletons.set(key, create());
  return singletons.get(key) as T;
}
