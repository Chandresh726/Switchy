import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const APP_NAME = "Switchy Notifications.app";
const EXECUTABLE_NAME = "SwitchyNotifier";
const BUNDLE_IDENTIFIER = "in.slope726.switchy.notifications";
const ICNS_ENTRIES = [
  ["icp4", "icon_16x16.png"],
  ["ic11", "icon_16x16@2x.png"],
  ["icp5", "icon_32x32.png"],
  ["ic12", "icon_32x32@2x.png"],
  ["ic07", "icon_128x128.png"],
  ["ic13", "icon_128x128@2x.png"],
  ["ic08", "icon_256x256.png"],
  ["ic14", "icon_256x256@2x.png"],
  ["ic09", "icon_512x512.png"],
  ["ic10", "icon_512x512@2x.png"],
];

function plist(version) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>Switchy</string>
  <key>CFBundleExecutable</key>
  <string>${EXECUTABLE_NAME}</string>
  <key>CFBundleIconFile</key>
  <string>Switchy</string>
  <key>CFBundleIdentifier</key>
  <string>${BUNDLE_IDENTIFIER}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Switchy</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundleVersion</key>
  <string>${version}</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;
}

async function buildIcon(projectDirectory, resourcesDirectory, buildDirectory) {
  // macOS draws a default light-grey rounded card behind any app icon, so a
  // transparent logo shows as a white box in notification banners. This asset
  // is full-bleed brand artwork that covers the card entirely.
  const source = path.join(projectDirectory, "public", "Switchy-icon-macos.png");
  const iconset = path.join(buildDirectory, "Switchy.iconset");
  await mkdir(iconset, { recursive: true });
  for (const [size, scale] of [
    [16, 1], [16, 2], [32, 1], [32, 2], [128, 1], [128, 2],
    [256, 1], [256, 2], [512, 1], [512, 2],
  ]) {
    const pixels = size * scale;
    const suffix = scale === 2 ? `@${scale}x` : "";
    await execute("sips", [
      "-z", String(pixels), String(pixels), source,
      "--out", path.join(iconset, `icon_${size}x${size}${suffix}.png`),
    ]);
  }
  const elements = await Promise.all(ICNS_ENTRIES.map(async ([type, file]) => {
    const image = await readFile(path.join(iconset, file));
    const header = Buffer.alloc(8);
    header.write(type, 0, "ascii");
    header.writeUInt32BE(image.length + header.length, 4);
    return Buffer.concat([header, image]);
  }));
  const body = Buffer.concat(elements);
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(body.length + header.length, 4);

  const destination = path.join(resourcesDirectory, "Switchy.icns");
  await writeFile(destination, Buffer.concat([header, body]));

  // The command-line-tools iconutil currently rejects valid iconsets while
  // packing on some supported macOS releases. It can still decode an ICNS, so
  // round-trip the deterministic PNG-backed container to validate every entry.
  await execute("iconutil", [
    "--convert", "iconset",
    "--output", path.join(buildDirectory, "Validated.iconset"),
    destination,
  ]);
}

export async function buildMacOSNotifierBundle({
  outputDirectory,
  projectDirectory = process.cwd(),
} = {}) {
  if (process.platform !== "darwin") return null;

  const definition = JSON.parse(
    await readFile(path.join(projectDirectory, "package.json"), "utf8")
  );
  const destinationRoot = outputDirectory
    ?? path.join(projectDirectory, ".switchy-build", "native", "macos");
  const bundle = path.join(destinationRoot, APP_NAME);
  const contents = path.join(bundle, "Contents");
  const executableDirectory = path.join(contents, "MacOS");
  const resourcesDirectory = path.join(contents, "Resources");
  const buildDirectory = path.join(destinationRoot, ".build");
  const executable = path.join(executableDirectory, EXECUTABLE_NAME);

  await rm(bundle, { recursive: true, force: true });
  await rm(buildDirectory, { recursive: true, force: true });
  await Promise.all([
    mkdir(executableDirectory, { recursive: true }),
    mkdir(resourcesDirectory, { recursive: true }),
    mkdir(buildDirectory, { recursive: true }),
  ]);

  await execute("xcrun", [
    "clang",
    "-fobjc-arc",
    `-fmodules-cache-path=${path.join(buildDirectory, "module-cache")}`,
    "-mmacosx-version-min=12.0",
    "-O",
    path.join(projectDirectory, "native", "macos", "SwitchyNotifier.m"),
    "-framework", "AppKit",
    "-framework", "UserNotifications",
    "-o", executable,
  ]);
  await Promise.all([
    writeFile(path.join(contents, "Info.plist"), plist(definition.version)),
    buildIcon(projectDirectory, resourcesDirectory, buildDirectory),
  ]);

  await execute("plutil", ["-lint", path.join(contents, "Info.plist")]);
  await execute("codesign", ["--force", "--deep", "--sign", "-", bundle]);
  await execute("codesign", ["--verify", "--deep", "--strict", bundle]);
  await rm(buildDirectory, { recursive: true, force: true });

  return {
    bundle,
    executable,
    bundleIdentifier: BUNDLE_IDENTIFIER,
  };
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const result = await buildMacOSNotifierBundle();
  if (result) console.log(result.bundle);
}
