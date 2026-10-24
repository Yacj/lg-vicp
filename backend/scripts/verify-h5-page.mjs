/** 最小 CDP 驱动：用本机 Edge 做真实页面渲染验收（不依赖 agent-browser）。 */
import { writeFileSync } from "node:fs";

const PORT = Number(process.env.CDP_PORT ?? 9333);
const BASE = `http://127.0.0.1:${PORT}`;

async function http(pathname, init) {
  const response = await fetch(`${BASE}${pathname}`, init);
  return response.json().catch(() => null);
}

async function newTarget(url) {
  const existing = await http("/json/list");
  if (Array.isArray(existing)) {
    const page = existing.find(item => item.type === "page");
    if (page) return page;
  }
  return http(`/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    const cdp = new Cdp(ws);
    ws.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.id && cdp.pending.has(msg.id)) {
        const { resolve, reject } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
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
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`CDP timeout ${method}`)); }, 30000);
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "evaluate failed");
    return result.result?.value;
  }
  close() { try { this.ws.close(); } catch {} }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const url = process.argv[2] ?? "http://localhost:8871/";
  const out = process.argv[3] ?? "dom.json";
  const target = await newTarget(url);
  if (!target?.webSocketDebuggerUrl) throw new Error(`无法创建页面: ${JSON.stringify(target)}`);
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url });
  await sleep(9000);
  const info = await cdp.evaluate(`(() => ({
    title: document.title,
    href: location.href,
    text: (document.body?.innerText || '').slice(0, 3000),
    inputs: [...document.querySelectorAll('input')].map(el => ({ type: el.type, placeholder: el.placeholder, name: el.name })).slice(0, 12),
    buttons: [...document.querySelectorAll('button, [role=button]')].map(el => (el.innerText || '').trim()).filter(Boolean).slice(0, 20),
    hasApp: Boolean(document.querySelector('#app')?.children.length)
  }))()`);
  writeFileSync(out, JSON.stringify({ url, at: new Date().toISOString(), ...info }, null, 2), "utf8");
  console.log(JSON.stringify({ title: info.title, href: info.href, hasApp: info.hasApp, textLength: info.text.length, inputs: info.inputs, buttons: info.buttons }, null, 1));
  cdp.close();
}

main().catch(error => { console.error(String(error?.message ?? error)); process.exit(1); });
