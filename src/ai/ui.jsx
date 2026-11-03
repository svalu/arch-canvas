// AI 연결 모달 + AI 패널. 연결 UX 는 "누른 자리에서 시작 → 방식 고르기 → 실제 응답 확인 → 하던 일로 복귀" (곁말 연결 가이드).
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icons.jsx';
import { useExit } from '../useExit.js';
import { PROVIDERS, providerById as providerByIdBase, detectCli, MOCK_PROVIDER, mockEnabled } from './providers.js';
import { DocAttach } from './DocAttach.jsx';
import { BridgeSetup } from './BridgeSetup.jsx';
import { classifyIntent, INTENT_LABEL } from './intent.js';

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
export function AiPanel({ context, onContext, settings, verified, onOpenConnect, state, onReview, onAsk, onAskSelection, selection, onFixFromAnswer, onApplyOps, onCancel, onPick, nameOf, activeDocId, onWizard, onArrange, onImages, onAttachDoc, onToast, onRate }) {
  const [text, setText] = useState('');
  const [draft, setDraft] = useState(context);
  const [ctxOpen, setCtxOpen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [rated, setRated] = useState({});     // 결과별 평가 (key → 'up' | 'down')
  const [note, setNote] = useState(null);     // 👎 뒤에 적는 한 줄 { key }
  const [noteText, setNoteText] = useState('');
  const [openLog, setOpenLog] = useState(null);   // 지난 기록 중 펼친 것
  const [sent, setSent] = useState(null);        // 방금 보낸 것 { text, intent, forced } — 다른 뜻이었으면 바꿔 보낼 수 있게
  const [images, setImages] = useState([]);      // 붙인 그림 [{ name, dataUrl, w, h }] — 다음 요청에 같이 간다
  const fileRef = useRef(null);
  const addImageFiles = (files) => {
    const list = [...(files || [])].filter((f) => /^image\/(png|jpeg|webp|gif)$/.test(f.type)).slice(0, 6 - images.length);
    if (!list.length) return;
    Promise.all(list.map((f) => new Promise((res) => {
      const rd = new FileReader();
      rd.onload = () => { const img = new Image(); img.onload = () => res({ name: f.name || 'clipboard.png', dataUrl: String(rd.result), w: img.naturalWidth, h: img.naturalHeight }); img.onerror = () => res(null); img.src = String(rd.result); };
      rd.onerror = () => res(null); rd.readAsDataURL(f);
    }))).then((got) => { const ok = got.filter(Boolean); if (!ok.length) return; const next = [...images, ...ok].slice(0, 6); setImages(next); onImages?.(next); });
  };
  const onPaste = (e) => { const files = [...(e.clipboardData?.items || [])].filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean); if (files.length) { e.preventDefault(); addImageFiles(files); } };
  const onDrop = (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); addImageFiles(e.dataTransfer.files); } };
  const dropImage = (i) => { const next = images.filter((_, k) => k !== i); setImages(next); onImages?.(next); };
  useEffect(() => setDraft(context), [context]);
  const p = providerById(settings.provider);
  const busy = state.busy;
  const r = state.result;
  const selCount = selection?.count || 0;
  // 직접 적는 칸만 보낸다 (첨부 문서·기록은 따로 관리되므로 덮지 않게)
  const flush = () => { const pick = (c) => ({ title: c.title || '', requirements: c.requirements || '', constraints: c.constraints || '' }); if (JSON.stringify(pick(draft)) !== JSON.stringify(pick(context))) onContext(pick(draft)); };
  const ctxFilled = !!(draft.title?.trim() || draft.requirements?.trim() || draft.constraints?.trim());
  // AI 에게 알려준 것 (되물음에 답한 것) — 요건 안의 "- [확인]" 줄. 틀렸으면 지운다
  const told = (draft.requirements || '').split('\n').filter((l) => /^- \[확인\]/.test(l));
  const forget = (line) => { const requirements = (draft.requirements || '').split('\n').filter((l) => l !== line).join('\n'); setDraft({ ...draft, requirements }); onContext({ requirements }); };
  const log = context.log || [];
  const KIND = { draw: '그림', ask: '질문', review: '검수', arrange: '정렬' };

  // 보내기. Enter = 적은 말로 종류를 정해서(정렬·검수·질문·그리기) 보낸다. 버튼으로 종류를 직접 고를 수도 있다
  const dispatch = (how, t) => {
    onImages?.(images); setImages([]);   // 붙인 그림은 이번 요청에 같이 가고 칸은 비운다
    if (how === 'review') { onReview(); return; }
    if (how === 'arrange') { onArrange?.(t); return; }
    if (!t) return;
    if (how === 'ask') { if (selCount && onAskSelection) onAskSelection(t); else onAsk(t); }
    else onWizard(t);
  };
  const send = (how) => {
    const t = text.trim();
    flush();
    if (how === 'chat') {
      const it = classifyIntent(t);
      if (!t && it.intent !== 'review') return;
      setSent({ text: it.text, intent: it.intent, forced: it.forced, raw: t });
      dispatch(it.intent, it.text);
      setText('');
      return;
    }
    if (how !== 'review' && !t) return;
    setSent(t ? { text: t, intent: how, forced: true, raw: t } : null);
    dispatch(how, t);
    setText('');
  };
  const resend = (how) => { if (!sent) return; setSent({ ...sent, intent: how, forced: true }); dispatch(how, sent.text || sent.raw); };
  const onKey = (e) => {
    if (e.key !== 'Enter' || !verified || e.nativeEvent?.isComposing) return;
    if (e.shiftKey && !(e.ctrlKey || e.metaKey)) return;   // Shift+Enter = 줄 바꿈
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) send(e.shiftKey ? 'ask' : 'draw'); else send('chat');
  };

  // 지금 결과가 기록에도 들어 있으면 기록 쪽은 숨긴다 (같은 것이 두 번 보이지 않게)
  const dupOf = (x) => !!r && (!r.docId || !activeDocId || r.docId === activeDocId) && ((r.mode === 'ask' && x.k === 'ask' && x.q === r.question) || (r.mode === 'review' && x.k === 'review') || (r.mode === 'draw' && x.k === 'draw' && x.q === r.request) || (r.mode === 'arrange' && x.k === 'arrange'));
  const lastDup = log.map(dupOf).lastIndexOf(true);
  const history = log.filter((x, i) => i !== lastDup);
  const key = r ? String(r.at || r.question || r.mode) : '';
  const rate = (up) => { if (!r || rated[key]) return; setRated({ ...rated, [key]: up ? 'up' : 'down' }); onRate?.(r, up, ''); if (!up) setNote({ key }); };
  const sendNote = () => { if (noteText.trim()) onRate?.(r, false, noteText.trim()); setNote(null); setNoteText(''); };

  const Intent = ({ res }) => (res.understood || res.assumptions?.length ? (
    <div className="intent">
      {res.understood && <p><b>이렇게 이해했어요</b> {res.understood}</p>}
      {res.assumptions?.length > 0 && <p className="hint">가정한 것: {res.assumptions.join(' · ')} — 틀리면 위 칸에 "사실은 …" 이라고 적어 [물어보기].</p>}
    </div>
  ) : null);
  const Raw = ({ res }) => (
    <>
      <button className="link" onClick={() => setShowRaw(!showRaw)}>{showRaw ? '원문 닫기' : '모델 원문 보기'}</button>
      {showRaw && <pre className="result">{res.raw}</pre>}
    </>
  );
  // 결과 아래 줄: 어디서 왔는지 · 얼마나 걸렸는지 · 👍👎
  const Foot = ({ res }) => (
    <div className="turn-foot">
      <small className="hint">{res.provider}{res.ms ? ` · ${(res.ms / 1000).toFixed(1)}s` : ''}{res.docId && activeDocId && res.docId !== activeDocId ? ` · "${res.docTitle}" 탭에서 요청` : ''}</small>
      {onRate && (
        <span className="rate" title="평가는 만든 사람에게 전달됩니다 (질문·답 일부 포함)">
          <button className={'x' + (rated[key] === 'up' ? ' on' : '')} disabled={!!rated[key]} onClick={() => rate(true)} aria-label="도움이 됐어요"><Icon name="thumbUp" size={14} /></button>
          <button className={'x' + (rated[key] === 'down' ? ' on' : '')} disabled={!!rated[key]} onClick={() => rate(false)} aria-label="아쉬워요"><Icon name="thumbDown" size={14} /></button>
          {rated[key] && !(note && note.key === key) && <small className="hint">{rated[key] === 'up' ? '고맙습니다' : '전달했습니다'}</small>}
        </span>
      )}
      {note && note.key === key && (
        <div className="rate-note">
          <small className="hint">전달했습니다.</small>
          <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="어떤 점이 아쉬웠나요? (선택, 덧붙여 보냄)" onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent?.isComposing) sendNote(); }} autoFocus />
          <button className="small" onClick={sendNote}>{noteText.trim() ? '덧붙이기' : '닫기'}</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="insp ai chat">
      <h3>AI</h3>
      <div className="conn-row">
        {verified ? <span className="ok"><i className="dot" /> {p?.name}{settings.model ? ' · ' + settings.model : ''}</span> : <span className="hint">연결 안 됨</span>}
        <button className="small" onClick={() => onOpenConnect(null)}>{verified ? '연결 변경' : '연결하기'}</button>
      </div>

      {/* 적는 칸 하나. 윗줄은 "무엇에 대해" (대상·첨부 문서·상황), 아랫줄 버튼이 "무엇을" (검수·질문·그리기) */}
      <div className={'composer' + (busy ? ' busy' : '')}>
        <div className="scope">
          <span className={'chip target' + (selCount ? ' sel' : '')} title={selCount ? '물어보기는 선택한 것에 대해 답합니다. 그리기·검수는 그림 전체를 봅니다' : '그림 전체를 봅니다'}>
            <Icon name={selCount ? 'cursor' : 'panel'} size={13} /> {selCount ? `선택한 ${selCount}개` : '전체 그림'}
          </span>
          {selCount > 0 && <small className="hint">물어보기만 · 검수·그리기는 전체</small>}
          <DocAttach doc={context.doc} onAttach={onAttachDoc} onError={onToast} onCopied={onToast} compact />
          <button className={'chip' + (images.length ? ' on' : '')} onClick={() => fileRef.current?.click()} title="스샷이나 참고 그림을 붙입니다(Ctrl+V 로 붙여 넣거나 끌어다 놓아도 됨). 정렬·질문·그리기·검수 어디든 같이 갑니다"><Icon name="image" size={13} /> 그림{images.length ? ` ${images.length}` : ''}</button>
          <button className={'chip' + (ctxFilled ? ' on' : '') + (ctxOpen ? ' open' : '')} onClick={() => setCtxOpen(!ctxOpen)} title="무엇을 만드는지·꼭 되어야 하는 것·지켜야 할 조건. AI 가 늘 같이 봅니다">
            <Icon name="info" size={13} /> 상황{ctxFilled ? ' ✓' : ''}{told.length ? ` · 알려준 것 ${told.length}` : ''}
          </button>
        </div>
        {ctxOpen && (
          <div className="ctx-box">
            <label>무엇을 만드나요<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} onBlur={flush} placeholder="예: OO사 차세대 커머스 플랫폼 구축" /></label>
            <label>꼭 되어야 하는 것<textarea value={draft.requirements} onChange={(e) => setDraft({ ...draft, requirements: e.target.value })} onBlur={flush} placeholder={'- 동시 접속 1만, 피크 3배\n- 서울 리전, DR 요구'} /></label>
            <label>지켜야 할 조건 (예산·보안 등)<textarea className="short" value={draft.constraints} onChange={(e) => setDraft({ ...draft, constraints: e.target.value })} onBlur={flush} placeholder="예: 월 예산 상한, 기존 DB 유지" /></label>
            {told.length > 0 && (
              <div className="told">
                <div className="more-head">AI 에게 알려준 것 <small className="hint">다음 답과 검수에 반영됩니다</small></div>
                {told.map((l) => <div key={l} className="told-row"><span>{l.replace(/^- \[확인\]\s*/, '')}</span><button className="x" title="잊게 하기" onClick={() => forget(l)}><Icon name="close" size={14} /></button></div>)}
              </div>
            )}
            <p className="hint">말로 그리기 때 AI 가 물어본 답도 여기 "알려준 것"으로 쌓입니다.</p>
          </div>
        )}
        {images.length > 0 && (
          <div className="img-chips" aria-label="붙인 그림">
            {images.map((im, i) => (
              <span key={i} className="img-chip" title={`${im.name} · ${im.w}×${im.h}`}>
                <img src={im.dataUrl} alt="" />
                <button className="x" onClick={() => dropImage(i)} aria-label="그림 빼기"><Icon name="close" size={12} /></button>
              </span>
            ))}
            <small className="hint">그림 {images.length}장 · 다음 요청에 같이 갑니다</small>
          </div>
        )}
        <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onPaste={onPaste} onDrop={onDrop} onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); }} disabled={!!busy}
          placeholder={busy ? '' : selCount ? '선택한 것에 대해 묻거나, 어떻게 바꿀지 적으세요 · Enter 로 보내기 · 스샷은 Ctrl+V' : '무엇이든 적으세요. 예: 정렬해 줘 / 고객 채널은 상자에서 한 줄로 묶어 / NAT 하나면 괜찮아? · Enter 로 보내기 · 스샷은 Ctrl+V'} />
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple style={{ display: 'none' }} onChange={(e) => { addImageFiles(e.target.files); e.target.value = ''; }} />
        <div className={'send-row' + (busy ? ' wait' : '')}>
          {busy ? (
            <>
              <Busy label={busy === 'review' ? '검수 중' : busy === 'ask' ? '생각 중' : busy === 'arrange' ? '배치안 정하는 중 · 1~2분' : '그릴 내용 만드는 중 · 1~2분'} />
              <button onClick={onCancel}>취소</button>
            </>
          ) : (
            <>
              <span className="kinds" aria-label="종류 직접 고르기">
                <button className="small" disabled={!verified} onClick={() => send('review')} title="그림 전체를 요건과 비교해 빈틈을 요소 위에 표시합니다. 글은 안 적어도 됩니다"><Icon name="shield" size={13} /> 검수</button>
                <button className="small" disabled={!verified} onClick={() => send('arrange')} title="AI 가 구도·순서를 정하고 기본 정렬이 자리를 잡습니다. 적은 말이 있으면 그것을 먼저 따릅니다">정렬</button>
                <button className="small" disabled={!verified || !text.trim()} onClick={() => send('ask')} title="그림을 보고 답만 합니다. 그림은 안 바뀝니다 (Ctrl+Shift+Enter)">질문</button>
                <button className="small" disabled={!verified || !text.trim()} onClick={() => send('draw')} title="부족한 건 쉬운 질문으로 묻고, 그릴 내용을 먼저 보여 준 뒤 그립니다 (Ctrl+Enter)">그리기·고치기</button>
              </span>
              <span className="grow" />
              <button className="primary" disabled={!verified || (!text.trim())} onClick={() => send('chat')} title="적은 말을 보고 정렬·검수·질문·그리기 중 하나로 보냅니다 (Enter)"><Icon name="sparkle" size={14} /> 보내기</button>
            </>
          )}
        </div>
        {sent && !busy && !sent.forced && (
          <p className="hint sent-as">"{sent.raw.length > 40 ? sent.raw.slice(0, 40) + '…' : sent.raw}" 을(를) <b>{INTENT_LABEL[sent.intent]}</b>(으)로 보냈어요. 다른 뜻이었으면:
            {['arrange', 'draw', 'ask', 'review'].filter((k) => k !== sent.intent).map((k) => <button key={k} className="link" onClick={() => resend(k)}>{INTENT_LABEL[k]}</button>)}
          </p>
        )}
        {!verified && <p className="hint">먼저 위의 [연결하기]로 AI 를 연결하세요.</p>}
      </div>

      {state.error && (
        <div className="pin-row card error">
          <b>실패</b> {state.error.message}
          {state.error.detail && <details><summary>상세 보기</summary><pre className="result">{String(state.error.detail).slice(0, 1500)}</pre></details>}
          {state.error.kind === 'auth' || state.error.kind === 'config' ? <button className="small" onClick={() => onOpenConnect(null)}>연결 다시 하기</button> : null}
        </div>
      )}

      {/* 대화: 지난 기록(접힌 줄) → 지금 결과(펼친 카드). 아래가 최근 */}
      {(history.length > 0 || r) && (
        <div className="thread">
          <div className="more-head">대화 <small className="hint">이 그림에서 주고받은 것 · AI 가 다음에도 같이 봅니다</small>{history.length > 0 && <button className="link" onClick={() => onContext({ log: [] })}>기록 지우기</button>}</div>
          {history.map((x, i) => (
            <div key={x.t || i} className={'turn past' + (openLog === (x.t || i) ? ' open' : '')} onClick={() => setOpenLog(openLog === (x.t || i) ? null : (x.t || i))} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpenLog(openLog === (x.t || i) ? null : (x.t || i)); }}>
              <span className={'log-k ' + x.k}>{KIND[x.k] || x.k}</span>
              <div className="turn-body">
                <div className="log-q">{openLog === (x.t || i) || x.q.length <= 120 ? x.q : x.q.slice(0, 120) + '…'}</div>
                {x.a && <div className="hint">→ {openLog === (x.t || i) || x.a.length <= 120 ? x.a : x.a.slice(0, 120) + '…'}</div>}
              </div>
            </div>
          ))}

          {r && r.mode === 'arrange' && (
            <div className="turn now" ref={(el) => { if (el && el.dataset.k !== key) { el.dataset.k = key; el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } }}>
              <div className="turn-user"><span className="log-k draw">정렬</span><div className="log-q">{r.request || 'AI 정렬'}</div></div>
              <div className="turn-ai">
                {r.summary && <p className="summary">{boldText(r.summary)}</p>}
                <p className={r.blocked ? 'hint' : 'ok'}>{r.blocked ? '규칙 검사에서 막혀 적용하지 않았습니다.' : `배치했어요 · ${r.placed}개${r.size ? ` · ${r.size.w}×${r.size.h} (${(r.size.w / r.size.h).toFixed(1)}:1)` : ''}${r.crossings > 0 ? ` · 선이 아이콘을 지나는 곳 ${r.crossings}건` : ''} · 되돌리기 Ctrl+Z`}</p>
                {r.ops?.length > 0 && <details className="more"><summary>구도 변경 {r.ops.length}개 보기</summary><ol className="ops">{describeOps(r.ops, nameOf).map((t, i) => <li key={i}>{t}</li>)}</ol></details>}
                {r.crossings > 0 && <p className="hint">남은 관통은 그 아이콘을 옆 열이나 아래 행으로 옮기면 없어져요. "Lens 는 Connect 위에 한 줄로" 처럼 적어 다시 정렬시켜도 됩니다.</p>}
                {r.retried && !r.retried.ok && <p className="hint">점검 뒤 한 번 더 나눠 봤지만 더 나아지지 않아 1차 결과를 두었어요.</p>}
                <Raw res={r} />
                <Foot res={r} />
              </div>
            </div>
          )}
          {r && r.mode === 'draw' && (
            <div className="turn now" ref={(el) => { if (el && el.dataset.k !== key) { el.dataset.k = key; el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } }}>
              {r.request && <div className="turn-user"><span className="log-k draw">그림</span><div className="log-q">{r.request}</div></div>}
              <div className="turn-ai">
                {!r.applied && <h4>그릴 내용 (아직 캔버스에 안 그려짐)</h4>}
                <Intent res={r} />
                {r.summary && <p className="summary">{boldText(r.summary)}</p>}
                {r.applied
                  ? (r.ops?.length > 0 && <details className="more"><summary>바뀐 것 {r.ops.length}개 보기</summary><ol className="ops">{describeOps(r.ops, nameOf).map((t, i) => <li key={i}>{t}</li>)}</ol></details>)
                  : <ol className="ops">{describeOps(r.ops || [], nameOf).map((t, i) => <li key={i}>{t}</li>)}</ol>}
                {!r.ops?.length && <p className="hint">바꿀 내용이 없습니다.</p>}
                {r.applied ? (
                  <p className="ok">{r.applied.blocked ? '규칙 검사에서 막혀 그리지 않았습니다.' : `캔버스에 그렸습니다 · ${r.applied.applied}개 · Ctrl+Z 로 되돌릴 수 있어요`}{r.applied.errors?.length ? ` · 실패 ${r.applied.errors.length}개: ${r.applied.errors.map((e) => e.message).join('; ')}` : ''}</p>
                ) : r.ops?.length > 0 && (
                  <button className="primary big" onClick={() => onApplyOps(r.ops)}>캔버스에 그리기 (되돌리기 가능)</button>
                )}
                <Raw res={r} />
                <Foot res={r} />
              </div>
            </div>
          )}

          {r && r.mode === 'review' && (
            <div className="turn now">
              <div className="turn-user"><span className="log-k review">검수</span><div className="log-q">그림 전체 검수</div></div>
              <div className="turn-ai">
                <Intent res={r} />
                {r.summary && <p className="summary">{r.summary}</p>}
                {!r.findings?.length && <p className="ok">지적 사항이 없습니다.</p>}
                {r.findings?.length > 0 && <p className="hint">지적 {r.findings.length}건 — 누르면 그 요소로 갑니다. 요소 위에도 표시해 두었습니다.</p>}
                {r.findings?.map((f) => (
                  <div key={f.id} className={'pin-row card ' + f.level} onClick={() => onPick(f.target)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(f.target); } }} role="button" tabIndex={0}>
                    <b>{f.level === 'error' ? '심각' : f.level === 'warn' ? '경고' : '참고'}</b> {f.message}
                    <div className="hint">{nameOf?.(f.target) || ''}</div>
                    <p className="explain">{f.explain}</p>
                  </div>
                ))}
                {r.dropped?.length > 0 && <p className="hint">다이어그램에 없는 요소를 가리킨 지적 {r.dropped.length}건은 제외했습니다.</p>}
                <Raw res={r} />
                <Foot res={r} />
              </div>
            </div>
          )}

          {r && r.mode === 'ask' && (
            <div className="turn now" ref={(el) => { if (el && el.dataset.q !== r.question) { el.dataset.q = r.question; el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } }}>
              <div className="turn-user"><span className="log-k ask">질문</span><div className="log-q">{r.question}</div></div>
              <div className="turn-ai">
                <Intent res={r} />
                <div className="ask-a">{boldText(r.answer)}</div>
                {onFixFromAnswer && (
                  <div className="ask-next">
                    <button className="primary" disabled={!!busy} onClick={() => { flush(); onFixFromAnswer(r.question, r.answer); }}>
                      {busy === 'draw' ? <Busy label="고칠 내용 만드는 중" /> : <><Icon name="sparkle" size={14} /> 이 답변대로 그림 고치기</>}
                    </button>
                    <small className="hint">고칠 내용을 먼저 보여 줍니다. [캔버스에 그리기]를 눌러야 바뀌고, 자동 정렬까지 합니다.</small>
                  </div>
                )}
                <Foot res={r} />
              </div>
            </div>
          )}
        </div>
      )}
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
