// 가이드: 단계 카드를 하나씩 보여주며 다이어그램을 쌓아 간다. 단계 데이터는 data/guide.json.
// 흐름: 뭘 만들지 고르기 → 요건 체크 → (조건에 맞는) 넣기 카드들 → 규칙 검사 → AI 검수 → 내보내기
import React, { useMemo, useState } from 'react';
import { Icon } from '../Icons.jsx';
import guide from '../../data/guide.json' with { type: 'json' };

export const GUIDE = guide;
const LS = 'arch-canvas:guide';

export const emptyGuide = () => ({ phase: 'kind', kind: null, flags: Object.fromEntries(guide.flags.map((f) => [f.id, !!f.default])), idx: 0, done: {}, visited: {} });
export function loadGuide() { try { const s = JSON.parse(localStorage.getItem(LS) || 'null'); return s && s.phase ? { ...emptyGuide(), ...s } : null; } catch { return null; } }
export function saveGuide(s) { try { if (s) localStorage.setItem(LS, JSON.stringify(s)); else localStorage.removeItem(LS); } catch { /* */ } }

const matches = (when, st) => !when || ((!when.kind || when.kind.includes(st.kind)) && (!when.flag || !!st.flags[when.flag]));
export const visibleSteps = (st) => guide.steps.filter((s) => matches(s.when, st));
export const opsFor = (step, st) => (step.ops || []).filter((o) => matches(o.when, st)).map(({ when, ...o }) => o);

export function GuidePanel({ state, setState, isEmpty, graphIds = new Set(), onLoadTemplate, onApplyOps, violations, onShowRules, onAiReview, aiReady, aiBusy, onExport, onSetContext, onClose, onPick }) {
  const st = state;
  const steps = useMemo(() => visibleSteps(st), [st.kind, st.flags]); // eslint-disable-line react-hooks/exhaustive-deps
  const [result, setResult] = useState(null);
  const update = (patch) => setState({ ...st, ...patch });

  // ---- 1. 뭘 만들까 ----
  if (st.phase === 'kind') {
    return (
      <div className="insp guide">
        <Head title="가이드" sub="순서대로 버튼만 누르면 제안서용 아키텍처가 만들어집니다. 각 단계에 그렇게 하는 이유도 적혀 있습니다." onClose={onClose} />
        <h4>무엇을 만드시겠습니까?</h4>
        {!isEmpty && <p className="warn">지금 그리던 다이어그램은 템플릿으로 바뀝니다 (되돌리기 가능).</p>}
        {guide.kinds.map((k) => (
          <button key={k.id} className="choice" onClick={() => { onLoadTemplate(k.template); update({ phase: 'flags', kind: k.id }); }}>
            <b>{k.name}</b><small>{k.desc}</small>
          </button>
        ))}
      </div>
    );
  }

  // ---- 2. 요건 체크 ----
  if (st.phase === 'flags') {
    const kindName = guide.kinds.find((k) => k.id === st.kind)?.name;
    return (
      <div className="insp guide">
        <Head title="가이드 · 요건 체크" sub={`${kindName} 뼈대를 넣었습니다. 요건서에 있는 것만 체크합니다. 체크에 따라 다음 카드가 달라집니다.`} onClose={onClose} />
        {guide.flags.map((f) => (
          <label key={f.id} className="flag">
            <input type="checkbox" checked={!!st.flags[f.id]} onChange={(e) => update({ flags: { ...st.flags, [f.id]: e.target.checked } })} />
            <span><b>{f.name}</b><small>{f.note}</small></span>
          </label>
        ))}
        <div className="row">
          <button onClick={() => update({ phase: 'kind' })}>이전</button>
          <button className="primary" onClick={() => {
            const on = guide.flags.filter((f) => st.flags[f.id]).map((f) => f.name);
            onSetContext({ constraints: on.length ? '가이드 체크: ' + on.join(', ') : '' });
            update({ phase: 'steps', idx: 0, visited: { 0: true } });
          }}>시작</button>
        </div>
      </div>
    );
  }

  // ---- 3. 단계 카드 ----
  const idx = Math.min(st.idx, steps.length - 1);
  const step = steps[idx];
  const go = (i) => { setResult(null); update({ idx: i, visited: { ...st.visited, [i]: true } }); };
  const next = () => (idx + 1 < steps.length ? go(idx + 1) : update({ phase: 'done' }));
  const prev = () => (idx > 0 ? go(idx - 1) : update({ phase: 'flags' }));
  const ops = step.kind ? [] : opsFor(step, st);
  // 넣은 뒤 되돌리기로 지웠으면 다시 '넣기'를 할 수 있게: 넣은 것이 지금 그림에 남아 있을 때만 완료로 본다
  const madeIds = ops.filter((o) => (o.op === 'add_node' || o.op === 'add_group' || o.op === 'add_card') && o.id).map((o) => String(o.id));
  const done = !!st.done[step.id] && (!madeIds.length || madeIds.every((id) => graphIds.has(id)));

  if (st.phase === 'done') {
    return (
      <div className="insp guide">
        <Head title="가이드 · 완료" sub="완료되었습니다. 라벨을 프로젝트에 맞는 이름으로 바꾸고, 더 필요한 것은 팔레트에서 끌어다 넣으십시오." onClose={onClose} />
        <div className="row">
          <button onClick={() => { setState({ ...emptyGuide() }); }}>처음부터</button>
          <button className="primary" onClick={onClose}>캔버스로</button>
        </div>
      </div>
    );
  }

  return (
    <div className="insp guide">
      <Head title={`가이드 · ${idx + 1} / ${steps.length}`} onClose={onClose} />
      <div className="dots">
        {steps.map((s, i) => (
          <button key={s.id} className={'dot' + (i === idx ? ' on' : '') + (st.done[s.id] ? ' done' : '')} disabled={!st.visited[i] && i > idx} onClick={() => go(i)} title={s.title}>{i + 1}</button>
        ))}
      </div>
      <div className="card-swap" key={step.id}>
      <h3>{step.title}</h3>
      <p className="why">{step.why}</p>
      {step.tip && st.flags[step.tip.flag] && <p className="tip"><Icon name="tip" size={14} /> {step.tip.text}</p>}

      {!step.kind && (
        <>
          {ops.length > 0 && (
            <ul className="ops-preview">
              {ops.filter((o) => o.op === 'add_node' || o.op === 'add_group').map((o, i) => <li key={i}>{o.label}</li>)}
              {ops.some((o) => o.op === 'connect') && <li>연결선 {ops.filter((o) => o.op === 'connect').length}개</li>}
            </ul>
          )}
          {result && <p className={result.ok ? 'ok' : 'warn'}>{result.text}</p>}
          <div className="row">
            <button onClick={prev}>이전</button>
            {ops.length > 0 && !done && (
              <button className="primary" onClick={() => {
                const r = onApplyOps(ops);
                if (r.blocked) { setResult({ ok: false, text: '규칙 검사에서 차단되었습니다. 화면의 설명을 확인하십시오.' }); return; }
                setResult({ ok: !r.errors.length, text: r.errors.length ? `${r.applied}개 적용, ${r.errors.length}개 실패: ${r.errors.map((e) => e.message).join('; ')}` : `넣었습니다 · ${r.applied}개` });
                update({ done: { ...st.done, [step.id]: true }, visited: { ...st.visited, [idx]: true } });
              }}>넣기</button>
            )}
            <button className={done || !ops.length ? 'primary' : ''} onClick={next}>{done || !ops.length ? '다음' : '건너뛰기'}</button>
          </div>
        </>
      )}

      {step.kind === 'rules' && (
        <>
          {violations.length ? (
            <>
              <p className="warn">규칙에 걸린 항목이 {violations.length}건 있습니다. 클릭하면 해당 요소가 선택됩니다.</p>
              {violations.slice(0, 6).map((v, i) => (
                <div key={i} className={'pin-row card ' + (v.severity === 'block' ? 'error' : v.severity)} onClick={() => onPick(v.target)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(v.target); } }} role="button" tabIndex={0}>
                  <b>{v.severity === 'block' ? '차단' : '경고'}</b> {v.message}<p className="explain">{v.explain}</p>
                </div>
              ))}
              {violations.length > 6 && <button className="link" onClick={onShowRules}>전체 {violations.length}건 보기</button>}
            </>
          ) : <p className="ok">규칙에 걸리는 항목이 없습니다.</p>}
          <div className="row"><button onClick={prev}>이전</button><button className="primary" onClick={next}>다음</button></div>
        </>
      )}

      {step.kind === 'ai' && (
        <>
          <p className="hint">{aiReady ? 'AI 가 연결돼 있습니다. 요건서(제안서 컨텍스트)는 [AI] 패널에서 넣을 수 있습니다.' : '아직 AI 연결이 안 됐습니다. 누르면 연결 과정부터 시작합니다.'}</p>
          <div className="row">
            <button onClick={prev}>이전</button>
            <button className="primary" disabled={!!aiBusy} onClick={onAiReview}>{aiBusy ? '검수 중…' : 'AI 검수 받기'}</button>
            <button onClick={next}>건너뛰기</button>
          </div>
        </>
      )}

      {step.kind === 'export' && (
        <>
          <div className="row">
            <button className="primary" onClick={() => onExport('clipboard')}>PNG 복사</button>
            <button onClick={() => onExport('png')}>PNG 저장</button>
            <button onClick={() => onExport('svg')}>SVG 저장</button>
          </div>
          <div className="row"><button onClick={prev}>이전</button><button className="primary" onClick={next}>끝내기</button></div>
        </>
      )}
      </div>
    </div>
  );
}

function Head({ title, sub, onClose }) {
  return (
    <div className="guide-head">
      <div><h3>{title}</h3>{sub && <p className="hint">{sub}</p>}</div>
      <button className="small" onClick={onClose} title="가이드 닫기 (진행 상태는 남습니다)">닫기</button>
    </div>
  );
}
