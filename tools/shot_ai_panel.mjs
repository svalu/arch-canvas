// EXE 를 띄워 AI 패널에서 실제로 한 번 물어보고(연결된 CLI 로) 패널을 PNG 로 찍는다 (UI 확인용).
// 사용: node tools/shot_ai_panel.mjs <exe> <out.png> [그래프.json] [질문]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [exe, out, graphFile, question = 'NAT 게이트웨이를 하나만 두면 어떤 문제가 있습니까? 두 줄로.'] = process.argv.slice(2);
const PORT = 9338; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  await evaluate(`localStorage.setItem('arch-canvas:tour-done','1'); 1`);
  await evaluate('location.reload(); 1'); await sleep(2500);
  for (let i = 0; i < 40 && !(await evaluate('!!window.__arch')); i++) await sleep(500);
  if (graphFile) { const g = JSON.stringify(JSON.parse(fs.readFileSync(graphFile, 'utf8'))); await evaluate(`window.__arch.load(${g}); 1`); await sleep(800); }
  else { await evaluate(`window.__arch.loadTemplate('three-tier-web'); 1`); await sleep(600); }
  await evaluate(`document.querySelector('.toolbar-ai.tour-ai')?.click(); 1`); await sleep(500);
  await evaluate(`document.querySelector('.react-flow__controls-fitview')?.click(); 1`); await sleep(600);
  console.log('settings', await evaluate('JSON.stringify(window.__arch.ai.settings())'));
  await evaluate(`window.__arch.ai.ask(${JSON.stringify(question)}); 1`);
  let st = null;
  for (let i = 0; i < 240; i++) { await sleep(1000); st = await evaluate('JSON.stringify({ busy: window.__arch.ai.state().busy, err: window.__arch.ai.state().error?.message || null, has: !!window.__arch.ai.state().result })'); if (!JSON.parse(st).busy) break; }
  console.log('state', st);
  await sleep(800);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', out);
} finally { try { ws?.close(); } catch { /* */ } child.kill(); }
