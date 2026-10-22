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
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const evaluate = async (expression) => { const id = ++seq; const r = await new Promise((res) => { pending.set(id, res); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval 오류'); return r.result?.result?.value; };
  for (let i = 0; i < 60 && !(await evaluate('!!window.__arch && !!window.desktop')); i++) await sleep(500);
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
c.evaluate(`window.__arch.update.apply()`).catch(() => {});
try { c.ws.close(); } catch { /* */ }
// 옛 프로세스가 끝날 때까지 (디버깅 포트가 닫힘)
for (let i = 0; i < 120; i++) { await sleep(1000); try { await fetch(`http://127.0.0.1:${PORT}/json`); } catch { break; } }
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
