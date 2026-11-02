// AI 패널을 서버 렌더로 그려 본다(실제 AI 없이): 질문·그림·검수 결과 카드와 기록이 깨지지 않고 나오는지.
// 사용: npx esbuild tools/render_ai_panel.jsx --bundle --platform=node --format=cjs --outfile=_dev/render_ai_panel.cjs --loader:.js=jsx --define:process.env.NODE_ENV='"production"' --external:react --external:react-dom && node _dev/render_ai_panel.cjs
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiPanel } from '../src/ai/ui.jsx';

const base = {
  context: { title: 'NACS', requirements: '- 서울 리전\n- [확인] 사용 인원 300명', constraints: '', doc: { name: 'NACS.md', text: 'x'.repeat(3000) }, log: [{ k: 'draw', q: '그려 줘', a: '그렸음', t: 1 }, { k: 'ask', q: 'NAT 하나면?', a: '단일 장애점', t: 2 }] },
  onContext() {}, settings: { provider: 'claude-cli', model: '' }, verified: true, onOpenConnect() {},
  onReview() {}, onAsk() {}, onAskSelection() {}, onFixFromAnswer() {}, onApplyOps() {}, onCancel() {}, onPick() {}, nameOf: (id) => id, activeDocId: 'd1', onWizard() {}, onAttachDoc() {}, onToast() {}, onRate() {},
};
const cases = {
  idle: { state: { busy: null, result: null, error: null }, selection: { count: 0 } },
  selected: { state: { busy: null, result: null, error: null }, selection: { count: 3 } },
  busy: { state: { busy: 'ask', result: null, error: null }, selection: { count: 0 } },
  ask: { state: { busy: null, result: { mode: 'ask', question: 'NAT 하나면?', answer: '**단일 장애점**이 됩니다.\n둘째 줄', provider: 'Claude CLI', ms: 3200, docId: 'd1', understood: '가용성 질문' }, error: null }, selection: { count: 0 } },
  draw: { state: { busy: null, result: { mode: 'draw', request: '줄 맞춰', summary: '두 개 옮김', ops: [{ op: 'move', id: 'a', x: 1, y: 2 }], provider: 'Claude CLI', ms: 9000, docId: 'd1' }, error: null }, selection: { count: 0 } },
  drawApplied: { state: { busy: null, result: { mode: 'draw', request: '줄 맞춰', summary: '두 개 옮김', ops: [{ op: 'move', id: 'a', x: 1, y: 2 }], applied: { applied: 1, errors: [] }, provider: 'Claude CLI', ms: 9000, docId: 'd1' }, error: null }, selection: { count: 0 } },
  review: { state: { busy: null, result: { mode: 'review', summary: '대체로 좋음', findings: [{ id: 'f1', level: 'warn', target: 'alb', message: 'NAT 단일', explain: '…' }], dropped: [], provider: 'Claude CLI', ms: 5000, docId: 'd1' }, error: null }, selection: { count: 0 } },
  arrange: { state: { busy: null, result: { mode: 'arrange', summary: '입구를 왼쪽에, 사내를 오른쪽에', placed: 12, provider: 'Claude CLI', ms: 40000, docId: 'd1' }, error: null }, selection: { count: 0 } },
  arrangeBusy: { state: { busy: 'arrange', result: null, error: null }, selection: { count: 0 } },
  error: { state: { busy: null, result: null, error: { message: '실패했어요', kind: 'auth' } }, selection: { count: 0 } },
  other: { state: { busy: null, result: { mode: 'ask', question: 'q', answer: 'a', provider: 'x', docId: 'd2', docTitle: '다른 탭' }, error: null }, selection: { count: 0 } },
};
let bad = 0;
for (const [name, extra] of Object.entries(cases)) {
  try {
    const html = renderToStaticMarkup(React.createElement(AiPanel, { ...base, ...extra }));
    const must = { idle: ['전체 그림', '그리기·고치기', '대화'], selected: ['선택한 3개'], busy: ['생각 중', '취소'], ask: ['단일 장애점', '이 답변대로 그림 고치기', '3.2s', '이렇게 이해했어요'], draw: ['캔버스에 그리기', '아직 캔버스에 안 그려짐'], drawApplied: ['캔버스에 그렸습니다 · 1개'], review: ['NAT 단일', '지적 1건'], error: ['실패했어요', '연결 다시 하기'], arrange: ['입구를 왼쪽에', '12개', 'Ctrl+Z'], arrangeBusy: ['배치안 정하는 중'], other: ['다른 탭', '탭에서 요청'] }[name];
    const miss = must.filter((m) => !html.includes(m));
    // 기록 중복: ask 케이스는 기록의 "NAT 하나면?" 줄이 숨어야 한다 (지금 결과와 같은 것)
    const dup = name === 'ask' && (html.match(/NAT 하나면\?/g) || []).length !== 1;
    console.log(`${miss.length || dup ? '✗' : '✓'} ${name.padEnd(12)} ${html.length} chars${miss.length ? ' 빠짐: ' + miss.join(', ') : ''}${dup ? ' 기록 중복' : ''}`);
    if (miss.length || dup) bad++;
  } catch (e) { bad++; console.log('✗', name, e.message); }
}
process.exitCode = bad ? 1 : 0;
