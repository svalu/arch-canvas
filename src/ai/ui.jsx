// AI 연결 모달 + AI 패널. 연결 UX 는 "누른 자리에서 시작 → 방식 고르기 → 실제 응답 확인 → 하던 일로 복귀" (곁말 연결 가이드).
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icons.jsx';
import { useExit } from '../useExit.js';
import { PROVIDERS, providerById as providerByIdBase, detectCli, MOCK_PROVIDER, mockEnabled } from './providers.js';
import { DocAttach } from './DocAttach.jsx';
import { BridgeSetup } from './BridgeSetup.jsx';

const providerById = (id) => (id === 'mock' ? MOCK_PROVIDER : providerByIdBase(id));
const providerList = () => (mockEnabled() ? [...PROVIDERS, MOCK_PROVIDER] : PROVIDERS);
import { getKey, setKey, verifyConnection, verifyKey, isVerified } from './connection.js';

// 기다리는 동안 버튼 안에서 도는 스피너 + 물결치는 점 세 개
export const Busy = ({ label }) => (
  <span className="busy" role="status" aria-live="polite">
    <span className="busy-spin" aria-hidden="true" />
    <span>{label}</span>
    <span className="busy-dots" aria-hidden="true"><i /><i /><i /></span>
  </span>
);

const ACTION_LABEL = { review: '검수 받기', draw: '그려달라고 하기' };

// 툴바 칩: 지금 어떤 AI 가 연결돼 있는지 한눈에. 누르면 연결 모달.
export const SHORT_NAME = { 'claude-cli': 'Claude CLI', 'codex-cli': 'ChatGPT CLI', 'claude-api': 'Claude', 'openai-api': 'GPT', mock: 'Mock' };
export function AiChip({ settings, onClick }) {
  const p = providerById(settings.provider);
  const on = isVerified(settings);
  const name = p ? SHORT_NAME[p.id] || p.name : null;
  const model = p?.models.find((m) => m.id === settings.model)?.name || settings.model || '';
  const title = on ? `연결됨: ${p.name}${model ? ' · ' + model : ''} — 누르면 바꿀 수 있습니다` : '연결된 AI 가 없습니다. 누르면 연결합니다';
  return (
    <button className={'tb ai-chip has-lbl' + (on ? ' on' : ' off')} data-p="2" onClick={onClick} title={title} aria-label={title}>
      <span className={'ai-dot' + (on ? ' on' : '')} aria-hidden="true" />
      <span className="lbl" data-p="2">{on ? name : 'AI 연결'}</span>
    </button>
  );
}

const STEPS = [
  { id: 'pick', title: '방식 선택', hint: '어떤 AI 를 쓸지 고릅니다' },
  { id: 'setup', title: '설정', hint: '모델과 키를 넣습니다' },
  { id: 'test', title: '연결 확인', hint: '짧은 문장 하나로 답이 오는지 봅니다' },
  { id: 'done', title: '완료', hint: '하던 일로 돌아갑니다' },
];
const TIPS = {
  'claude-cli': ['이 PC 에 설치된 claude 명령을 그대로 씁니다. 키를 넣을 필요가 없습니다.', '처음이면 터미널에서 claude auth login 을 한 번 실행해 두어야 합니다.', '비용은 현재 Claude 구독 사용량으로 계산됩니다.'],
  'codex-cli': ['이 PC 에 설치된 codex 명령(OpenAI Codex CLI)을 그대로 씁니다. 키를 넣을 필요가 없습니다.', '처음이면 터미널에서 npm i -g @openai/codex 로 설치하고 codex login 으로 ChatGPT 계정에 로그인해 두어야 합니다.', '비용은 ChatGPT 구독 사용량으로 계산됩니다.'],
  'claude-api': ['console.anthropic.com 에서 키를 만들어 붙여 넣습니다. 키는 sk-ant- 로 시작합니다.', '키는 이 PC 에만 저장되고 서버로 보내지 않습니다.', '호출마다 토큰 비용이 듭니다. 검수 한 번은 보통 수천 토큰입니다.'],
  'openai-api': ['platform.openai.com 에서 API 키를 만듭니다. ChatGPT 구독과는 별개입니다.', '키는 이 PC 에만 저장됩니다.', '호출마다 토큰 비용이 듭니다.'],
  mock: ['모델을 부르지 않고 정해진 답을 돌려줍니다. 화면 확인용입니다.'],
};
const ERROR_HINT = (e, p) => {
  const m = String(e?.message || '').toLowerCase();
  if (/401|invalid.*key|authentication|unauthorized|api key/.test(m)) return '키가 틀렸거나 만료됐습니다. 이전 단계로 돌아가 키를 다시 넣어 보세요.';
  if (/not logged in|login|auth/.test(m) && p?.id === 'claude-cli') return '터미널에서 claude auth login 을 실행해 로그인한 뒤 다시 시도하세요.';
  if (/not logged in|login|auth|401|unauthorized/.test(m) && p?.id === 'codex-cli') return '터미널에서 codex login 을 실행해 ChatGPT 계정으로 로그인한 뒤 다시 시도하세요.';
  if (/429|rate|quota|credit|billing/.test(m)) return '사용량 한도나 결제 문제입니다. 해당 서비스의 결제 상태를 확인하세요.';
  if (/network|fetch|enotfound|timeout|timed out|econn/.test(m)) return '네트워크가 막혀 있을 수 있습니다. 프록시나 방화벽을 확인하세요.';
  if (/model|not found|404/.test(m)) return '모델 이름이 맞지 않습니다. 이전 단계에서 다른 모델을 골라 보세요.';
  return null;
};

export function ConnectModal({ open, pending, settings, onSettings, onClose, onReady }) {
  const isDesktop = !!window.desktop?.call;
  const [step, setStep] = useState(0);                 // 0 pick | 1 setup | 2 test | 3 done
  const [phase, setPhase] = useState('idle');          // test 단계 안: idle | testing | failed
  const [provider, setProvider] = useState(settings.provider || '');
  const [model, setModel] = useState(settings.model || '');
  const [keyInput, setKeyInput] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [cli, setCli] = useState(null);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const gen = useRef(0);
  const abortRef = useRef(null);
  const p = providerById(provider);

  useEffect(() => {
    if (!open) return;
    setStep(0); setPhase('idle'); setError(null); setOk(null); setShowDetail(false); setShowKey(false);
    setProvider(settings.provider || ''); setModel(settings.model || '');
    detectCli().then((r) => {
      setCli(r);
      if (!settings.provider) { const def = r.found ? 'claude-cli' : r.codex?.found && r.codex.loggedIn !== false ? 'codex-cli' : 'claude-api'; setProvider(def); setModel(providerById(def).models[0].id); }
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !p) return;
    setKeyInput('');
    if (p.needsKey) getKey(p.id).then((k) => setHasKey(!!k)); else setHasKey(false);
  }, [open, provider]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); cancel(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const ex = useExit(open || null, 180);
  if (!open && !ex.v) return null;
  const closing = !open;

  const pickProvider = (id) => { setProvider(id); setModel(providerById(id).models[0].id); setError(null); };
  const cancel = () => { abortRef.current?.abort(); gen.current++; onClose(); };
  const cliOf = (x) => (x?.tool === 'codex' ? cli?.codex : cli);
  const cliBlocked = p?.desktopOnly && (isDesktop ? cli && !cliOf(p)?.found : !(cli?.bridge?.paired && cliOf(p)?.found));
  const setupOk = p && !cliBlocked && (!p.needsKey || hasKey || keyInput.trim());
  const canNext = step === 0 ? !!p && !(isDesktop && cliBlocked) : step === 1 ? setupOk : false;

  const start = async () => {
    if (!p) return;
    const my = ++gen.current;
    setError(null); setStep(2); setPhase('testing');
    if (p.needsKey && keyInput.trim()) { await setKey(p.id, keyInput.trim()); setHasKey(true); setKeyInput(''); }
    const next = { ...settings, provider: p.id, model };
    onSettings(next);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await verifyConnection(next, { signal: ac.signal });
      if (my !== gen.current) return;
      const verified = { ...(settings.verified || {}), [verifyKey(next)]: { at: Date.now(), reply: r.reply } };
      onSettings({ ...next, verified });
      setOk(r); setPhase('idle'); setStep(3);
    } catch (e) {
      if (my !== gen.current) return;
      setError({ message: e.message || String(e), detail: e.detail, kind: e.kind });
      setPhase('failed');
    }
  };
  const goNext = () => { if (step === 0) setStep(1); else if (step === 1) start(); };
  const goBack = () => { if (step === 2) { abortRef.current?.abort(); gen.current++; setPhase('idle'); } setStep(Math.max(0, step - 1)); setError(null); };
  const recommended = cli?.found ? 'claude-cli' : cli?.codex?.found ? 'codex-cli' : 'claude-api';

  return (
    <div className={'modal-back' + (closing ? ' closing' : '')} onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div className="modal connect" role="dialog" aria-modal="true" aria-labelledby="cm-title">
        <div className="modal-head">
          <h3 id="cm-title">AI 연결</h3>
          <button className="x" onClick={cancel} aria-label="닫기"><Icon name="close" size={14} /></button>
        </div>
        <ol className="stepper" aria-label="연결 단계">
          {STEPS.map((s, i) => (
            <li key={s.id} className={i === step ? 'on' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
              <button type="button" className="step-dot" disabled={i >= step || step === 3 || phase === 'testing'} onClick={() => { if (i < step) { abortRef.current?.abort(); gen.current++; setPhase('idle'); setError(null); setStep(i); } }}>{i < step ? <Icon name="check" size={13} strokeWidth={2.2} /> : i + 1}</button>
              <span className="step-name">{s.title}</span>
            </li>
          ))}
        </ol>
        <p className="step-hint">{step === 2 && phase === 'failed' ? '연결에 실패했습니다. 아래 안내를 보고 다시 시도하세요.' : STEPS[step].hint}{pending && step < 3 && <> 연결되면 바로 <b>{ACTION_LABEL[pending]}</b>를 이어서 합니다.</>}</p>

        {step === 0 && (
          <div className="prov-list">
            {providerList().map((x) => {
              const c = cliOf(x);
              // EXE: 명령이 없으면 막는다. 웹: 고를 수는 있고, 다음 단계에서 브리지 안내가 나온다
              const blocked = x.desktopOnly && isDesktop && cli && !c?.found;
              const why = x.desktopOnly && !isDesktop ? (cli?.bridge?.paired ? (c?.found ? '브리지로 연결됨' : `브리지에 ${x.tool || 'claude'} 명령이 없음`) : '내 PC 에 브리지를 켜면 됨')
                : x.desktopOnly && cli && !c?.found ? `${x.tool || 'claude'} 명령을 찾지 못했습니다` : c?.loggedIn === false ? '로그인 필요 (codex login)' : null;
              return (
                <label key={x.id} className={'prov' + (provider === x.id ? ' on' : '') + (blocked ? ' off' : '')}>
                  <input type="radio" name="prov" checked={provider === x.id} disabled={blocked} onChange={() => pickProvider(x.id)} />
                  <span>
                    <b>{x.name}{x.id === recommended && !blocked && <em className="rec">추천</em>}{why && <em> · {why}</em>}</b>
                    <small>{x.desc}</small>
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {step === 1 && p && (
          <div className="prov-opts">
            <div className="setup-head"><b>{p.name}</b>{p.desktopOnly && cliOf(p)?.found && <small className="ok"><i className="dot" /> {p.tool || 'claude'} 명령 확인됨{cliOf(p).version ? ' · ' + cliOf(p).version : ''}{cliOf(p).loggedIn === false ? ' · 로그인 필요' : ''}</small>}</div>
            {p.desktopOnly && !isDesktop && <BridgeSetup tool={p.tool || 'claude'} onChange={setCli} />}
            <label>모델<select value={model} onChange={(e) => setModel(e.target.value)}>{p.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
            {p.needsKey && (
              <label>API 키 {hasKey && !keyInput && <em>저장돼 있음 · 바꾸려면 새로 입력</em>}
                <span className="key-row">
                  <input type={showKey ? 'text' : 'password'} placeholder={hasKey ? '••••••••' : p.keyHint} value={keyInput} onChange={(e) => setKeyInput(e.target.value)} autoComplete="off" spellCheck={false} autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter' && setupOk) start(); }} />
                  <button type="button" className="small" onClick={() => setShowKey(!showKey)}>{showKey ? '숨기기' : '보기'}</button>
                </span>
                <small>{isDesktop ? '이 PC 의 Windows 계정으로 암호화해서 저장합니다.' : '이 브라우저에만 저장합니다.'} <a href={p.keyUrl} target="_blank" rel="noreferrer">키 발급 페이지 <Icon name="external" size={13} /></a></small>
              </label>
            )}
            <ul className="tips">{(TIPS[p.id] || []).map((t) => <li key={t}>{t}</li>)}</ul>
          </div>
        )}

        {step === 2 && phase === 'testing' && (
          <div className="test-wait">
            <Busy label={`${p?.name}${model ? ' · ' + model : ''} 에 물어보는 중`} />
            <small className="hint">짧은 고정 문장 하나를 보냅니다. 보통 몇 초 안에 끝납니다.</small>
          </div>
        )}
        {step === 2 && phase === 'failed' && (
          <div className="test-fail">
            <p className="modal-err"><b>연결하지 못했습니다.</b> {error?.message}</p>
            {ERROR_HINT(error, p) && <p className="modal-note fix">{ERROR_HINT(error, p)}</p>}
            {error?.detail && (
              <div className="detail">
                <button className="link" onClick={() => setShowDetail(!showDetail)}>{showDetail ? '상세 닫기' : '상세 보기'}</button>
                {showDetail && <pre>{String(error.detail).slice(0, 1500)}</pre>}
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="test-ok">
            <p className="modal-ok"><Icon name="check" size={15} strokeWidth={2.2} /> 연결됐습니다. <small>{p?.name}{model ? ' · ' + model : ''} · {ok?.ms}ms</small></p>
            <p className="modal-note">답: "{ok?.reply}"</p>
            <p className="modal-note">{pending ? `이어서 ${ACTION_LABEL[pending]}를 합니다.` : '이제 툴바의 AI 검수와 AI 패널을 쓸 수 있습니다. 상단 칩에서 언제든 바꿀 수 있습니다.'}</p>
          </div>
        )}

        <div className="modal-actions nav">
          {step > 0 && step < 3 && <button onClick={goBack} disabled={phase === 'testing' && false}><Icon name="back" size={14} /> 이전</button>}
          <span className="grow" />
          {step < 2 && <button onClick={cancel}>닫기</button>}
          {step < 2 && <button className="primary" disabled={!canNext} onClick={goNext} autoFocus>{step === 1 ? '연결 확인 →' : '다음 →'}</button>}
          {step === 2 && phase === 'testing' && <button onClick={goBack}>취소</button>}
          {step === 2 && phase === 'failed' && <><button onClick={() => setStep(0)}>방식 바꾸기</button><button className="primary" onClick={start} autoFocus>다시 시도</button></>}
          {step === 3 && <><button onClick={onClose}>다이어그램으로</button>{pending && <button className="primary" onClick={() => onReady(pending)} autoFocus>이어서 {ACTION_LABEL[pending]}</button>}</>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export function AiPanel({ context, onContext, settings, verified, onOpenConnect, state, onReview, onDraw, onAsk, onFixFromAnswer, onApplyOps, onCancel, onPick, nameOf, activeDocId, onWizard, onAttachDoc, onToast }) {
  const [talk, setTalk] = useState('');
  const [draft, setDraft] = useState(context);
  const [req, setReq] = useState('');
  const [q, setQ] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  useEffect(() => setDraft(context), [context]);
  const p = providerById(settings.provider);
  const busy = state.busy;
  const r = state.result;
  // 직접 적는 칸만 보낸다 (첨부 문서·기록은 따로 관리되므로 덮지 않게)
  const flush = () => { const pick = (c) => ({ title: c.title || '', requirements: c.requirements || '', constraints: c.constraints || '' }); if (JSON.stringify(pick(draft)) !== JSON.stringify(pick(context))) onContext(pick(draft)); };

  const drawResult = r && r.mode === 'draw' ? r : null;
  const reviewResult = r && r.mode === 'review' ? r : null;
  const askResult = r && r.mode === 'ask' ? r : null;
  const ctxFilled = !!(draft.title?.trim() || draft.requirements?.trim() || draft.constraints?.trim());
  // AI 에게 알려준 것 (되물음에 답한 것) — 요건 안의 "- [확인]" 줄. 틀렸으면 지운다
  const told = (draft.requirements || '').split('\n').filter((l) => /^- \[확인\]/.test(l));
  const forget = (line) => { const requirements = (draft.requirements || '').split('\n').filter((l) => l !== line).join('\n'); setDraft({ ...draft, requirements }); onContext({ requirements }); };
  const log = context.log || [];
  const KIND = { draw: '그림', ask: '질문', review: '검수' };
  const Intent = ({ res }) => (res.understood || res.assumptions?.length ? (
    <div className="intent">
      {res.understood && <p><b>이렇게 이해했어요</b> {res.understood}</p>}
      {res.assumptions?.length > 0 && <p className="hint">가정한 것: {res.assumptions.join(' · ')} — 틀리면 아래 물어보기에 "사실은 …" 이라고 적어 주세요.</p>}
    </div>
  ) : null);
  const Raw = ({ res }) => (
    <>
      <button className="link" onClick={() => setShowRaw(!showRaw)}>{showRaw ? '원문 닫기' : '모델 원문 보기'}</button>
      {showRaw && <pre className="result">{res.raw}</pre>}
    </>
  );

  return (
    <div className="insp ai">
      <h3>AI</h3>
      <div className="conn-row">
        {verified ? <span className="ok"><i className="dot" /> {p?.name}{settings.model ? ' · ' + settings.model : ''}</span> : <span className="hint">연결 안 됨</span>}
        <button className="small" onClick={() => onOpenConnect(null)}>{verified ? '연결 변경' : '연결하기'}</button>
      </div>

      {/* 추천: 말로 그리기 — 막 적으면 팝업에서 필요한 것만 묻고 그려 준다 */}
      <div className="ai-step now">
        <div className="step-head"><Icon name="sparkle" size={15} /> 말로 그리기 <small className="hint">추천</small></div>
        <p className="hint">만들고 싶은 걸 막 적으세요. 부족한 건 AI 가 쉬운 질문으로 한두 개 묻고, 그림을 먼저 보여 준 뒤 그립니다. 그린 그림을 고칠 때도 여기에 적으면 됩니다.</p>
        <DocAttach doc={context.doc} onAttach={onAttachDoc} onError={onToast} onCopied={onToast} />
        <textarea className="short" value={talk} onChange={(e) => setTalk(e.target.value)} placeholder="예: 내 PC 에서 도는 AI 를 밖에서도 휴대폰으로 쓰고 싶어" onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { flush(); onWizard(talk.trim()); setTalk(''); } }} />
        <button className="primary big" disabled={!!busy} onClick={() => { flush(); onWizard(talk.trim()); setTalk(''); }}>시작하기</button>
      </div>

      {state.error && (
        <div className="pin-row card error">
          <b>실패</b> {state.error.message}
          {state.error.detail && <details><summary>상세 보기</summary><pre className="result">{String(state.error.detail).slice(0, 1500)}</pre></details>}
          {state.error.kind === 'auth' || state.error.kind === 'config' ? <button className="small" onClick={() => onOpenConnect(null)}>연결 다시 하기</button> : null}
        </div>
      )}

      {/* 마지막으로 만든 그림 (말로 그리기·직접 그리기 모두 여기 남는다) */}
      {drawResult && (
        <div className="ai-result" ref={(el) => { if (el && el.dataset.k !== String(drawResult.ms)) { el.dataset.k = String(drawResult.ms); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }}>
          <h4>{drawResult.applied ? '그린 내용' : '그릴 내용 (아직 캔버스에 안 그려짐)'} <small className="hint">{drawResult.provider}{drawResult.ms ? ` · ${(drawResult.ms / 1000).toFixed(1)}s` : ''}</small></h4>
          {drawResult.docId && activeDocId && drawResult.docId !== activeDocId && <p className="hint">"{drawResult.docTitle}" 탭에서 요청한 결과입니다.</p>}
          <Intent res={drawResult} />
          {drawResult.summary && <p className="summary">{drawResult.summary}</p>}
          <ol className="ops">{describeOps(drawResult.ops || [], nameOf).map((t, i) => <li key={i}>{t}</li>)}</ol>
          {!drawResult.ops?.length && <p className="hint">바꿀 내용이 없습니다.</p>}
          {drawResult.applied ? (
            <p className="ok">{drawResult.applied.blocked ? '규칙 검사에서 막혀 그리지 않았습니다.' : `캔버스에 그렸습니다 · ${drawResult.applied.applied}개`}{drawResult.applied.errors?.length ? ` · 실패 ${drawResult.applied.errors.length}개: ${drawResult.applied.errors.map((e) => e.message).join('; ')}` : ''}</p>
          ) : drawResult.ops?.length > 0 && (
            <button className="primary big" onClick={() => onApplyOps(drawResult.ops)}>캔버스에 그리기 (되돌리기 가능)</button>
          )}
          <Raw res={drawResult} />
        </div>
      )}

      {/* 그린 다음에 — 검수와 질문 */}
      <div className="ai-more">
        <div className="more-head">그린 다음에 (선택)</div>
        <div className="ai-sub">
          <b>검수 받기</b> <span className="hint">요건 대비 빠진 것·과한 것, 가용성·보안·비용의 빈틈을 요소 위에 표시합니다.</span>
          <button className={busy === 'review' ? 'waiting' : ''} disabled={!!busy} onClick={() => { flush(); onReview(); }}>{busy === 'review' ? <Busy label="검수 중" /> : '검수 받기'}</button>
          {reviewResult && (
            <div className="ai-result">
              <Intent res={reviewResult} />
              {reviewResult.summary && <p className="summary">{reviewResult.summary}</p>}
              {!reviewResult.findings?.length && <p className="ok">지적 사항이 없습니다.</p>}
              {reviewResult.findings?.map((f) => (
                <div key={f.id} className={'pin-row card ' + f.level} onClick={() => onPick(f.target)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(f.target); } }} role="button" tabIndex={0}>
                  <b>{f.level === 'error' ? '심각' : f.level === 'warn' ? '경고' : '참고'}</b> {f.message}
                  <div className="hint">{nameOf?.(f.target) || ''}</div>
                  <p className="explain">{f.explain}</p>
                </div>
              ))}
              {reviewResult.dropped?.length > 0 && <p className="hint">다이어그램에 없는 요소를 가리킨 지적 {reviewResult.dropped.length}건은 제외했습니다.</p>}
              <Raw res={reviewResult} />
            </div>
          )}
        </div>
        <div className="ai-sub">
          <b>물어보기</b> <span className="hint">그림과 요건을 보고 답합니다. 경고 표시의 [AI에게 물어보기]도 여기로 옵니다.</span>
          <textarea className="short" value={q} onChange={(e) => setQ(e.target.value)} placeholder={askResult ? '이어서 질문…' : '예: NAT 게이트웨이를 하나만 두면 어떤 문제가 있습니까?'} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && q.trim()) { flush(); onAsk(q.trim()); setQ(''); } }} />
          <button className={busy === 'ask' ? 'waiting' : ''} disabled={!!busy || !q.trim()} onClick={() => { flush(); onAsk(q.trim()); setQ(''); }}>{busy === 'ask' ? <Busy label="생각 중" /> : '물어보기 (Ctrl+Enter)'}</button>
          {askResult && (
            <div className="ai-result ask" ref={(el) => { if (el && el.dataset.q !== askResult.question) { el.dataset.q = askResult.question; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }}>
              <h4>답변 <small className="hint">{askResult.provider}{askResult.ms ? ` · ${(askResult.ms / 1000).toFixed(1)}s` : ''}</small></h4>
              <div className="ask-q">{askResult.question}</div>
              <Intent res={askResult} />
              <div className="ask-a">{boldText(askResult.answer)}</div>
              {onFixFromAnswer && (
                <div className="ask-next">
                  <button className="primary" disabled={!!busy} onClick={() => { flush(); onFixFromAnswer(askResult.question, askResult.answer); }}>
                    {busy === 'draw' ? <Busy label="고칠 내용 만드는 중" /> : <><Icon name="sparkle" size={14} /> 이 답변대로 그림 고치기</>}
                  </button>
                  <small className="hint">고칠 내용을 먼저 보여 줍니다. [적용]을 눌러야 바뀌고, 적용하면 자동 정렬까지 합니다. Ctrl+Z 로 되돌릴 수 있어요.</small>
                </div>
              )}
            </div>
          )}
        </div>
        {busy && <button onClick={onCancel}>취소</button>}
      </div>

      {told.length > 0 && (
        <div className="told">
          <div className="more-head">AI 에게 알려준 것 <small className="hint">다음 답과 검수에 반영됩니다</small></div>
          {told.map((l) => <div key={l} className="told-row"><span>{l.replace(/^- \[확인\]\s*/, '')}</span><button className="x" title="잊게 하기" onClick={() => forget(l)}><Icon name="close" size={14} /></button></div>)}
        </div>
      )}

      {log.length > 0 && (
        <details className="told ai-log">
          <summary className="more-head">이 그림의 AI 기록 {log.length}개 <small className="hint">AI 가 다음 질문·검수 때 같이 봅니다</small></summary>
          {[...log].reverse().map((x, i) => (
            <div key={i} className="log-row">
              <span className={'log-k ' + x.k}>{KIND[x.k] || x.k}</span>
              <div><div className="log-q">{x.q.length > 160 ? x.q.slice(0, 160) + '…' : x.q}</div>{x.a && <div className="hint">→ {x.a.length > 160 ? x.a.slice(0, 160) + '…' : x.a}</div>}</div>
            </div>
          ))}
          <button className="small" onClick={() => onContext({ log: [] })}>기록 지우기</button>
        </details>
      )}

      {/* 직접 하기 — 상황과 요청을 직접 적어서 (익숙한 사람용) */}
      <details className="ai-step">
        <summary>직접 적어서 그리기 <small className="hint">{ctxFilled ? '상황 적혀 있음' : '익숙한 분용'}</small></summary>
        <label>무엇을 만드나요<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} onBlur={flush} placeholder="예: OO사 차세대 커머스 플랫폼 구축" /></label>
        <label>꼭 되어야 하는 것<textarea value={draft.requirements} onChange={(e) => setDraft({ ...draft, requirements: e.target.value })} onBlur={flush} placeholder={'- 동시 접속 1만, 피크 3배\n- 서울 리전, DR 요구'} /></label>
        <label>지켜야 할 조건 (예산·보안 등)<textarea className="short" value={draft.constraints} onChange={(e) => setDraft({ ...draft, constraints: e.target.value })} onBlur={flush} placeholder="예: 월 예산 상한, 기존 DB 유지" /></label>
        <label>그릴 내용<textarea className="short" value={req} onChange={(e) => setReq(e.target.value)} placeholder="예: VPC 안에 AZ 2개, ALB 뒤에 EC2 2대, RDS 멀티 AZ" /></label>
        <button className={'primary' + (busy === 'draw' ? ' waiting' : '')} disabled={!!busy || !req.trim()} onClick={() => { flush(); onDraw(req.trim()); }}>{busy === 'draw' ? <Busy label="만드는 중 · 1~2분" /> : '그릴 내용 만들기'}</button>
        <p className="hint">만든 내용은 위에 [그릴 내용]으로 나오고, [캔버스에 그리기]를 눌러야 그려집니다.</p>
      </details>
    </div>
  );
}

// AI 가 만든 명령을 사람이 읽는 문장으로: "VPC 안에 ALB 추가", "ALB → EC2 연결"
const KIND_KO = { region: '리전', vpc: 'VPC', az: '가용 영역', 'public-subnet': '퍼블릭 서브넷', 'private-subnet': '프라이빗 서브넷', 'auto-scaling-group': '오토 스케일링 그룹', 'security-group': '보안 그룹', section: '섹션', generic: '그룹' };
// 답변 안의 **굵게** 만 굵은 글씨로 (나머지 마크다운은 글자 그대로)
function boldText(t) {
  return String(t || '').split(/(\*\*[^*\n]+\*\*)/g).map((p, i) => (/^\*\*[^*\n]+\*\*$/.test(p) ? <b key={i}>{p.slice(2, -2)}</b> : p));
}

export function describeOps(ops, nameOf) {
  const local = new Map();
  for (const o of ops) if (o?.id && (o.label || o.kind)) local.set(String(o.id), o.label || KIND_KO[o.kind] || o.kind);
  const nm = (id) => (id == null ? '' : local.get(String(id)) || nameOf?.(String(id)) || '이름 없는 요소');
  return ops.map((op) => {
    const where = op.parent ? `${nm(op.parent)} 안에 ` : '';
    switch (op.op ?? op.type ?? op.action) {
      case 'add_node': return `${where}${op.label || '아이콘'} 추가`;
      case 'add_card': return `${where}카드 "${op.label || '제목'}" 추가`;
      case 'add_group': return `${where}${op.label || KIND_KO[op.kind] || '그룹'} 추가`;
      case 'connect': return `${nm(op.source)} → ${nm(op.target)} 연결${op.label ? ` ("${op.label}")` : ''}`;
      case 'disconnect': return op.id && !op.source ? '연결선 하나 삭제' : `${nm(op.source)} → ${nm(op.target)} 연결 삭제`;
      case 'move_into': return `${nm(op.id)}을(를) ${op.parent ? nm(op.parent) + ' 안으로' : '바깥으로'} 이동`;
      case 'move': return `${nm(op.id)} 위치 이동`;
      case 'resize': return `${nm(op.id)} 크기 조절`;
      case 'update': return `${nm(op.id)} ${op.set?.label != null ? `이름을 "${op.set.label}"(으)로 변경` : '설정 변경'}`;
      case 'remove': return `${nm(op.id)} 삭제`;
      case 'annotate': return `${nm(op.target)}에 메모 추가`;
      case 'clear_annotations': return '메모 지우기';
      default: return '알 수 없는 변경';
    }
  });
}
