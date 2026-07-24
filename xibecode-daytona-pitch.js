/**
 * XibeCode + Vectra Cloud — Daytona Startups pitch deck
 * Run: node xibecode-daytona-pitch.js
 */
const pptxgen = require("pptxgenjs");

const C = {
  bg: "070B12",
  panel: "0E1520",
  card: "121A28",
  cyan: "22D3EE",
  cyanDim: "0E7490",
  violet: "A78BFA",
  green: "34D399",
  orange: "FBBF24",
  white: "F8FAFC",
  muted: "94A3B8",
  faint: "64748B",
  line: "1E293B",
};

const FONT = "Arial";
const W = 13.333;
const H = 7.5;

const pres = new pptxgen();
pres.defineLayout({ name: "WIDE16", width: W, height: H });
pres.layout = "WIDE16";
pres.title = "XibeCode × Vectra Cloud — Daytona Startups";
pres.author = "XibeCode";
pres.subject = "Daytona.io startup credits application";

function footer(slide, page, total = 8) {
  slide.addText("XIBECODE  ·  VECTRA CLOUD  ·  CONFIDENTIAL", {
    x: 0.5, y: H - 0.38, w: 9, h: 0.25,
    fontFace: FONT, fontSize: 9, color: C.faint, margin: 0,
  });
  slide.addText(`${page} / ${total}`, {
    x: W - 1.4, y: H - 0.38, w: 0.9, h: 0.25,
    fontFace: FONT, fontSize: 9, color: C.faint, align: "right", margin: 0,
  });
}

function sectionLabel(slide, text, x = 0.5, y = 0.35) {
  slide.addText(text, {
    x, y, w: 12, h: 0.28,
    fontFace: FONT, fontSize: 11, color: C.cyan, bold: true,
    charSpacing: 2, margin: 0,
  });
}

// ─── 1. Title ───────────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.12, h: H, fill: { color: C.cyan },
  });
  s.addText("DAYTONA  ·  STARTUPS PROGRAM", {
    x: 0.7, y: 1.6, w: 11, h: 0.35,
    fontFace: FONT, fontSize: 13, color: C.cyan, bold: true, charSpacing: 3, margin: 0,
  });
  s.addText("XibeCode + Vectra Cloud", {
    x: 0.7, y: 2.15, w: 11.5, h: 0.75,
    fontFace: FONT, fontSize: 40, color: C.white, bold: true, margin: 0,
  });
  s.addText("Open-source AI coding agent. Managed sandboxes you can chat with.", {
    x: 0.7, y: 3.0, w: 11, h: 0.45,
    fontFace: FONT, fontSize: 18, color: C.muted, margin: 0,
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.7, y: 3.7, w: 2.2, h: 0.06, fill: { color: C.cyan },
  });
  s.addText([
    { text: "OSS agent  ·  ", options: { color: C.white } },
    { text: "Hosted product  ·  ", options: { color: C.white } },
    { text: "infra.xibeai.in", options: { color: C.cyan } },
  ], {
    x: 0.7, y: 4.1, w: 11, h: 0.4,
    fontFace: FONT, fontSize: 15, margin: 0,
  });
  s.addText("Request: sandbox credits to scale concurrent agent runtimes", {
    x: 0.7, y: 5.5, w: 11, h: 0.35,
    fontFace: FONT, fontSize: 13, color: C.faint, margin: 0,
  });
  footer(s, 1);
}

// ─── 2. Problem ─────────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  sectionLabel(s, "THE PROBLEM");
  s.addText("AI coders need real machines — not just chat windows", {
    x: 0.5, y: 0.7, w: 12, h: 0.55,
    fontFace: FONT, fontSize: 28, color: C.white, bold: true, margin: 0,
  });

  const problems = [
    { t: "Laptops sleep", d: "Long agent jobs die when the lid closes or Wi‑Fi drops." },
    { t: "VMs are heavy", d: "Raw VPS setups are slow to spin, hard to isolate, and costly to babysit." },
    { t: "Bots go silent", d: "Idle sandboxes pause; chat bots freeze unless wake is designed in." },
    { t: "Fragmented stack", d: "CLI agent, cloud host, and Telegram/Discord are usually separate tools." },
  ];
  problems.forEach((p, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.5 + col * 6.3;
    const y = 1.55 + row * 2.15;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y, w: 6.0, h: 1.95,
      fill: { color: C.card }, rectRadius: 0.1,
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 0.1, h: 1.95, fill: { color: i % 2 === 0 ? C.cyan : C.violet },
    });
    s.addText(p.t, {
      x: x + 0.35, y: y + 0.35, w: 5.3, h: 0.4,
      fontFace: FONT, fontSize: 18, color: C.white, bold: true, margin: 0,
    });
    s.addText(p.d, {
      x: x + 0.35, y: y + 0.9, w: 5.3, h: 0.7,
      fontFace: FONT, fontSize: 14, color: C.muted, margin: 0,
    });
  });
  footer(s, 2);
}

// ─── 3. Solution ────────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  sectionLabel(s, "THE SOLUTION");
  s.addText("One agent. Two ways to run it.", {
    x: 0.5, y: 0.7, w: 12, h: 0.5,
    fontFace: FONT, fontSize: 28, color: C.white, bold: true, margin: 0,
  });

  // Left card — OSS
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.5, y: 1.45, w: 5.9, h: 4.7,
    fill: { color: C.card }, rectRadius: 0.12,
  });
  s.addText("XIBECODE", {
    x: 0.85, y: 1.75, w: 5.2, h: 0.3,
    fontFace: FONT, fontSize: 12, color: C.cyan, bold: true, charSpacing: 2, margin: 0,
  });
  s.addText("Open-source CLI agent", {
    x: 0.85, y: 2.15, w: 5.2, h: 0.45,
    fontFace: FONT, fontSize: 22, color: C.white, bold: true, margin: 0,
  });
  s.addText([
    { text: "Edits code, runs commands, iterates with LLMs", options: { breakLine: true } },
    { text: "Multi-model (Anthropic + OpenAI-compatible)", options: { breakLine: true } },
    { text: "Skills system + MCP integration", options: { breakLine: true } },
    { text: "Apache 2.0 — npm + GitHub", options: { breakLine: true } },
    { text: "Local-first for developers who want control", options: {} },
  ], {
    x: 0.85, y: 2.85, w: 5.2, h: 2.8,
    fontFace: FONT, fontSize: 15, color: C.muted, paraSpaceAfter: 10, margin: 0,
  });

  // Right card — Cloud
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 6.85, y: 1.45, w: 5.9, h: 4.7,
    fill: { color: C.card }, rectRadius: 0.12,
  });
  s.addText("VECTRA CLOUD", {
    x: 7.2, y: 1.75, w: 5.2, h: 0.3,
    fontFace: FONT, fontSize: 12, color: C.violet, bold: true, charSpacing: 2, margin: 0,
  });
  s.addText("Managed AI sandboxes", {
    x: 7.2, y: 2.15, w: 5.2, h: 0.45,
    fontFace: FONT, fontSize: 22, color: C.white, bold: true, margin: 0,
  });
  s.addText([
    { text: "XibeCode preinstalled in isolated VMs", options: { breakLine: true } },
    { text: "Telegram / Discord / Slack as the UI", options: { breakLine: true } },
    { text: "Auto pause on idle, wake when needed", options: { breakLine: true } },
    { text: "Dashboard, billing, multi-tenant hosting", options: { breakLine: true } },
    { text: "Live: infra.xibeai.in", options: {} },
  ], {
    x: 7.2, y: 2.85, w: 5.2, h: 2.8,
    fontFace: FONT, fontSize: 15, color: C.muted, paraSpaceAfter: 10, margin: 0,
  });
  footer(s, 3);
}

// ─── 4. Product ─────────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  sectionLabel(s, "PRODUCT");
  s.addText("From chat message → coding sandbox", {
    x: 0.5, y: 0.7, w: 12, h: 0.5,
    fontFace: FONT, fontSize: 28, color: C.white, bold: true, margin: 0,
  });

  const steps = [
    { n: "01", t: "Spin up", d: "User gets a sandbox with XibeCode ready" },
    { n: "02", t: "Connect", d: "Paste AI key + Telegram / Discord / Slack" },
    { n: "03", t: "Code anywhere", d: "Message the bot — agent edits & runs code" },
    { n: "04", t: "Pause & wake", d: "Idle freezes cost; next DM can wake the box" },
  ];
  steps.forEach((st, i) => {
    const x = 0.5 + i * 3.15;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y: 1.6, w: 3.0, h: 4.3,
      fill: { color: C.card }, rectRadius: 0.1,
    });
    s.addText(st.n, {
      x: x + 0.25, y: 1.95, w: 2.5, h: 0.55,
      fontFace: FONT, fontSize: 28, color: C.cyan, bold: true, margin: 0,
    });
    s.addText(st.t, {
      x: x + 0.25, y: 2.7, w: 2.5, h: 0.5,
      fontFace: FONT, fontSize: 18, color: C.white, bold: true, margin: 0,
    });
    s.addText(st.d, {
      x: x + 0.25, y: 3.4, w: 2.5, h: 1.8,
      fontFace: FONT, fontSize: 14, color: C.muted, margin: 0,
    });
  });
  footer(s, 4);
}

// ─── 5. Why sandboxes / Daytona ─────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  sectionLabel(s, "WHY SANDBOXES  ·  WHY DAYTONA");
  s.addText("Agents need isolation. We need scale.", {
    x: 0.5, y: 0.7, w: 12, h: 0.5,
    fontFace: FONT, fontSize: 28, color: C.white, bold: true, margin: 0,
  });

  const rows = [
    { t: "Secure isolation", d: "Untrusted agent commands stay in a sandbox, not on the host." },
    { t: "Fast spin-up", d: "Seconds matter when a Telegram user expects a reply." },
    { t: "Lifecycle control", d: "Pause, resume, and reclaim capacity for multi-tenant economics." },
    { t: "Daytona fit", d: "Credits let us run more concurrent agent jobs, demos, and load tests." },
  ];
  rows.forEach((r, i) => {
    const y = 1.45 + i * 1.15;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.5, y, w: 12.3, h: 1.0,
      fill: { color: C.card }, rectRadius: 0.08,
    });
    s.addShape(pres.shapes.OVAL, {
      x: 0.75, y: y + 0.28, w: 0.45, h: 0.45,
      fill: { color: C.cyanDim },
    });
    s.addText(String(i + 1), {
      x: 0.75, y: y + 0.32, w: 0.45, h: 0.4,
      fontFace: FONT, fontSize: 14, color: C.white, bold: true, align: "center", margin: 0,
    });
    s.addText(r.t, {
      x: 1.5, y: y + 0.18, w: 10.8, h: 0.35,
      fontFace: FONT, fontSize: 16, color: C.white, bold: true, margin: 0,
    });
    s.addText(r.d, {
      x: 1.5, y: y + 0.52, w: 10.8, h: 0.35,
      fontFace: FONT, fontSize: 14, color: C.muted, margin: 0,
    });
  });
  footer(s, 5);
}

// ─── 6. Traction ────────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  sectionLabel(s, "TRACTION  ·  STATUS");
  s.addText("Built and shipping", {
    x: 0.5, y: 0.7, w: 12, h: 0.5,
    fontFace: FONT, fontSize: 28, color: C.white, bold: true, margin: 0,
  });

  const stats = [
    { v: "OSS", l: "XibeCode on npm\n& GitHub (Apache 2.0)" },
    { v: "Live", l: "Vectra Cloud at\ninfra.xibeai.in" },
    { v: "Chat", l: "Telegram · Discord\n· Slack channels" },
    { v: "Stack", l: "Next.js · Gateway\n· isolated sandboxes" },
  ];
  stats.forEach((st, i) => {
    const x = 0.5 + i * 3.15;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y: 1.5, w: 3.0, h: 2.6,
      fill: { color: C.card }, rectRadius: 0.1,
    });
    s.addText(st.v, {
      x: x + 0.2, y: 1.85, w: 2.6, h: 0.7,
      fontFace: FONT, fontSize: 28, color: C.cyan, bold: true, margin: 0,
    });
    s.addText(st.l, {
      x: x + 0.2, y: 2.7, w: 2.6, h: 1.0,
      fontFace: FONT, fontSize: 14, color: C.muted, margin: 0,
    });
  });

  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.5, y: 4.4, w: 12.3, h: 1.9,
    fill: { color: C.card }, rectRadius: 0.1,
  });
  s.addText("Business model", {
    x: 0.85, y: 4.65, w: 11.5, h: 0.35,
    fontFace: FONT, fontSize: 16, color: C.white, bold: true, margin: 0,
  });
  s.addText("Free tier + paid hosted sandboxes (CPU/RAM plan). OSS agent grows adoption; Vectra Cloud monetizes always-on runtime, channels, and managed isolation. Daytona credits reduce unit cost while we grow concurrent users and demos.", {
    x: 0.85, y: 5.15, w: 11.5, h: 0.9,
    fontFace: FONT, fontSize: 14, color: C.muted, margin: 0,
  });
  footer(s, 6);
}

// ─── 7. The ask ─────────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  sectionLabel(s, "THE ASK");
  s.addText("Daytona startup credits", {
    x: 0.5, y: 0.7, w: 12, h: 0.5,
    fontFace: FONT, fontSize: 28, color: C.white, bold: true, margin: 0,
  });
  s.addText("Fuel concurrent agent sandboxes while we grow the hosted product.", {
    x: 0.5, y: 1.25, w: 12, h: 0.4,
    fontFace: FONT, fontSize: 16, color: C.muted, margin: 0,
  });

  const uses = [
    { t: "More concurrent runtimes", d: "Support more tenants without burning cash on idle capacity." },
    { t: "Demos & onboarding", d: "Instant sandboxes for trials, content, and partner showcases." },
    { t: "Load & reliability tests", d: "Pause/wake, long jobs, and multi-user stress under real isolation." },
    { t: "Backend evaluation", d: "Validate Daytona as a production sandbox provider for Vectra." },
  ];
  uses.forEach((u, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.5 + col * 6.3;
    const y = 1.9 + row * 2.0;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y, w: 6.0, h: 1.8,
      fill: { color: C.card }, rectRadius: 0.1,
    });
    s.addText(u.t, {
      x: x + 0.35, y: y + 0.35, w: 5.3, h: 0.4,
      fontFace: FONT, fontSize: 17, color: C.cyan, bold: true, margin: 0,
    });
    s.addText(u.d, {
      x: x + 0.35, y: y + 0.9, w: 5.3, h: 0.6,
      fontFace: FONT, fontSize: 14, color: C.muted, margin: 0,
    });
  });
  footer(s, 7);
}

// ─── 8. Close ───────────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.bg };
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.12, h: H, fill: { color: C.cyan },
  });
  s.addText("Let's build the always-on coding agent", {
    x: 0.7, y: 2.0, w: 12, h: 0.7,
    fontFace: FONT, fontSize: 32, color: C.white, bold: true, margin: 0,
  });
  s.addText("Open source for developers. Cloud for everyone else.", {
    x: 0.7, y: 2.8, w: 12, h: 0.45,
    fontFace: FONT, fontSize: 18, color: C.muted, margin: 0,
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.7, y: 3.5, w: 2.0, h: 0.06, fill: { color: C.cyan },
  });

  const links = [
    { l: "Product", v: "infra.xibeai.in" },
    { l: "Docs", v: "xibeai.in/docs" },
    { l: "OSS", v: "github.com/iotserver24/xibecode" },
  ];
  links.forEach((lk, i) => {
    const x = 0.7 + i * 4.0;
    s.addText(lk.l, {
      x, y: 4.0, w: 3.6, h: 0.3,
      fontFace: FONT, fontSize: 12, color: C.faint, bold: true, margin: 0,
    });
    s.addText(lk.v, {
      x, y: 4.35, w: 3.6, h: 0.35,
      fontFace: FONT, fontSize: 15, color: C.cyan, margin: 0,
    });
  });
  s.addText("Thank you — happy to demo live sandboxes + Telegram agent.", {
    x: 0.7, y: 5.5, w: 12, h: 0.35,
    fontFace: FONT, fontSize: 14, color: C.muted, margin: 0,
  });
  footer(s, 8);
}

pres.writeFile({ fileName: "/home/r3ap3reditz/codes/cloud-infra/XibeCode-Daytona-Pitch.pptx" })
  .then(() => console.log("Wrote XibeCode-Daytona-Pitch.pptx"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
