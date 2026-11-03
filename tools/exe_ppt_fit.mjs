// EXE 를 띄워 큰 그래프를 넣고 PowerPoint 복사(장표 맞춤 축소)를 한 뒤, 장면 크기와 축소율을 찍고 장면 JSON 을 남긴다.
// 그 다음 tools/verify_ppt.ps1 -Scene <out.json> -FromClipboard 로 클립보드와 맞춰 본다.
// 사용: node tools/exe_ppt_fit.mjs <exe> <graph.json> <out_scene.json> [fit=1|0]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [exe, graphFile, out, fitArg = '1'] = process.argv.slice(2);
const PORT = 9343; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval error'); return r.result?.result?.value; };
  for (let i = 0; i < 40 && !(await evaluate('!!window.__arch')); i++) await sleep(500);
  await evaluate(`localStorage.setItem('arch-canvas:tour-done','1'); const v = JSON.parse(localStorage.getItem('arch-canvas:view') || '{}'); v.pptFit = ${fitArg === '1'}; localStorage.setItem('arch-canvas:view', JSON.stringify(v)); 1`);
  await evaluate('location.reload(); 1'); await sleep(2500);
  for (let i = 0; i < 40 && !(await evaluate('!!window.__arch')); i++) await sleep(500);
  const g = JSON.stringify(JSON.parse(fs.readFileSync(graphFile, 'utf8')));
  await evaluate(`window.__arch.load(${g}); 1`); await sleep(800);
  const scene = await evaluate('JSON.stringify(window.__arch.scene())');
  fs.writeFileSync(out, scene);
  const sc = JSON.parse(scene);
  const minSz = Math.min(...sc.shapes.filter((s) => s.text).map((s) => s.text.sz));
  console.log(`scene ${(sc.width / 360000).toFixed(1)}×${(sc.height / 360000).toFixed(1)}cm · shapes ${sc.shapes.length} · 가장 작은 글자 ${(minSz / 100).toFixed(1)}pt · box 31.9×15.65cm`);
  await evaluate('window.__arch.copyAll()'); await sleep(1200);
  console.log('toast:', await evaluate(`[...document.querySelectorAll('.toast, [role=status]')].map(e => e.textContent).join(' | ').slice(0, 300)`));
} finally { try { ws?.close(); } catch { /* */ } child.kill(); }
