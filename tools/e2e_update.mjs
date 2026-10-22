// 앱 안 업데이트를 끝까지 돌려본다: 옛 버전 EXE(임시 폴더 복사본)를 띄워 update.check → newer 인지 보고 → update.apply →
// 프로세스가 새 버전으로 다시 뜨는지 확인. 비공개 저장소면 ARCH_CANVAS_GH_TOKEN 이 필요하다.
// 사용: node tools/e2e_update.mjs <옛 EXE 경로> [기대 버전]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const exe = process.argv[2];
const expectVersion = process.argv[3] || null;
if (!exe || !fs.existsSync(exe)) { console.error('옛 EXE 경로를 주십시오'); process.exit(2); }
const PORT = 9336;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` };

async function connect(timeoutMs = 60000) {
  const t0 = Date.now();
  let page = null;
  while (Date.now() - t0 < timeoutMs && !page) {
    await sleep(500);
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((p) => p.type === 'page' && p.url.includes('archcanvas.local')); } catch { /* 아직 */ }
  }
  if (!page) throw new Error('WebView2 페이지를 찾지 못했습니다');
  // 막 끝난 옛 프로세스의 페이지가 아직 목록에 남아 있을 수 있어서, 연결이 바로 닫히면 다시 찾는다
  let ws = null;
  for (let attempt = 0; attempt < 10 && !ws; attempt++) {
    const w = new WebSocket(page.webSocketDebuggerUrl);
    const ok = await new Promise((res) => { w.onopen = () => res(true); w.onerror = () => res(false); w.onclose = () => res(false); setTimeout(() => res(false), 5000); });
    if (ok) ws = w;
    else { await sleep(1000); try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((p) => p.type === 'page' && p.url.includes('archcanvas.local')) || page; } catch { /* */ } }
  }
  if (!ws) throw new Error('디버깅 소켓에 연결하지 못했습니다');
  let seq = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const evaluate = async (expression) => { const id = ++seq; const r = await new Promise((res) => { pending.set(id, res); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval 오류'); return r.result?.result?.value; };
  let ready = false;
  for (let i = 0; i < 240 && !ready; i++) { await sleep(500); try { ready = await evaluate('!!window.__arch && !!window.desktop'); } catch { /* 페이지 전환 중 */ } }
  if (!ready) { const body = await evaluate('document.body ? document.body.innerText.slice(0, 300) : ""').catch(() => ''); throw new Error('앱이 준비되지 않았습니다: ' + body); }
  return { ws, evaluate };
}

// 1) 옛 버전 띄우기
const child = spawn(exe, [], { env, stdio: 'ignore', detached: true });
child.unref();
let c = await connect();
const oldVer = await evaluate0(c, `window.desktop.version || (window.__arch && window.__arch.version) || ''`);
console.log('old app:', oldVer || '(버전 모름)');

// 2) 확인
const info = await evaluate0(c, `window.__arch.update.check()`);
console.log('check:', JSON.stringify({ version: info?.version, current: info?.current, newer: info?.newer, asset: info?.asset?.name }));
if (!info?.newer) { console.log('새 버전이 아니라고 판단했습니다. 끝.'); try { c.ws.close(); } catch { /* */ } process.exit(1); }
if (expectVersion && info.version !== expectVersion) { console.log(`기대 버전 ${expectVersion} 와 다릅니다`); process.exit(1); }

// 3) 적용 → 앱이 스스로 닫히고 배치가 바꿔치기한 뒤 다시 띄운다
const t0 = Date.now();
// 적용이 끝나면 앱이 스스로 닫히므로 답이 안 올 수 있다(소켓이 끊김). 오류 답만 실패로 본다.
let closed = false; c.ws.addEventListener('close', () => { closed = true; });
const applied = await Promise.race([
  c.evaluate(`window.__arch.update.apply().then(r => JSON.stringify(r)).catch(e => 'ERROR ' + (e.message || e))`).catch(() => 'CLOSED'),
  (async () => { for (let i = 0; i < 180 && !closed; i++) await sleep(1000); return closed ? 'CLOSED' : 'TIMEOUT'; })(),
]);
console.log('apply:', applied);
try { c.ws.close(); } catch { /* */ }
if (String(applied).startsWith('ERROR') || applied === 'TIMEOUT') process.exit(1);
// 옛 프로세스가 끝나고 배치가 바꿔치기할 때까지 (디버깅 포트가 닫히고, apply.cmd 가 스스로 지워진다)
for (let i = 0; i < 120; i++) { await sleep(1000); try { await fetch(`http://127.0.0.1:${PORT}/json`); } catch { break; } }
for (let i = 0; i < 60; i++) { await sleep(1000); if (!fs.existsSync(path.join(path.dirname(exe), 'data', 'update', 'apply.cmd'))) break; }
console.log(`old process exited after ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// 4) 새 프로세스: 배치가 start 로 띄우므로 디버깅 포트 환경변수를 물려받지 않는다 → 우리가 직접 다시 띄워서 버전만 확인
await sleep(4000);
const stat = fs.statSync(exe);
console.log('exe replaced:', stat.size, 'bytes, mtime', stat.mtime.toISOString());
// 배치가 띄운 인스턴스를 닫고(같은 프로필 공유 충돌 방지) 디버깅 포트로 다시 띄운다
await new Promise((res) => { const k = spawn('taskkill', ['/IM', 'Arch Canvas.exe', '/F'], { stdio: 'ignore' }); k.on('close', res); });
await sleep(1500);
const child2 = spawn(exe, [], { env, stdio: 'ignore', detached: true });
child2.unref();
c = await connect();
const newVer = await evaluate0(c, `window.desktop.version || ''`);
console.log('new app:', newVer);
try { c.ws.close(); } catch { /* */ }
await new Promise((res) => { const k = spawn('taskkill', ['/IM', 'Arch Canvas.exe', '/F'], { stdio: 'ignore' }); k.on('close', res); });
if (expectVersion && newVer !== expectVersion) { console.log('FAIL: 새 버전이 아닙니다'); process.exit(1); }
console.log('RESULT: PASS');

async function evaluate0(conn, expr) { return conn.evaluate(expr); }
