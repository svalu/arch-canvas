// EXE 안에서 codex CLI 연결 확인: cli.detect 결과와 ai.run(tool:'codex') 짧은 왕복 한 번.
// 사용: node tools/e2e_codex.mjs <exe 경로>   (이 PC 에 codex 가 설치·로그인돼 있어야 함)
import { spawn } from 'node:child_process';

const exe = process.argv[2];
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(exe, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: 'ignore' });
try {
  let page;
  for (let i = 0; i < 60 && !page; i++) {
    await sleep(500);
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch { /* 아직 */ }
  }
  if (!page) throw new Error('WebView2 페이지를 못 찾았어');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let n = 0; const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); });
  const evaluate = async (expression) => {
    const id = ++n;
    const r = await new Promise((res) => { pending.set(id, res); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  };
  for (let i = 0; i < 40 && !(await evaluate('!!window.desktop')); i++) await sleep(500);
  const det = await evaluate(`window.desktop.call('cli.detect', {})`);
  console.log('detect claude:', det.found, '| codex:', JSON.stringify(det.codex));
  const t0 = Date.now();
  const r = await evaluate(`window.desktop.call('ai.run', { runId: 'e2ecodex', tool: 'codex', system: '한 단어로만 답한다.', user: '연결 확인용입니다. "연결 확인" 이라고만 답하세요.', model: '', timeoutMs: 180000 }).then(x => x, e => ({ error: String(e && e.message || e) }))`);
  console.log('codex run (' + (Date.now() - t0) + 'ms):', JSON.stringify({ text: r.text, error: r.error }).slice(0, 300));
  // 실제 그리기 한 번: 빈 캔버스에 짧은 요청 → 노드가 생기는지
  if (process.argv.includes('--draw')) {
    await evaluate(`window.__arch.ai.setSettings({ provider: 'codex-cli', model: '', verified: { 'codex-cli|': { at: Date.now() } } })`);
    await sleep(500);
    const t1 = Date.now();
    await evaluate(`window.__arch.ai.draw('정적 웹사이트: S3 에 올리고 CloudFront 로 배포')`);
    let st;
    for (let i = 0; i < 200; i++) { await sleep(1500); st = await evaluate(`JSON.stringify(window.__arch.ai.state())`); const j = JSON.parse(st); if (j.result || j.error) break; }
    const j = JSON.parse(st);
    if (j.error) console.log('draw error:', JSON.stringify(j.error).slice(0, 300));
    const ops = j.result?.ops || [];
    console.log('draw (' + Math.round((Date.now() - t1) / 1000) + 's): ops =', ops.length, '| summary:', String(j.result?.summary || '').slice(0, 80));
    if (ops.length) { await evaluate(`window.__arch.ai.applyOps(${JSON.stringify(ops)})`); await sleep(800); console.log('applied: nodes =', await evaluate(`window.__arch.graph().nodes.length`), 'groups =', await evaluate(`window.__arch.graph().groups.length`)); }
  }
  ws.close();
} finally {
  child.kill();
}
