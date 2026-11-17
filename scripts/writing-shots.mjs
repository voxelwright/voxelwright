// Screenshots and numeric gates for the ai-session block, against the demo server.
//   node scripts/writing-demo.mjs   (running on 5976)
//   PLAYWRIGHT=/path/to/node_modules/playwright-core node scripts/writing-shots.mjs [outDir]
// Shoots the demo post in fresh and blend, light and dark, at 1280 and 390: the first block,
// the decision block, and a deep link into a folded turn. Prints the gates from site-craft:
// fonts loaded, requests leaving localhost, horizontal scroll, and contrast for text in the
// block and for every code token inside it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const { chromium, webkit } = createRequire(import.meta.url)(process.env.PLAYWRIGHT ?? "playwright-core");
const out = process.argv[2] ?? path.join(os.homedir(), ".village/site/writing");
fs.mkdirSync(out, { recursive: true });
const BASE = process.env.BASE ?? "http://127.0.0.1:5976";
const POST = "/blog/ai-sessions-as-blocks/";
const problems = [];
const report = [];

const gates = () => {
  // contrast helpers run in the page
  const parse = (c) => {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const lum = ([r, g, b]) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bgOf = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c[3] > 0.5) return c;
    }
    return parse(getComputedStyle(document.body).backgroundColor);
  };
  const ratio = (el) => {
    const fg = parse(getComputedStyle(el).color);
    const bg = bgOf(el);
    const mix = fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
    const [a, b] = [lum(mix), lum(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  };
  const block = document.querySelector(".ais");
  const worst = [];
  for (const el of block.querySelectorAll(".ais-who, .ais-facts, .ais-by, .ais-gist, .ais-act summary, .ais-sub summary, .ais-sum-facts, .ais-tool, .ais-label, .ais-person-text p, .ais-model-text p, .ais-num, .ais-event, .ais-opt-d")) {
    if (!el.getClientRects().length) continue;
    const r = ratio(el);
    if (r < 4.5) worst.push(`${el.className || el.tagName} ${r.toFixed(2)}`);
  }
  const tokens = [];
  for (const el of document.querySelectorAll(".ais pre span")) {
    if (!el.getClientRects().length || !el.textContent.trim()) continue;
    const r = ratio(el);
    if (r < 4.5) tokens.push(`${el.textContent.trim().slice(0, 12)} ${r.toFixed(2)}`);
  }
  return {
    fonts: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
    hscroll: document.documentElement.scrollWidth > innerWidth,
    lowText: worst,
    lowTokens: tokens,
  };
};

async function shoot(browserType, label, looks, schemes, widths) {
  const browser = await browserType.launch(browserType === chromium ? { channel: "chrome" } : {});
  try {
    for (const look of looks) {
      for (const scheme of schemes) {
        for (const width of widths) {
          const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme: scheme, deviceScaleFactor: 2 });
          const page = await context.newPage();
          const external = [];
          page.on("request", (r) => {
            if (!r.url().startsWith(BASE)) external.push(r.url());
          });
          const name = `${look}-${scheme}-${width}${label ? "-" + label : ""}`;
          await page.goto(`${BASE}/${look}${POST}?noswitch`, { waitUntil: "networkidle" });
          await page.evaluate(() => document.fonts.ready);
          const g = await page.evaluate(gates);
          const first = page.locator(".ais").first();
          await first.screenshot({ path: path.join(out, `${name}-block.png`) });
          await page.locator(".ais").nth(1).screenshot({ path: path.join(out, `${name}-decision.png`) });
          // A deep link into a folded exchange: the third prompt's reply.
          await page.goto(`${BASE}/${look}${POST}?noswitch#s-founding-t10`, { waitUntil: "networkidle" });
          await page.waitForTimeout(150);
          const opened = await page.evaluate(() => {
            const t = document.getElementById("s-founding-t10");
            const r = t.getBoundingClientRect();
            return { open: t.closest("details")?.open ?? false, top: Math.round(r.top), visible: r.top >= -2 && r.top < innerHeight };
          });
          await page.screenshot({ path: path.join(out, `${name}-deeplink.png`) });
          report.push(`${name}: fonts ${[...new Set(g.fonts)].join(", ") || "none"}; external ${external.length}; hscroll ${g.hscroll}; low text ${g.lowText.length}; low tokens ${g.lowTokens.length}; deep link open ${opened.open} visible ${opened.visible}`);
          if (external.length) problems.push(`${name}: external requests ${external.join(" ")}`);
          if (g.hscroll) problems.push(`${name}: horizontal scroll`);
          if (g.lowText.length) problems.push(`${name}: text under 4.5:1: ${g.lowText.slice(0, 6).join("; ")}`);
          if (g.lowTokens.length) problems.push(`${name}: code tokens under 4.5:1: ${g.lowTokens.slice(0, 6).join("; ")}`);
          if (!opened.open || !opened.visible) problems.push(`${name}: deep link did not open and show the turn`);
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
}

await shoot(chromium, "", ["fresh", "blend"], ["light", "dark"], [1280, 390]);
// The deep link again in WebKit at phone width (Safari's engine).
await shoot(webkit, "webkit", ["fresh"], ["light"], [390]);
console.log(report.join("\n"));
console.log(problems.length ? `\n${problems.length} problem(s):\n  ${problems.join("\n  ")}` : "\nAll gates passed.");
console.log(`Screenshots in ${out}`);
