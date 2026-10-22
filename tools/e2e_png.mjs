// EXE 를 띄워서 [PNG 복사] 버튼을 실제 마우스 이벤트(CDP Input)로 눌러 클립보드에 PNG 가 들어가는지 본다.
// 사용: node tools/e2e_png.mjs [exe]   → 끝나면 powershell 로 Clipboard.ContainsImage 확인
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.argv[2] || path.join(root, 'release', 'Arch_Canvas_v0.1.0', 'Arch Canvas.exe');
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(exe, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: 'ignore' });
let ws;
try {
  let page = null;
  for (let i = 0; i < 60 && !page; i++) {
    await sleep(500);
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((p) => p.type === 'page' && p.url.includes('archcanvas.local')); } catch { /* */ }
  }
  if (!page) throw new Error('WebView2 페이지를 못 찾았어');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval 오류'); return r.result?.result?.value; };

  for (let i = 0; i < 40 && !(await evaluate('!!window.__arch')); i++) await sleep(500);
  await evaluate(`window.__arch.loadTemplate('three-tier-web')`);
  await sleep(600);
  const rect = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'PNG 복사'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  console.log('button at', rect);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await sleep(2500);
  console.log('toast:', await evaluate(`document.querySelector('.toast')?.innerText || '(없음)'`));
} finally {
  try { ws?.close(); } catch { /* */ }
  child.kill();
  await sleep(500);
}
