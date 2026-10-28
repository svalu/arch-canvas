// 말로 그리기: 막 적으면 → AI 가 상황을 정리하고 부족한 것만 한 개씩 묻고 → 그림을 만들어 보여 주고 → [캔버스에 그리기].
// AWS 를 몰라도 버튼만 따라가면 끝나게. 질문은 최대 3개, 모르면 "잘 모르겠어요" 로 넘어간다.
import React, { useEffect, useRef, useState } from 'react';
import { useExit } from '../useExit.js';
import { Busy } from './ui.jsx';
import { composeDrawRequest } from './prompts.js';
import { DocAttach, readDocFile } from './DocAttach.jsx';

const EXAMPLES = [
  '쇼핑몰 웹사이트를 AWS 에 올리고 싶어. 사람 많을 때도 안 멈추게',
  '내 PC 에서 도는 AI 챗봇을 밖에서도 휴대폰으로 쓰고 싶어',
  '회사 고객센터에 AI 상담을 붙이고 싶어. 기존 시스템이랑 연결해서',
];

export function AiWizard({ open, initialText = '', verified, onOpenConnect, onClarify, onDraw, ai, onApply, onSaveContext, onCancel, onClose, describe, doc, onAttachDoc, onError }) {
  const ex = useExit(open || null, 180);
  const [step, setStep] = useState('write');   // write | thinking | ask | drawing | preview | done
  const [text, setText] = useState('');
  const [plan, setPlan] = useState(null);
  const [qi, setQi] = useState(0);
  const [answers, setAnswers] = useState({});
  const [other, setOther] = useState('');
  const [err, setErr] = useState(null);
  const drawAsked = useRef(false);

  useEffect(() => {
    if (!open) return;
    setStep('write'); setText(initialText || ''); setPlan(null); setQi(0); setAnswers({}); setOther(''); setErr(null); drawAsked.current = false;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // 그림 결과가 오면 미리보기로
  useEffect(() => {
    if (!open || step !== 'drawing' || !drawAsked.current) return;
    if (ai.error) { setErr(ai.error.message); setStep('write'); drawAsked.current = false; return; }
    if (!ai.busy && ai.result?.mode === 'draw') setStep('preview');
  }, [ai, open, step]);

  if (!open && !ex.v) return null;
  const closing = !open;
  const qs = plan?.questions || [];
  const q = qs[qi];
  const total = 1 + qs.length + 1;   // 적기 + 질문들 + 확인
  const at = step === 'write' || step === 'thinking' ? 1 : step === 'ask' ? 2 + qi : total;

  const start = async () => {
    if (!verified) { onOpenConnect(); return; }
    setErr(null); setStep('thinking');
    try {
      const p = await onClarify(text.trim() || '첨부한 문서의 시스템을 AWS 아키텍처로 그려 주세요.');
      if (!p) { setStep('write'); return; }   // 취소
      setPlan(p);
      onSaveContext(p);
      if (p.questions?.length) { setQi(0); setStep('ask'); } else draw(p, {});
    } catch (e) { setErr(e.message || String(e)); setStep('write'); }
  };
  const draw = (p, a) => {
    drawAsked.current = true;
    setStep('drawing');
    onDraw(composeDrawRequest(p, a, text));
  };
  const pick = (opt) => {
    if (!q) return;
    if (q.multi && !/잘 모르겠/.test(opt)) {
      const cur = Array.isArray(answers[q.id]) ? answers[q.id] : [];
      setAnswers({ ...answers, [q.id]: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur.filter((x) => !/잘 모르겠/.test(x)), opt] });
    } else {
      const next = { ...answers, [q.id]: q.multi ? [opt] : opt };
      setAnswers(next);
      if (!q.multi) setTimeout(() => goNext(next), 180);   // 하나만 고르는 질문은 바로 다음으로
    }
  };
  const goNext = (a = answers) => {
    let cur = a;
    if (other.trim() && q) { cur = { ...a, [q.id]: [...(Array.isArray(a[q.id]) ? a[q.id] : a[q.id] ? [a[q.id]] : []), other.trim()] }; setAnswers(cur); }
    setOther('');
    if (qi + 1 < qs.length) setQi(qi + 1); else draw(plan, cur);
  };
  const chosen = (opt) => (Array.isArray(answers[q?.id]) ? answers[q?.id].includes(opt) : answers[q?.id] === opt);
  const r = ai.result?.mode === 'draw' ? ai.result : null;

  return (
    // 바깥을 눌러도 닫지 않는다 (적던 글·고른 답이 날아가지 않게). 닫기는 × 로만
    <div className={'modal-back' + (closing ? ' closing' : '')}>
      <div className="modal wizard" role="dialog" aria-modal="true" aria-labelledby="wz-title">
        <div className="modal-head">
          <h3 id="wz-title">말로 그리기</h3>
          <button className="x" onClick={() => { if (step === 'thinking' || step === 'drawing') onCancel(); onClose(); }} aria-label="닫기">×</button>
        </div>
        <div className="wz-progress" aria-hidden="true">{Array.from({ length: total }, (_, i) => <span key={i} className={i + 1 < at ? 'done' : i + 1 === at ? 'now' : ''} />)}</div>

        {(step === 'write' || step === 'thinking') && (
          <>
            <p className="wz-lead">무엇을 만들고 싶으세요? <b>막 적어도 됩니다.</b> 부족한 건 제가 쉬운 말로 몇 가지만 여쭤볼게요.</p>
            <DocAttach doc={doc} onAttach={onAttachDoc} onError={(m) => setErr(m)} onCopied={onError} />
            {doc && <p className="hint">첨부한 문서를 먼저 읽고 그림을 정리합니다. 아래는 비워 둬도 됩니다.</p>}
            <textarea className="wz-text" autoFocus value={text} onChange={(e) => setText(e.target.value)} disabled={step === 'thinking'}
              onDragOver={(e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) e.preventDefault(); }}
              onDrop={async (e) => { const f = e.dataTransfer?.files?.[0]; if (!f) return; e.preventDefault(); const d = await readDocFile(f, (m) => setErr(m)); if (d) onAttachDoc(d); }}
              placeholder="예: 내 PC 에서 도는 AI 를 밖에서도 휴대폰으로 쓰고 싶어. 비용은 최대한 적게"
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) start(); }} />
            {!text.trim() && !doc && (
              <div className="wz-examples">
                <small className="hint">이런 식으로요 (누르면 채워집니다)</small>
                {EXAMPLES.map((x) => <button key={x} className="chip" onClick={() => setText(x)}>{x}</button>)}
              </div>
            )}
            {err && <p className="modal-err">잘 안 됐어요: {err}</p>}
            <div className="modal-actions">
              {step === 'thinking'
                ? <><div className="modal-wait"><Busy label="읽고 정리하는 중" /></div><button onClick={onCancel}>취소</button></>
                : <button className="primary" disabled={!text.trim() && !doc} onClick={start}>{verified ? '다음' : 'AI 연결하고 시작'}</button>}
            </div>
          </>
        )}

        {step === 'ask' && q && (
          <>
            {qi === 0 && plan?.understood && <p className="wz-understood">{plan.understood}</p>}
            <div className="wz-q">
              <small className="hint">질문 {qi + 1} / {qs.length}</small>
              <p className="wz-question">{q.question}</p>
              {q.why && <p className="hint">{q.why}{q.multi ? ' · 여러 개 골라도 됩니다' : ''}</p>}
              <div className="wz-options">
                {(q.options || []).map((o) => <button key={o} className={'chip big' + (chosen(o) ? ' on' : '')} onClick={() => pick(o)}>{o}</button>)}
              </div>
              <label className="wz-field">
                <span>또는 직접 적기 <small>(선택)</small></span>
                <input value={other} onChange={(e) => setOther(e.target.value)} placeholder="예: 하루 10명 정도, 저녁에만" onKeyDown={(e) => { if (e.key === 'Enter') goNext(); }} />
              </label>
            </div>
            <div className="modal-actions">
              <button onClick={() => (qi ? setQi(qi - 1) : setStep('write'))}>이전</button>
              <button className="link" onClick={() => draw(plan, answers)}>나머지는 알아서 해 주세요</button>
              <button className="primary" onClick={() => goNext()}>{qi + 1 < qs.length ? '다음' : '그림 만들기'}</button>
            </div>
          </>
        )}

        {step === 'drawing' && (
          <>
            <div className="modal-wait"><Busy label="그림 만드는 중 · 1~2분" /></div>
            <p className="hint">다 되면 무엇이 생기는지 먼저 보여 드리고, [캔버스에 그리기]를 눌러야 실제로 그려집니다.</p>
            <div className="modal-actions"><button onClick={() => { onCancel(); setStep(plan?.questions?.length ? 'ask' : 'write'); drawAsked.current = false; }}>취소</button></div>
          </>
        )}

        {step === 'preview' && r && (
          <>
            {r.summary && <p className="summary">{r.summary}</p>}
            {r.ops?.length ? (
              <>
                <small className="hint">이렇게 그립니다 ({r.ops.length}개)</small>
                <ol className="ops wz-ops">{describe(r.ops).map((t, i) => <li key={i}>{t}</li>)}</ol>
              </>
            ) : <p className="hint">바꿀 내용이 없다고 합니다. 이전으로 가서 조금 더 적어 주세요.</p>}
            <div className="modal-actions">
              <button onClick={() => { setStep(qs.length ? 'ask' : 'write'); setQi(Math.max(0, qs.length - 1)); }}>이전</button>
              {r.ops?.length > 0 && <button className="primary" onClick={() => { const res = onApply(r.ops); if (res && !res.blocked) { setStep('done'); } }}>캔버스에 그리기</button>}
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <p className="modal-ok">캔버스에 그렸습니다.</p>
            <p className="hint">마음에 안 들면 Ctrl+Z 로 되돌리고, 고칠 점은 다시 [말로 그리기]에 적으면 됩니다. 예: "NAT 를 하나로 줄여줘"</p>
            <div className="modal-actions"><button className="primary" onClick={onClose}>닫기</button></div>
          </>
        )}
      </div>
    </div>
  );
}

// 의도 되묻기: 질문·검수 전에 AI 가 "이렇게 이해했어요" + 쉬운 질문 몇 개. 답은 앱이 기억해서 다음부터 다시 묻지 않는다.
export function AskBackModal({ data, onSubmit, onSkip, onClose }) {
  const open = !!data;
  const ex = useExit(data || null, 180);
  const d = data || ex.v;
  const [qi, setQi] = useState(0);
  const [answers, setAnswers] = useState({});
  const [other, setOther] = useState('');
  useEffect(() => { if (data) { setQi(0); setAnswers({}); setOther(''); } }, [data]);
  if (!d) return null;
  const qs = d.questions || [];
  const q = qs[qi];
  const finish = (a) => onSubmit(a);
  const goNext = (a = answers) => {
    let cur = a;
    if (other.trim() && q) { cur = { ...a, [q.id]: [...(Array.isArray(a[q.id]) ? a[q.id] : a[q.id] ? [a[q.id]] : []), other.trim()] }; setAnswers(cur); }
    setOther('');
    if (qi + 1 < qs.length) setQi(qi + 1); else finish(cur);
  };
  const pick = (opt) => {
    if (!q) return;
    if (q.multi && !/잘 모르겠/.test(opt)) {
      const cur = Array.isArray(answers[q.id]) ? answers[q.id] : [];
      setAnswers({ ...answers, [q.id]: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt] });
    } else {
      const next = { ...answers, [q.id]: q.multi ? [opt] : opt };
      setAnswers(next);
      if (!q.multi) setTimeout(() => goNext(next), 180);
    }
  };
  const chosen = (opt) => (Array.isArray(answers[q?.id]) ? answers[q?.id].includes(opt) : answers[q?.id] === opt);
  return (
    <div className={'modal-back' + (!open ? ' closing' : '')}>
      <div className="modal wizard" role="dialog" aria-modal="true" aria-labelledby="ab-title">
        <div className="modal-head">
          <h3 id="ab-title">{d.mode === 'review' ? '검수 전에 몇 가지만 여쭤볼게요' : '답하기 전에 몇 가지만 여쭤볼게요'}</h3>
          <button className="x" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="wz-progress" aria-hidden="true">{qs.map((_, i) => <span key={i} className={i < qi ? 'done' : i === qi ? 'now' : ''} />)}</div>
        {qi === 0 && d.understood && <p className="wz-understood">{d.understood}</p>}
        <p className="hint">쓰임새에 따라 답이 크게 달라져서 여쭤봐요. 답해 주신 건 기억해 두고 다시 묻지 않을게요.</p>
        {q && (
          <div className="wz-q" key={q.id}>
            <small className="hint">질문 {qi + 1} / {qs.length}</small>
            <p className="wz-question">{q.question}</p>
            {q.why && <p className="hint">{q.why}{q.multi ? ' · 여러 개 골라도 됩니다' : ''}</p>}
            <div className="wz-options">
              {(q.options || []).map((o) => <button key={o} className={'chip big' + (chosen(o) ? ' on' : '')} onClick={() => pick(o)}>{o}</button>)}
            </div>
            <label className="wz-field">
              <span>또는 직접 적기 <small>(선택)</small></span>
              <input value={other} onChange={(e) => setOther(e.target.value)} placeholder="예: 하루 5명 정도, 보여줄 때만" onKeyDown={(e) => { if (e.key === 'Enter') goNext(); }} />
            </label>
          </div>
        )}
        <div className="modal-actions">
          {qi > 0 && <button onClick={() => setQi(qi - 1)}>이전</button>}
          <button className="link" onClick={onSkip}>그냥 일반적으로 답해 주세요</button>
          <button className="primary" onClick={() => goNext()}>{qi + 1 < qs.length ? '다음' : d.mode === 'review' ? '이대로 검수 받기' : '이대로 답 받기'}</button>
        </div>
      </div>
    </div>
  );
}
