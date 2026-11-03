// EXE 를 띄워 그래프를 넣고 .pptx 로 저장한 뒤(대화상자 없이 path 로) 장면 JSON 도 남긴다. 그 다음 tools/verify_pptx.ps1 로 PowerPoint 에서 열어 본다.
// 사용: node tools/exe_pptx.mjs <exe> <graph.json> <out.pptx> <out_scene.json>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [exe, graphFile, outPptx, outScene] = process.argv.slice(2);
const PORT = 9345; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  await evaluate(`localStorage.setItem('arch-canvas:tour-done','1'); 1`);
  await evaluate('location.reload(); 1'); await sleep(2500);
  for (let i = 0; i < 40 && !(await evaluate('!!window.__arch')); i++) await sleep(500);
  const g = JSON.stringify(JSON.parse(fs.readFileSync(graphFile, 'utf8')));
  await evaluate(`window.__arch.load(${g}); 1`); await sleep(800);
  fs.writeFileSync(outScene, await evaluate('JSON.stringify(window.__arch.scene())'));
  const r = await evaluate(`window.__arch.savePptx(${JSON.stringify(outPptx)}).then((x) => JSON.stringify(x))`);
  console.log('saved:', r);
  await sleep(500);
  console.log('toast:', await evaluate(`[...document.querySelectorAll('.toast, [role=status]')].map(e => e.textContent).join(' | ').slice(0, 300)`));
} finally { try { ws?.close(); } catch { /* */ } child.kill(); }
