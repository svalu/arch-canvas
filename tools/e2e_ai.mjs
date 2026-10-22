// EXE 에서 claude CLI 경로로 AI 를 실제로 돌려본다: cli.detect → 연결 확인(고정 문장) → 3티어 + 제안서 컨텍스트로 검수 → 핀 확인 → 그리기 명령 1개.
// 사용자 Claude 구독 사용량을 조금 쓴다(호출 3번). 사용: node tools/e2e_ai.mjs [exe]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.argv[2] || path.join(root, 'release', 'Arch_Canvas_v0.1.0', 'Arch Canvas.exe');
const PORT = 9335;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(exe, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: 'ignore' });
let ws;
try {
  let page = null;
  for (let i = 0; i < 60 && !page; i++) { await sleep(500); try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((p) => p.type === 'page' && p.url.includes('archcanvas.local')); } catch { /* */ } }
  if (!page) throw new Error('WebView2 페이지를 못 찾았어');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const evaluate = async (expression) => { const id = ++seq; const r = await new Promise((res) => { pending.set(id, res); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval 오류'); return r.result?.result?.value; };
  for (let i = 0; i < 40 && !(await evaluate('!!window.__arch && !!window.desktop')); i++) await sleep(500);

  console.log('cli.detect:', JSON.stringify(await evaluate(`window.desktop.call('cli.detect', {})`)));
  console.log('secret roundtrip:', await evaluate(`(async()=>{ await window.desktop.call('secret.set',{name:'e2e-test',value:'비밀 123'}); const r=await window.desktop.call('secret.get',{name:'e2e-test'}); await window.desktop.call('secret.set',{name:'e2e-test',value:''}); return r.value; })()`));

  // 연결 확인 (고정 문장 1회)
  const t0 = Date.now();
  let ok;
  try {
    ok = await evaluate(`(async()=>{ const r = await window.desktop.call('ai.run', { runId:'v1', system:'짧게 답한다.', user:'연결 확인용입니다. 연결 확인이라고만 짧게 답해주세요.', model:'', timeoutMs:120000 }); return r.text; })()`);
  } catch (e) {
    if (/not logged in|login/i.test(e.message)) {
      console.log('verify: claude CLI 가 로그인돼 있지 않아 (앱에서는 "claude CLI 에 로그인이 안 돼 있어…" 로 안내됨). 터미널에서 `claude` 실행 후 /login 하고 다시 돌려줘.');
      console.log('  raw:', e.message.slice(0, 200));
      ok = null;
    } else throw e;
  }
  if (ok) {
  console.log(`verify (${Date.now() - t0}ms):`, JSON.stringify(ok).slice(0, 200));

  // 설정을 "확인됨" 으로 저장하고 검수
  await evaluate(`window.__arch.ai.setSettings({ provider:'claude-cli', model:'', verified: { 'claude-cli|': { at: Date.now(), reply: ${JSON.stringify(String(ok).slice(0, 50))} } } })`);
  await sleep(300);
  await evaluate(`window.__arch.loadTemplate('three-tier-web')`);
  await sleep(500);
  await evaluate(`window.__arch.ai.setContext({ title:'OO사 온라인 쇼핑몰 재구축 제안', requirements:'- 동시 접속 1만, 이벤트 피크 3배\\n- 서울 리전, 장애 시 30분 내 복구(DR)\\n- 개인정보 암호화 및 WAF 적용 필수\\n- 정적 콘텐츠 CDN 배포\\n- 월 인프라 예산 500만원 이하', constraints:'기존 MySQL 유지, 컨테이너 전환은 2차' })`);
  await sleep(400);
  const t1 = Date.now();
  await evaluate(`window.__arch.ai.review()`);
  let st;
  for (let i = 0; i < 240; i++) { await sleep(1000); st = await evaluate(`JSON.stringify(window.__arch.ai.state())`); if (!JSON.parse(st).busy) break; }
  const s = JSON.parse(st);
  console.log(`review (${Date.now() - t1}ms):`, s.error ? 'ERROR ' + JSON.stringify(s.error) : `${s.result.findings.length} findings, dropped ${s.result.dropped.length}`);
  if (s.result) { console.log('  summary:', s.result.summary); for (const f of s.result.findings) console.log(`  [${f.level}] ${f.target}: ${f.message} — ${f.explain}`); }
  const pins = await evaluate(`window.__arch.graph().annotations.filter(a=>a.id.startsWith('ai-')).length`);
  console.log('  ai pins on graph:', pins);
  fs.writeFileSync(path.join(root, '_dev', 'ai_review.json'), JSON.stringify(s, null, 2));

  // 그리기
  const t2 = Date.now();
  await evaluate(`window.__arch.ai.draw('CloudFront 와 WAF 를 사용자와 ALB 사이에 넣고, 정적 파일용 S3 버킷을 CloudFront 에 연결해줘')`);
  for (let i = 0; i < 240; i++) { await sleep(1000); st = await evaluate(`JSON.stringify(window.__arch.ai.state())`); if (!JSON.parse(st).busy) break; }
  const d = JSON.parse(st);
  console.log(`draw (${Date.now() - t2}ms):`, d.error ? 'ERROR ' + JSON.stringify(d.error) : `${d.result.ops.length} ops — ${d.result.summary}`);
  if (d.result) {
    for (const op of d.result.ops) console.log('  ', JSON.stringify(op));
    await evaluate(`window.__arch.ai.applyOps(${JSON.stringify(d.result.ops)})`);
    await sleep(500);
    const after = JSON.parse(await evaluate(`JSON.stringify(window.__arch.ai.state().result.applied)`));
    console.log('  applied:', after.applied, 'errors:', after.errors.map((e) => e.message), 'blocked:', after.blocked);
    const g = JSON.parse(await evaluate(`JSON.stringify(window.__arch.graph())`));
    console.log(`  graph now: ${g.groups.length} groups, ${g.nodes.length} nodes, ${g.edges.length} edges; lint:`, (await evaluate(`window.__arch.lint().map(v=>v.rule+'@'+v.target).join(', ')`)) || '(없음)');
    fs.writeFileSync(path.join(root, '_dev', 'ai_draw_graph.json'), JSON.stringify(g, null, 2));
  }
  } // if (ok)
} finally {
  try { ws?.close(); } catch { /* */ }
  child.kill();
  await sleep(500);
}
