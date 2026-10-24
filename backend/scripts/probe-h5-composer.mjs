/** 探测助手输入区结构：只读取 DOM，不提交。 */
const PORT = Number(process.env.CDP_PORT ?? 9333);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(item => item.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0; const pending = new Map();
ws.onmessage = event => { const msg = JSON.parse(event.data); if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); } };
const send = (method, params = {}) => { const mid = ++id; ws.send(JSON.stringify({ id: mid, method, params })); return new Promise((resolve, reject) => { pending.set(mid, { resolve, reject }); setTimeout(() => pending.delete(mid) && reject(new Error("timeout")), 20000); }); };
const evaluate = async expression => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
await send("Runtime.enable");
const info = await evaluate(`(() => {
  const composer = [...document.querySelectorAll('*')].find(el => (el.className || '').toString().includes('composer'));
  const inputs = [...document.querySelectorAll('input, textarea, [contenteditable=true]')].map(el => ({
    tag: el.tagName, cls: (el.className || '').toString().slice(0, 120), placeholder: el.placeholder || el.getAttribute('data-placeholder') || '',
    editable: el.isContentEditable, outer: el.outerHTML.slice(0, 220)
  }));
  const buttons = [...document.querySelectorAll('button, uni-button, .wd-button, [role=button], [class*=send]')].map(el => ({
    tag: el.tagName, cls: (el.className || '').toString().slice(0, 120), text: (el.innerText || '').trim().slice(0, 30), aria: el.getAttribute('aria-label') || ''
  }));
  return { composerHtml: composer ? composer.outerHTML.slice(0, 1200) : null, inputs, buttons };
})()`);
console.log(JSON.stringify(info, null, 1));
ws.close();
