// EXE 를 띄워 앱 화면을 PNG 로 찍는다 (설명서용). 사용: node tools/shot_app.mjs <exe> <out.png> [template-id] [theme]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [exe, out, tpl = 'three-tier-web', theme = 'light'] = process.argv.slice(2);
const PORT = 9337; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(exe, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: 'ignore' });
let ws;
try {
  let page = null;
  for (let i = 0; i < 60 && !page; i++) { await sleep(500); try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((p) => p.type === 'page' && p.url.includes('archcanvas.local')); } catch { /* */ } }
  if (!page) throw new Error('no page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  for (let i = 0; i < 40 && !(await evaluate('!!window.__arch')); i++) await sleep(500);
  await evaluate(`localStorage.setItem('arch-canvas:tour-done','1'); localStorage.setItem('arch-canvas:view', JSON.stringify({ dots:true, lines:false, strength:35, gap:16, major:true, depth:true, textScale:1, edgeShape:'elbow', edgeArrow:'end', pins:true, guides:true })); 1`);
  await evaluate('location.reload(); 1'); await sleep(2500);
  for (let i = 0; i < 40 && !(await evaluate('!!window.__arch')); i++) await sleep(500);
  await evaluate(`window.__arch.loadTemplate('${tpl}'); 1`); await sleep(400);
  await evaluate(`(function(){ const g = window.__arch.graph(); g.theme = '${theme}'; window.__arch.load(g); })(); 1`); await sleep(900);
  await evaluate(`document.querySelector('.react-flow__controls-fitview')?.click(); 1`); await sleep(900);
  const vp = await evaluate('JSON.stringify([innerWidth, innerHeight])');
  console.log('viewport', vp);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', out);
} finally { try { ws?.close(); } catch { /* */ } child.kill(); }
