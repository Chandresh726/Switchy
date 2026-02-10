import fs from "fs";
import path from "path";
import { execSync } from "child_process";

interface GeminiCredentials {
  clientId: string;
  clientSecret: string;
}

export async function getGeminiCliCredentials(): Promise<GeminiCredentials | null> {
  console.log("[GeminiCLI] Starting credential detection...");
  try {
    // Strategy 1: Resolve 'gemini' executable path (Works for Homebrew & others)
    try {
      const geminiBinPath = execSync("which gemini", { encoding: "utf8" }).trim();
      console.log("[GeminiCLI] 'which gemini' returned:", geminiBinPath);

      if (geminiBinPath) {
        // Resolve symlinks
        const realPath = fs.realpathSync(geminiBinPath);
        console.log("[GeminiCLI] Resolved path:", realPath);

        // realPath often points to the actual JS entry point, e.g.:
        // /opt/homebrew/Cellar/gemini-cli/0.27.3/libexec/lib/node_modules/@google/gemini-cli/dist/index.js

        // Walk up to find the package root (containing package.json)
        let currentDir = fs.lstatSync(realPath).isFile() ? path.dirname(realPath) : realPath;
        let packagePath: string | null = null;

        // Try going up up to 5 levels to find package.json
        for (let i = 0; i < 5; i++) {
            const pkgJsonPath = path.join(currentDir, "package.json");
            if (fs.existsSync(pkgJsonPath)) {
                // Verify it's actually the gemini-cli package
                try {
                    const pkgContent = fs.readFileSync(pkgJsonPath, "utf8");
                    const pkg = JSON.parse(pkgContent);
                    console.log(`[GeminiCLI] Found package.json at ${currentDir} with name: ${pkg.name}`);

                    if (pkg.name === "@google/gemini-cli") {
                        packagePath = currentDir;
                        // If we found it in 'dist', the real root is usually one level up
                        if (path.basename(currentDir) === 'dist') {
                             console.log("[GeminiCLI] Found package in 'dist', moving up one level");
                             packagePath = path.dirname(currentDir);
                        }
                        break;
                    }
                } catch (e) {
                    // Ignore JSON parse errors
                }
            }
            const parent = path.dirname(currentDir);
            if (parent === currentDir) break; // Root reached
            currentDir = parent;
        }

        if (packagePath) {
             console.log("[GeminiCLI] Using package root:", packagePath);
             const creds = extractCredentialsFromPackage(packagePath);
             if (creds) {
                 console.log("[GeminiCLI] Credentials found in resolved package.");
                 return creds;
             }
        } else {
             console.log("[GeminiCLI] Could not find @google/gemini-cli package.json walking up from resolved path.");
        }
      }
    } catch (e) {
      console.log("[GeminiCLI] 'which gemini' failed or threw error:", e);
    }

    // Strategy 2: Standard Global node_modules paths
    const paths = getGlobalNodeModulesPaths();
    console.log("[GeminiCLI] Checking global node_modules paths:", paths);

    for (const rootPath of paths) {
      const packagePath = path.join(rootPath, "@google", "gemini-cli");
      console.log("[GeminiCLI] Checking package path:", packagePath);

      if (fs.existsSync(packagePath)) {
        const credentials = extractCredentialsFromPackage(packagePath);
        if (credentials) {
          console.log("[GeminiCLI] Credentials found in global path.");
          return credentials;
        }
      }
    }

    console.log("[GeminiCLI] No credentials found in any path.");
    return null;
  } catch (error) {
    console.error("[GeminiCLI] Fatal error detecting Gemini CLI:", error);
    return null;
  }
}

function getGlobalNodeModulesPaths(): string[] {
  const paths: string[] = [];

  // Try npm
  try {
    const npmRoot = execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (npmRoot) paths.push(npmRoot);
  } catch (e) {
    // Ignore error
  }

  // Try pnpm
  try {
    const pnpmRoot = execSync("pnpm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (pnpmRoot) paths.push(pnpmRoot);
  } catch (e) {
    // Ignore error
  }

  // Try standard paths as fallback
  paths.push("/usr/local/lib/node_modules");
  paths.push("/usr/lib/node_modules");
  paths.push("/opt/homebrew/lib/node_modules");

  return [...new Set(paths)]; // Remove duplicates
}

function extractCredentialsFromPackage(packagePath: string): GeminiCredentials | null {
  try {
    // Places to look for the file containing secrets
    // 1. The main package dist
    // 2. The nested @google/gemini-cli-core dependency
    // 3. Sibling directories (common in flattened installs)

    // Construct potential paths for gemini-cli-core
    // In Homebrew/global installs, it might be:
    // - package/node_modules/@google/gemini-cli-core
    // - package/../gemini-cli-core (sibling in @google dir)
    // - package/../../node_modules/@google/gemini-cli-core (hoisted)

    const searchLocations = [
      { dir: path.join(packagePath, "dist"), recursive: true },
      { dir: path.join(packagePath, "bin"), recursive: false },
      // Nested
      { dir: path.join(packagePath, "node_modules", "@google", "gemini-cli-core", "dist"), recursive: true },
      // Sibling in @google
      { dir: path.join(packagePath, "..", "gemini-cli-core", "dist"), recursive: true },
      // Hoisted (two levels up from packagePath/@google/gemini-cli -> node_modules)
      { dir: path.join(packagePath, "..", "..", "@google", "gemini-cli-core", "dist"), recursive: true }
    ];

    for (const location of searchLocations) {
      console.log(`[GeminiCLI] Searching in ${location.dir} (recursive: ${location.recursive})`);
      if (!fs.existsSync(location.dir)) continue;

      const files = findJsFiles(location.dir, location.recursive ? 3 : 0);
      console.log(`[GeminiCLI] Found ${files.length} JS files in ${location.dir}`);

      for (const filePath of files) {
        const content = fs.readFileSync(filePath, "utf8");

        // Regex to find Client ID (usually starts with number, ends with .apps.googleusercontent.com)
        // and Client Secret (usually starts with GOCSPX-)
        const clientIdMatch = content.match(/["'](\d+-[a-zA-Z0-9_]+\.apps\.googleusercontent\.com)["']/);
        const clientSecretMatch = content.match(/["'](GOCSPX-[a-zA-Z0-9_-]+)["']/);

        if (clientIdMatch && clientSecretMatch) {
          console.log(`[GeminiCLI] Match found in ${filePath}`);
          return {
            clientId: clientIdMatch[1],
            clientSecret: clientSecretMatch[1]
          };
        }
      }
    }
  } catch (e) {
    console.error("[GeminiCLI] Error extracting credentials from package:", e);
  }

  return null;
}

function findJsFiles(dir: string, depth: number): string[] {
  if (depth < 0) return [];
  let results: string[] = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat && stat.isDirectory()) {
        results = results.concat(findJsFiles(filePath, depth - 1));
      } else if (file.endsWith(".js") || file.endsWith(".mjs")) {
        results.push(filePath);
      }
    }
  } catch (e) {
    // Ignore access errors
  }
  return results;
}
