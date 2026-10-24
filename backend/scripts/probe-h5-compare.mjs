/** 探测只读比较弹层结构（只读）。 */
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
console.log(JSON.stringify(await evaluate(`(() => {
  const popup = document.querySelector('.ai-knowledge-compare') || document.querySelector('.wd-popup');
  const html = popup ? popup.outerHTML.slice(0, 2500) : null;
  const candidates = [...document.querySelectorAll('uni-view, view')].filter(el => /mm/.test(el.innerText || '') && (el.innerText || '').length < 60)
    .map(el => ({ cls: (el.className || '').toString().slice(0, 90), text: el.innerText.trim(), children: el.children.length }));
  return { hasPopup: Boolean(popup), html, candidates: candidates.slice(0, 15) };
})()`), null, 1));
ws.close();
