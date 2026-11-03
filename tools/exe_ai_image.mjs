// EXE 를 띄워 그림(PNG)을 붙여 claude CLI 에 질문: 그림을 실제로 보는지 확인. 사용: node tools/exe_ai_image.mjs <exe> <png> [질문]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [exe, png, question = '첨부한 그림에 무엇이 그려져 있습니까? 보이는 서비스 이름 다섯 개만 한 줄로 적어 주세요.'] = process.argv.slice(2);
const PORT = 9341; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  await evaluate(`window.__arch.loadTemplate('three-tier-web'); 1`); await sleep(500);
  await evaluate(`window.__arch.ai.setSettings({ provider: 'claude-cli', model: '', verified: { 'claude-cli|': true } }); 1`); await sleep(300);
  // 큰 그림은 CDP 메시지 한도에 걸리니 조각으로 나눠 넘긴다
  const b64 = fs.readFileSync(png).toString('base64');
  await evaluate('window.__img = ""; 1');
  for (let i = 0; i < b64.length; i += 200000) await evaluate(`window.__img += ${JSON.stringify(b64.slice(i, i + 200000))}; 1`);
  await evaluate(`window.__arch.ai.images([{ name: 'shot.png', dataUrl: 'data:image/png;base64,' + window.__img }]); 1`);
  await evaluate(`window.__arch.ai.ask(${JSON.stringify(question)}); 1`);
  let st = null;
  for (let i = 0; i < 240; i++) { await sleep(1000); st = JSON.parse(await evaluate('JSON.stringify({ busy: window.__arch.ai.state().busy, err: window.__arch.ai.state().error?.message || null, detail: (window.__arch.ai.state().error?.detail||"").slice(0,300), answer: (window.__arch.ai.state().result?.answer || "").slice(0, 400) })')); if (!st.busy) break; }
  console.log(JSON.stringify(st, null, 1));
} finally { try { ws?.close(); } catch { /* */ } child.kill(); }
