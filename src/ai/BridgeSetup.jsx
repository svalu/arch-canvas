// 웹 버전에서 CLI(Claude·ChatGPT)를 고르면 나오는 안내. "웹은 준비돼 있어요. 나머지는 내 PC 에서 직접."
// 브리지(web/bridge.mjs)가 켜져 있는지 2초마다 보고, 켜져 있으면 연결 코드 칸을 보여 준다.
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icons.jsx';
import { bridgeHealth, bridgePair, bridgeForget, bridgeConf, BRIDGE_PORT } from './providers.js';

const BRIDGE_URL = 'https://svalu.github.io/arch-canvas/bridge.mjs';
const IS_WIN = /Windows/i.test(navigator.userAgent);
const INSTALL = {
  claude: ['npm i -g @anthropic-ai/claude-code', 'claude auth login'],
  codex: ['npm i -g @openai/codex', 'codex login'],
};
const RUN = IS_WIN
  ? `iwr ${BRIDGE_URL} -OutFile bridge.mjs; node bridge.mjs`
  : `curl -fsSLO ${BRIDGE_URL} && node bridge.mjs`;

function Cmd({ text }) {
  const [done, setDone] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }).catch(() => {}); };
  return (
    <span className="br-cmd">
      <code>{text}</code>
      <button type="button" className="small" onClick={copy} title="복사">{done ? <Icon name="check" size={13} /> : <Icon name="copy" size={13} />}</button>
    </span>
  );
}

/** tool: 'claude' | 'codex'. onChange(cliDetect) — 연결되면 새 감지 결과를 넘긴다. */
export function BridgeSetup({ tool, onChange }) {
  const [st, setSt] = useState(null);            // bridgeHealth() 결과
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const check = async () => {
    const r = await bridgeHealth();
    if (!alive.current) return r;
    setSt(r);
    return r;
  };
  useEffect(() => {
    alive.current = true;
    check();
    const t = setInterval(() => { if (!st?.paired) check(); }, 2000);
    return () => { alive.current = false; clearInterval(t); };
  }, [st?.paired]); // eslint-disable-line react-hooks/exhaustive-deps

  const pair = async () => {
    setBusy(true); setErr('');
    try {
      const r = await bridgePair(code);
      setCode('');
      const h = await check();
      onChange?.({ ...(r.claude || { found: false }), codex: r.codex || { found: false }, bridge: { reachable: true, paired: !!h.paired } });
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  };
  const forget = () => { bridgeForget(); check(); onChange?.({ found: false, reason: 'browser', bridge: { reachable: true, paired: false } }); };

  const me = st?.[tool];
  const state = !st ? 'wait' : !st.reachable ? 'off' : !st.paired ? 'code' : 'on';
  return (
    <div className="bridge">
      <div className={'br-state ' + state}>
        <i className="dot" />
        {state === 'wait' && '내 PC 의 브리지를 찾는 중…'}
        {state === 'off' && <>브리지가 꺼져 있어요 <small>(127.0.0.1:{bridgeConf().port || BRIDGE_PORT})</small></>}
        {state === 'code' && '브리지가 켜져 있어요. 연결 코드를 넣어 주세요'}
        {state === 'on' && <>연결됨 · {me?.found ? (me.version || tool) : `${tool} 명령이 없어요`}{me?.loggedIn === false ? ' · 로그인 필요' : ''}<button type="button" className="link-btn" onClick={forget}>연결 끊기</button></>}
      </div>

      {state === 'code' && (
        <div className="br-pair">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="브리지 창의 6자리 코드" inputMode="numeric" maxLength={7} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && code.replace(/\D/g, '').length === 6) pair(); }} />
          <button type="button" className="primary" disabled={busy || code.replace(/\D/g, '').length !== 6} onClick={pair}>{busy ? '연결 중…' : '연결'}</button>
        </div>
      )}
      {err && <p className="modal-err">{err}</p>}

      {state !== 'on' && (
        <div className="br-guide">
          <p className="br-lead"><b>웹은 준비돼 있어요.</b> 나머지는 내 PC 에서 직접 해 주세요. 한 번만 하면 됩니다.</p>
          <ol>
            <li><span>Node.js 18 이상을 설치해요.</span> <a href="https://nodejs.org" target="_blank" rel="noreferrer">nodejs.org <Icon name="external" size={12} /></a></li>
            <li><span>{tool === 'codex' ? 'Codex CLI 를 설치하고 ChatGPT 계정으로 로그인해요.' : 'Claude Code 를 설치하고 로그인해요.'}</span>{INSTALL[tool].map((c) => <Cmd key={c} text={c} />)}</li>
            <li><span>터미널({IS_WIN ? 'PowerShell' : '터미널 앱'})에서 브리지를 켜요. 웹을 쓰는 동안 그 창은 켜 둡니다.</span><Cmd text={RUN} /></li>
            <li><span>브리지 창에 뜬 <b>6자리 연결 코드</b>를 위 칸에 넣어요. 켜지면 이 창이 저절로 알아챕니다.</span></li>
          </ol>
          <p className="hint">브리지는 내 PC(127.0.0.1)에서만 열리고, 이 사이트에서 온 요청만 받습니다. 크롬·엣지를 권합니다(사파리는 막힐 수 있어요). 이런 설정이 번거로우면 API 키 방식이나 Windows 버전을 쓰세요.</p>
        </div>
      )}
    </div>
  );
}
