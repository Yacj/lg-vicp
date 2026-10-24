/**
 * H5 真实页面联调：登录 → 提问 → 只读比较面板。
 * 只用本机 Edge + CDP；每步落盘状态，失败时保留截图，不用 HTTP 200 代替页面结果。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const PORT = Number(process.env.CDP_PORT ?? 9333);
const OUT = process.argv[2] ?? "D:/work/lg-vicp/backend/docs/ai/evidence/phase4-2026-10-20/h5-compare";
const PHONE = process.env.H5_PHONE ?? "15255334975";
const PASSWORD = process.env.H5_PASSWORD ?? "a2276382";
mkdirSync(dirname(`${OUT}/state.json`), { recursive: true });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    const cdp = new Cdp(ws);
    ws.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.id && cdp.pending.has(msg.id)) {
        const { resolve, reject } = cdp.pending.get(msg.id); cdp.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    };
    return cdp;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`CDP timeout ${method}`)); }, 45000);
    });
  }
  async eval(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "evaluate failed");
    return result.result?.value;
  }
  close() { try { this.ws.close(); } catch {} }
}

const json = async path => (await fetch(`http://127.0.0.1:${PORT}${path}`, { method: path.startsWith("/json/new") ? "PUT" : "GET" })).json();

const helper = `
window.__vicp = {
  text: () => document.body.innerText,
  clickText: (needle) => {
    const nodes = [...document.querySelectorAll('button, uni-button, [role=button], .wd-button, view, span, div')]
      .filter(el => (el.innerText || '').trim() === needle);
    const target = nodes.sort((a, b) => a.innerText.length - b.innerText.length)[0] || nodes[0];
    if (!target) return false;
    target.click(); return true;
  },
  clickContains: (needle) => {
    const nodes = [...document.querySelectorAll('button, uni-button, [role=button], .wd-button')]
      .filter(el => (el.innerText || '').includes(needle));
    if (!nodes.length) return false; nodes[0].click(); return true;
  },
  fill: (index, value) => {
    const inputs = [...document.querySelectorAll('input, textarea')];
    const el = inputs[index]; if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  inputs: () => [...document.querySelectorAll('input, textarea')].map(el => ({ type: el.type, placeholder: el.placeholder, value: el.value ? 'filled' : '' })),
}; true`;
let step = "connect";
let cdp;
const state = { at: new Date().toISOString(), phone: PHONE, steps: [] };
const mark = (name, data) => { state.steps.push({ name, at: new Date().toISOString(), ...data }); writeFileSync(`${OUT}/state.json`, JSON.stringify(state, null, 2), "utf8"); console.log(`[STEP] ${name} ${JSON.stringify(data).slice(0, 300)}`); };

async function waitFor(predicate, timeoutMs, name) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await cdp.eval(predicate);
    if (value) return value;
    await sleep(1500);
  }
  throw new Error(`等待超时：${name}`);
}

async function shot(file) {
  try {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(`${OUT}/${file}`, Buffer.from(data, "base64"));
  } catch (error) { mark("screenshot-failed", { file, error: String(error?.message ?? error) }); }
}

async function main() {
  const list = await json("/json/list");
  const page = Array.isArray(list) ? list.find(item => item.type === "page") : null;
  if (!page?.webSocketDebuggerUrl) throw new Error("没有可用的调试页面，请先启动 Edge");
  cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  await cdp.eval(helper);

  step = "login-page";
  await cdp.send("Page.navigate", { url: "http://localhost:8871/#/pages/login" });
  await sleep(6000);
  await cdp.eval(helper);
  const hasLoginInputs = await waitFor(`document.querySelectorAll('input').length >= 2`, 15000, "登录输入框").then(() => true).catch(() => false);
  mark("login-inputs", { hasLoginInputs, inputs: await cdp.eval(`window.__vicp.inputs()`) });

  step = "fill-login";
  if (!hasLoginInputs) mark("login-skipped", { reason: "已登录或登录页未渲染输入框" });
  if (!hasLoginInputs) { await cdp.send("Page.navigate", { url: "http://localhost:8871/#/pages/assistant/index" }); }
  else {
  await cdp.eval(`window.__vicp.fill(0, ${JSON.stringify(PHONE)})`);
  await cdp.eval(`window.__vicp.fill(1, ${JSON.stringify(PASSWORD)})`);
  await sleep(600);
  const clicked = await cdp.eval(`window.__vicp.clickContains('登录') || window.__vicp.clickText('登录')`);
  mark("submit-login", { clicked });
  await sleep(1500);
  const consent = await cdp.eval(`document.body.innerText.includes('请先确认协议')`);
  if (consent) {
    const accepted = await cdp.eval(`window.__vicp.clickText('同意并继续') || window.__vicp.clickContains('同意并继续')`);
    mark("accept-terms", { accepted });
    await sleep(2500);
  }
  await shot("01-login.png");
  }

  step = "after-login";
  await waitFor(`location.hash.includes('login') ? false : true`, 40000, "登录后跳转").catch(async () => {
    mark("login-maybe-failed", { text: (await cdp.eval(`document.body.innerText`)).slice(0, 400) });
  });
  await sleep(4000);
  mark("after-login", { href: await cdp.eval(`location.href`), text: (await cdp.eval(`document.body.innerText`)).slice(0, 300) });
  await shot("02-home.png");

  step = "assistant";
  await cdp.send("Page.navigate", { url: "http://localhost:8871/#/pages/assistant/index" });
  await sleep(7000);
  await cdp.eval(helper);
  await waitFor(`typeof window.__vicp === 'object' && document.querySelectorAll('textarea, input').length >= 1`, 40000, "助手输入框");
  mark("assistant-ready", { href: await cdp.eval(`location.href`), text: (await cdp.eval(`document.body.innerText`)).slice(0, 200) });

  step = "ask";
  const question = "保温薄抹灰传热系数0.3方案有么";
  const filled = await cdp.eval(`window.__vicp.fill(0, ${JSON.stringify(question)})`);
  await sleep(800);
  const echoed = await cdp.eval(`document.querySelector('textarea')?.value ?? ''`);
  const sent = await cdp.eval(`(() => { const el = document.querySelector('.ai-composer__send') || document.querySelector('[aria-label="发送消息"]'); if (!el) return false; el.click(); return true; })()`);
  mark("ask", { filled, echoed, sent, question });
  await waitFor(`document.body.innerText.includes('只读比较（不产生候选）')`, 120000, "只读比较入口").catch(async () => {
    mark("compare-entry-missing", { text: (await cdp.eval(`document.body.innerText`)).slice(0, 800) });
  });
  await shot("03-answer.png");

  step = "open-compare";
  const opened = await cdp.eval(`window.__vicp.clickContains('只读比较（不产生候选）')`);
  mark("open-compare", { opened });
  await sleep(2500);
  await cdp.eval(helper);
  const popupText = await cdp.eval(`document.body.innerText`);
  mark("popup", { hasTitle: popupText.includes('只读比较'), hasWarning: popupText.includes('不会生成正式候选') });
  await shot("04-picker.png");

  step = "select-two";
  const picked = await cdp.eval(`(() => {
    const popup = document.querySelector('.ai-knowledge-compare');
    if (!popup) return [];
    const rows = [...popup.querySelectorAll('uni-view')].filter(el => ((el.className || '').toString().includes('rounded-2')) && /mm/.test(el.innerText || ''));
    const unique = rows.filter((el, index) => rows.findIndex(other => other.innerText === el.innerText) === index).slice(0, 2);
    unique.forEach(el => el.click());
    return unique.map(el => el.innerText.trim().replace(/\s+/g, ' '));
  })()`);
  mark("select-two", { picked });
  await sleep(1200);

  step = "run-compare";
  const run = await cdp.eval(`window.__vicp.clickContains('比较所选档位')`);
  mark("run-compare", { run });
  await waitFor(`document.body.innerText.includes('只读比较，不构成正式候选') || document.body.innerText.includes('没有足够的可比较档位')`, 60000, "比较结果").catch(async () => {
    mark("compare-result-missing", { text: (await cdp.eval(`document.body.innerText`)).slice(0, 900) });
  });
  await sleep(1500);
  const finalText = await cdp.eval(`document.body.innerText`);
  writeFileSync(`${OUT}/page-text.txt`, finalText, "utf8");
  mark("result", { text: finalText.slice(0, 1600) });
  await shot("05-result.png");
  state.ok = finalText.includes("只读比较，不构成正式候选");
  writeFileSync(`${OUT}/state.json`, JSON.stringify(state, null, 2), "utf8");
  console.log(JSON.stringify({ ok: state.ok, steps: state.steps.length }, null, 1));
}

main().catch(async error => {
  mark("failed", { step, error: String(error?.message ?? error) });
  await shot("99-failure.png").catch(() => {});
  console.error(JSON.stringify({ step, error: String(error?.message ?? error) }));
  process.exitCode = 1;
}).finally(() => cdp?.close());
