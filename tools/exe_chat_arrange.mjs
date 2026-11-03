// EXE 를 띄워 [AI 검수] 를 누른 직후(앞 요청이 도는 중) 채팅칸에 글을 적고 Enter 로 보냈을 때(정렬로 분류)
// 바쁨 표시·결과·오류가 어떻게 가는지 본다. 0.9.36 까지는 앞 요청의 취소가 바쁨 표시를 지워 멈춘 것처럼 보였다.
// 호스트 호출(ai.run/ai.cancel)과 AbortController.abort 의 스택도 찍는다.
// 사용: node tools/exe_chat_arrange.mjs <exe> <graph.json> [말] [out.png]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [exe, graphFile, text = 'ppt에 잘 붙이게 보기 좋게 정렬해줘. 선들도 안꼬이게 목록들 잘 정리해줘', out] = process.argv.slice(2);
const PORT = 9341; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(exe, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: 'ignore' });
let ws;
try {
  let page = null;
  for (let i = 0; i < 60 && !page; i++) { await sleep(500); try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((p) => p.type === 'page' && p.url.includes('archcanvas.local')); } catch { /* */ } }
  if (!page) throw new Error('no page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); const logs = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method === 'Runtime.consoleAPICalled' || d.method === 'Runtime.exceptionThrown') logs.push(JSON.stringify(d.params).slice(0, 300)); };
  const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval error'); return r.result?.result?.value; };
  await send('Runtime.enable');
  for (let i = 0; i < 40 && !(await evaluate('!!window.__arch')); i++) await sleep(500);
  await evaluate(`localStorage.setItem('arch-canvas:tour-done','1'); 1`);
  await evaluate('location.reload(); 1'); await sleep(2500);
  for (let i = 0; i < 40 && !(await evaluate('!!window.__arch')); i++) await sleep(500);
  const g = JSON.stringify(JSON.parse(fs.readFileSync(graphFile, 'utf8')));
  await evaluate(`window.__arch.load(${g}); 1`); await sleep(800);
  await evaluate(`window.__arch.ai.setSettings({ provider: 'claude-cli', model: '', verified: { 'claude-cli|': true } }); 1`); await sleep(300);
  await evaluate(`(() => { const o = window.desktop.call.bind(window.desktop); window.__calls = []; window.__aborts = []; const oa = AbortController.prototype.abort; AbortController.prototype.abort = function (r) { window.__aborts.push(String(new Error().stack).slice(0, 1200)); return oa.call(this, r); }; window.desktop.call = (m, p) => (window.__calls.push([m, p && p.runId, 'call', String(new Error().stack).split(String.fromCharCode(10)).slice(1, 14).join(' | ')]), o(m, p)).then((r) => { window.__calls.push([m, p && p.runId, 'ok', JSON.stringify(r).slice(0, 300)]); return r; }, (e) => { window.__calls.push([m, p && p.runId, 'err', String(e && e.message || e).slice(0, 600)]); throw e; }); return 1; })()`);
  // [AI 검수] 단추: 패널이 열리면서 검수 요청이 먼저 돈다 (앞 요청이 있는 상황)
  await evaluate(`(document.querySelector('.toolbar-ai') || [...document.querySelectorAll('button')].find(b => /AI/.test(b.textContent)))?.click(); 1`); await sleep(800);
  const ta = `document.querySelector('.composer textarea')`;
  if (!(await evaluate(`!!${ta}`))) throw new Error('no composer textarea');
  await evaluate(`(() => { const t = ${ta}; const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })); t.focus(); return 1; })()`);
  await sleep(300);
  await evaluate(`(() => { const t = ${ta}; t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return 1; })()`);
  const snap = () => evaluate(`JSON.stringify({ busy: window.__arch.ai.state().busy, err: window.__arch.ai.state().error && { m: window.__arch.ai.state().error.message, d: String(window.__arch.ai.state().error.detail||'').slice(0,300) }, res: window.__arch.ai.state().result && { mode: window.__arch.ai.state().result.mode, provider: window.__arch.ai.state().result.provider, placed: window.__arch.ai.state().result.placed, blocked: window.__arch.ai.state().result.blocked, summary: (window.__arch.ai.state().result.summary||'').slice(0,160) }, busyEl: !!document.querySelector('.composer .busy'), busyTxt: document.querySelector('.composer .busy')?.textContent || '', sentAs: document.querySelector('.sent-as')?.textContent || '', errCard: document.querySelector('.card.error')?.textContent?.slice(0,200) || '' })`);
  let last = '';
  for (let i = 0; i < 1300; i++) {
    await sleep(500);
    const s = await snap();
    if (s !== last) { console.log(`[${(i / 2).toFixed(1)}s]`, s); last = s; }
    const st = JSON.parse(s);
    if (i > 2 && !st.busy) break;
  }
  console.log('aborts:', await evaluate('JSON.stringify(window.__aborts)'));
  console.log('calls:', await evaluate('JSON.stringify(window.__calls)'));
  if (logs.length) console.log('console:', logs.slice(-20).join('\n'));
  if (out) { await sleep(500); const shot = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64')); console.log('saved', out); }
} finally { try { ws?.close(); } catch { /* */ } child.kill(); }
