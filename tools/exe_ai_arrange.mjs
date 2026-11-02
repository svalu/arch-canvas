// EXE 를 띄워 그래프를 넣고 AI 정렬(claude CLI)을 눌러 자리가 바뀌는지 본다. 사용: node tools/exe_ai_arrange.mjs <exe> <graph.json> [out.png]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [exe, graphFile, out] = process.argv.slice(2);
const PORT = 9339; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  await evaluate(`window.__arch.ai.setSettings({ provider: 'claude-cli', model: '', verified: { 'claude-cli|': true } }); 1`); await sleep(300);
  console.log('settings', await evaluate('JSON.stringify(window.__arch.ai.settings())'));
  const pos = () => evaluate(`JSON.stringify(window.__arch.graph().groups.filter(x=>!x.parent).map(x=>[x.id,x.x,x.y]))`);
  const before = await pos();
  await evaluate(`window.__arch.ai.arrange(); 1`);
  let st = null;
  for (let i = 0; i < 240; i++) { await sleep(1000); st = JSON.parse(await evaluate('JSON.stringify({ busy: window.__arch.ai.state().busy, err: window.__arch.ai.state().error?.message || null, res: window.__arch.ai.state().result && { mode: window.__arch.ai.state().result.mode, placed: window.__arch.ai.state().result.placed, blocked: window.__arch.ai.state().result.blocked, summary: (window.__arch.ai.state().result.summary||"").slice(0,120) } })')); if (!st.busy) break; }
  console.log('state', JSON.stringify(st));
  await sleep(800);
  const after = await pos();
  console.log('before', before); console.log('after ', after);
  console.log('changed:', before !== after);
  if (out) { await evaluate(`document.querySelector('.react-flow__controls-fitview')?.click(); 1`); await sleep(600); const shot = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64')); console.log('saved', out); }
} finally { try { ws?.close(); } catch { /* */ } child.kill(); }
