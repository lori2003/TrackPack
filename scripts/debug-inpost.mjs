import fs from "node:fs/promises";
import { chromium } from "playwright";

const OUT = "data/inpost-debug.json";
const pageUrl = "https://inpost.it/trova-il-tuo-pacco";

function safeUrl(value) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, 300);
  } catch {
    return String(value || "").slice(0, 300);
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: "it-IT",
  timezoneId: "Europe/Rome",
  viewport: { width: 1440, height: 1100 },
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  extraHTTPHeaders: { "Accept-Language": "it-IT,it;q=0.9,en;q=0.7" }
});
const page = await context.newPage();
const requests = [];

page.on("request", (request) => {
  const type = request.resourceType();
  if (!["document", "xhr", "fetch", "script"].includes(type)) return;
  requests.push({ method: request.method(), type, url: safeUrl(request.url()) });
});

try {
  await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 50000 });
  await page.waitForTimeout(10000);

  const frames = [];
  for (const frame of page.frames()) {
    try {
      frames.push({
        url: safeUrl(frame.url()),
        inputs: await frame.locator("input").evaluateAll((nodes) => nodes.map((node) => ({
          type: node.type || "",
          name: node.name || "",
          id: node.id || "",
          placeholder: node.placeholder || "",
          ariaLabel: node.getAttribute("aria-label") || "",
          className: String(node.className || "").slice(0, 160),
          hidden: node.hidden,
          disabled: node.disabled
        }))),
        buttons: (await frame.locator("button").evaluateAll((nodes) => nodes.map((node) => ({
          text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
          id: node.id || "",
          className: String(node.className || "").slice(0, 160),
          ariaLabel: node.getAttribute("aria-label") || ""
        })))).filter((item) => item.text || item.ariaLabel).slice(0, 80),
        forms: await frame.locator("form").count(),
        iframes: await frame.locator("iframe").evaluateAll((nodes) => nodes.map((node) => safeUrl(node.src || node.getAttribute("src") || ""))),
        scripts: (await frame.locator("script[src]").evaluateAll((nodes) => nodes.map((node) => safeUrl(node.src)))).slice(0, 120)
      });
    } catch (error) {
      frames.push({ url: safeUrl(frame.url()), error: error?.message || "frame non leggibile" });
    }
  }

  const deepElements = await page.evaluate(() => {
    const output = [];
    const visited = new Set();
    function visit(root, depth = 0) {
      if (!root || depth > 12 || visited.has(root)) return;
      visited.add(root);
      const nodes = root.querySelectorAll ? root.querySelectorAll("*") : [];
      for (const node of nodes) {
        const tag = node.tagName?.toLowerCase() || "";
        if (tag.includes("-") || tag === "input" || tag === "button" || tag === "iframe") {
          output.push({
            tag,
            id: node.id || "",
            className: String(node.className || "").slice(0, 120),
            type: node.getAttribute?.("type") || "",
            name: node.getAttribute?.("name") || "",
            placeholder: node.getAttribute?.("placeholder") || "",
            ariaLabel: node.getAttribute?.("aria-label") || "",
            text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100),
            hasShadowRoot: Boolean(node.shadowRoot)
          });
        }
        if (node.shadowRoot) visit(node.shadowRoot, depth + 1);
      }
    }
    visit(document);
    return output.slice(0, 500);
  });

  const uniqueRequests = [];
  const seen = new Set();
  for (const item of requests) {
    const key = `${item.method} ${item.type} ${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRequests.push(item);
  }

  await fs.writeFile(OUT, `${JSON.stringify({
    checkedAt: new Date().toISOString(),
    finalUrl: safeUrl(page.url()),
    title: await page.title(),
    frames,
    deepElements,
    requests: uniqueRequests.slice(-250)
  }, null, 2)}\n`);
} finally {
  await page.close().catch(() => {});
  await context.close();
  await browser.close();
}
