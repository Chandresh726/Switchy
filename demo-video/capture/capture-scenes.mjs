import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.resolve(currentDirectory, "../public/captures");
const baseUrl = process.env.SWITCHY_CAPTURE_URL ?? "http://127.0.0.1:3000";

const waitForPage = async (page) => {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1800);
};

const replaceText = async (page, replacements) => {
  await page.evaluate((entries) => {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT
    );
    const nodes = [];

    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }

    for (const node of nodes) {
      let value = node.nodeValue ?? "";
      for (const [search, replacement] of entries) {
        value = value.replaceAll(search, replacement);
      }
      node.nodeValue = value;
    }
  }, replacements);
};

const setExactText = async (page, currentText, replacement) => {
  const element = page.getByText(currentText, { exact: true }).first();
  if (await element.isVisible().catch(() => false)) {
    await element.evaluate((node, value) => {
      node.textContent = value;
    }, replacement);
  }
};

const preparePage = async (page) => {
  await page.emulateMedia({
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  await page.addStyleTag({
    content: `
      * {
        caret-color: transparent !important;
      }

      nextjs-portal,
      [data-next-badge-root],
      [data-sonner-toaster],
      [data-sonner-toast] {
        display: none !important;
      }
    `,
  });
};

const capture = async (page, name) => {
  await page.screenshot({
    path: path.join(outputDirectory, `${name}.png`),
    animations: "disabled",
  });
};

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  locale: "en-US",
  serviceWorkers: "block",
});
const page = await context.newPage();

try {
  await page.goto(baseUrl);
  await waitForPage(page);
  await preparePage(page);
  await replaceText(page, [
    ["Chandresh", "Alex"],
    ["1437", "38"],
    ["this week", "since the latest scan"],
    ["Partial", "Complete"],
    ["95/95 companies", "24/24 companies"],
    ["+0", "+38"],
    ["75", "12"],
    ["2045", "48"],
    ["Software Engineer 2 (India)", "Backend Engineer"],
    ["UI Path", "Northstar Systems"],
    ["Software Engineer Atlas", "Platform Engineer"],
    ["Rubrik", "Cedar Labs"],
    ["AI Applications Engineer", "AI Product Engineer"],
    ["Five9", "Aperture"],
    ["Member Of Technical Staff 3", "Infrastructure Engineer"],
    ["Nutanix", "Helix"],
    ["Sr Software Engineer | AI", "Senior Software Engineer"],
  ]);
  await setExactText(page, "+0", "+38");
  await setExactText(page, "95/95 companies", "24/24 companies");
  await setExactText(page, "95", "24");
  await capture(page, "dashboard");

  await page.goto(`${baseUrl}/jobs`);
  await waitForPage(page);
  await preparePage(page);
  await replaceText(page, [
    ["1585 jobs", "342 jobs"],
    ["3705", "124"],
    ["75", "12"],
    ["Mark Applied", "Track application"],
    ["viewed", "new"],
  ]);
  await setExactText(page, "1585 jobs", "342 jobs");
  await capture(page, "jobs");

  const jobHref = await page
    .locator('a[href^="/jobs/"]')
    .filter({ hasNot: page.locator('a[href*="/cover-letter"]') })
    .first()
    .getAttribute("href")
    .catch(() => null);

  if (!jobHref) {
    throw new Error("Could not resolve a job-detail link from the Jobs page.");
  }

  await page.goto(new URL(jobHref, baseUrl).toString());
  await waitForPage(page);
  await preparePage(page);
  await replaceText(page, [
    ["Chandresh", "Alex"],
    ["Mark Applied", "Track application"],
    ["Status: Viewed", "Status: New"],
    [
      "Strong match for cloud-native software and platform engineering opportunities, with relevant AWS, Java/Python, CI/CD, AI tooling, migration, and distributed-systems experience. Financial-market data and Bangalore location alignment are not evidenced.",
      "Strong match for a backend and platform engineering role, with relevant API design, cloud infrastructure, delivery automation, and distributed-systems experience. The analysis also calls out the few areas worth validating before applying.",
    ],
  ]);
  await capture(page, "match-analysis");

  await page.goto(new URL(`${jobHref}/cover-letter`, baseUrl).toString());
  await waitForPage(page);
  await preparePage(page);
  await replaceText(page, [
    ["Chandresh", "Alex"],
    ["Experian", "Northstar Systems"],
  ]);

  const editable = page.locator('[contenteditable="true"]').first();
  if (await editable.isVisible().catch(() => false)) {
    await editable.evaluate((element) => {
      element.innerHTML = `
        <p>Dear Hiring Team,</p>
        <p>I’m excited to apply for this software engineering role. My experience building reliable backend services and production automation aligns closely with the team’s focus on scalable, dependable systems.</p>
        <p>In my current role, I design APIs, improve delivery workflows, and partner across engineering teams to turn complex requirements into maintainable software. I would welcome the opportunity to bring that practical, product-focused approach to your team.</p>
        <p>Thank you for your consideration.</p>
      `;
    });
  }
  await capture(page, "cover-letter");

  process.stdout.write(
    `Captured dashboard, jobs, match analysis, and cover letter from ${baseUrl}\n`
  );
} finally {
  await context.close();
  await browser.close();
}
