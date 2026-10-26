// EXE 를 실제로 띄워서 끝까지 돌려보는 테스트: 템플릿 불러오기 → 노드 추가/연결 → PowerPoint 복사(호스트 브리지) → 그래프 저장.
// WebView2 의 원격 디버깅 포트로 붙어 window.__arch 훅을 호출한다. 그 다음 verify_ppt.ps1 -FromClipboard 로 COM 검증.
// 사용: node tools/e2e_exe.mjs [exe 경로]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.argv[2] || path.join(root, 'release', 'Arch_Canvas_v0.1.0', 'Arch Canvas.exe');
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(exe, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: 'ignore', detached: false });
let ws;
try {
  let page = null;
  for (let i = 0; i < 60 && !page; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      page = list.find((p) => p.type === 'page' && p.url.includes('archcanvas.local'));
    } catch { /* 아직 안 뜸 */ }
  }
  if (!page) throw new Error('WebView2 페이지를 못 찾았어 (원격 디버깅 포트 ' + PORT + ')');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const evaluate = async (expression) => {
    const id = ++seq;
    const r = await new Promise((res) => { pending.set(id, res); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); });
    if (r.result?.exceptionDetails) throw new Error('페이지 오류: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
  };

  for (let i = 0; i < 40 && !(await evaluate('!!window.__arch && !!window.desktop')); i++) await sleep(500);
  if (!(await evaluate('!!window.__arch'))) throw new Error('앱이 준비되지 않았어 (__arch 없음)');
  console.log('app ready, desktop bridge:', await evaluate('window.desktop.version'));
  // 의견 보내기 경로(Web3Forms)가 EXE 안에서 막히지 않는지: 틀린 키로 보내 메일은 안 가고 응답만 받는다
  console.log('feedback endpoint:', await evaluate(`fetch('https://api.web3forms.com/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ access_key: '00000000-0000-0000-0000-000000000000', message: 'e2e' }) }).then(async (r) => 'HTTP ' + r.status + ' ' + JSON.stringify(await r.json()).slice(0, 80)).catch((e) => 'BLOCKED ' + e.message)`));

  await evaluate(`window.__arch.loadTemplate('three-tier-web')`);
  await sleep(400);
  const patch = await evaluate(`JSON.stringify(window.__arch.patch([
    { op: 'add_node', id: 'cache', icon: 'Arch_Amazon-ElastiCache', label: 'ElastiCache', parent: 'app-b', x: 60, y: 60 },
    { op: 'connect', source: 'web-b', target: 'cache', shape: 'elbow' }
  ]).errors)`);
  console.log('patch errors:', patch);
  await sleep(400);
  const g = await evaluate('JSON.stringify(window.__arch.graph())');
  const graph = JSON.parse(g);
  console.log(`graph: ${graph.groups.length} groups, ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
  fs.mkdirSync(path.join(root, '_dev'), { recursive: true });
  fs.writeFileSync(path.join(root, '_dev', 'e2e_graph.json'), JSON.stringify(graph, null, 2));
  await evaluate('window.__arch.copyAll()');
  await sleep(800);   // 호스트가 클립보드에 쓸 시간
  console.log('copyAll sent');
} finally {
  try { ws?.close(); } catch { /* */ }
  child.kill();
  await sleep(500);
}
