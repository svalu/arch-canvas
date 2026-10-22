// 캔버스 노드: 그룹(awsGroup), 아이콘(awsIcon). 연결 핸들은 네 면에 하나씩(ConnectionMode.Loose 라 아무 핸들끼리 연결).
import React, { memo } from 'react';
import { useExit } from '../useExit.js';
import { Handle, Position, NodeResizer } from '@xyflow/react';
import { useCatalog } from '../catalog.js';
import { GROUP_ICON_SIZE, LABEL_WIDTH, ICON_LABEL_GAP } from '../model/schema.js';
import { GROUP_LABEL_PAD, LABEL_PX, INK, readable } from '../export/scene.js';

const SIDES = [['t', Position.Top], ['l', Position.Left], ['b', Position.Bottom], ['r', Position.Right]];

function Handles() {
  return SIDES.map(([k, pos]) => <Handle key={k} id={k} type="source" position={pos} className="hdl" />);
}

const PIN_COLOR = { error: '#DD344C', warn: '#ED7100', info: '#2E73B8' };

// 핀에 마우스를 올리면 바로 뜨는 툴팁. 본체는 App 의 <PinTip/> 이 window 이벤트로 그린다(노드 overflow 에 안 잘리게).
// 숨기기는 살짝 늦춰서 마우스가 툴팁 안으로 들어갈 수 있게 한다(버튼이 있으니까).
let hideTimer = null;
let pinned = false;   // 핀을 클릭하면 고정: 마우스가 떠나도 유지, 다른 곳 클릭/Esc 로 닫힘
export const showPinTip = (pins, el, lock = false) => {
  clearTimeout(hideTimer);
  if (pins && el) { if (lock) pinned = true; window.dispatchEvent(new CustomEvent('arch-pintip', { detail: { pins, rect: el.getBoundingClientRect(), pinned } })); }
  else if (!pinned) hideTimer = setTimeout(() => window.dispatchEvent(new CustomEvent('arch-pintip', { detail: null })), 500);
};
export const hidePinTip = () => { pinned = false; clearTimeout(hideTimer); window.dispatchEvent(new CustomEvent('arch-pintip', { detail: null })); };
const askText = (p) => `"${p.message}" 라는 ${p.level === 'error' ? '문제' : p.level === 'info' ? '참고' : '경고'}가 떴습니다 (대상: ${p.target}). 설명: ${p.explain || ''}\n이게 왜 중요하고, 현재 다이어그램에서 구체적으로 어떻게 고치면 좋습니다? 제안서에 적을 근거도 한 줄 주세요.`;

export function Pins({ pins }) {
  if (!pins?.length) return null;
  const top = pins.find((p) => p.level === 'error') || pins.find((p) => p.level === 'warn') || pins[0];
  return (
    <div
      className="pin" style={{ background: PIN_COLOR[top.level] }}
      onMouseEnter={(e) => showPinTip(pins, e.currentTarget)} onMouseLeave={() => showPinTip(null)}
      onClick={(e) => { e.stopPropagation(); showPinTip(pins, e.currentTarget, true); }}
      title=""
    >
      {pins.length > 1 ? pins.length : top.level === 'info' ? 'i' : '!'}
    </div>
  );
}

const LEVEL_NAME = { error: '심각', warn: '경고', info: '참고' };
const sourceOf = (p) => (p.rule ? '자동 규칙' : String(p.id).startsWith('ai-') ? 'AI 검수' : '메모');

/** 핀 툴팁 본체. App 루트에 한 번만 둔다. */
export function PinTip() {
  const [tip, setTip] = React.useState(null);
  React.useEffect(() => {
    const on = (e) => setTip(e.detail);
    const onKey = (e) => { if (e.key === 'Escape') hidePinTip(); };
    const onDown = (e) => { if (!e.target.closest?.('.pin-tip') && !e.target.closest?.('.pin')) hidePinTip(); };
    window.addEventListener('arch-pintip', on);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('arch-pintip', on); window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown, true); };
  }, []);
  const ex = useExit(tip, 140);
  const t = tip || ex.v;
  if (!t) return null;
  const closing = !tip;
  const { pins, rect } = t;
  const W = 280;
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - W / 2), window.innerWidth - W - 8);
  const below = rect.bottom + 8 + 120 < window.innerHeight;
  return (
    <div className={'pin-tip' + (closing ? ' closing' : '')} style={{ left, top: below ? rect.bottom + 8 : undefined, bottom: below ? undefined : window.innerHeight - rect.top + 8, width: W }}
      onMouseEnter={() => clearTimeout(hideTimer)} onMouseLeave={() => showPinTip(null)} onPointerDown={(e) => e.stopPropagation()}>
      {pins.map((p) => (
        <div key={p.id} className={'pin-tip-row ' + p.level}>
          <div className="pin-tip-head"><b>{LEVEL_NAME[p.level] || p.level}</b><span>{sourceOf(p)}</span></div>
          <div className="pin-tip-msg">{p.message}</div>
          {p.explain && <div className="pin-tip-explain">{p.explain}</div>}
          <button className="small ask" onClick={() => { hidePinTip(); window.dispatchEvent(new CustomEvent('arch-ask', { detail: askText(p) })); }}>AI에게 물어보기</button>
        </div>
      ))}
      <div className="pin-tip-foot">{tip.pinned ? '다른 곳을 클릭하거나 Esc 로 닫힙니다' : '핀을 클릭하면 고정됩니다'}</div>
    </div>
  );
}

export const AwsGroup = memo(function AwsGroup({ data, selected }) {
  const { kinds, icons } = useCatalog();
  const base = kinds.get(data.kind) || kinds.get('generic');
  // 섹션 덮어쓰기(색/선/채움)가 있으면 그걸 쓴다
  const kind = { ...base, color: data.color || base.color, text: data.color || base.text, line: data.line || base.line, fill: 'fill' in data ? data.fill : base.fill };
  const icon = base.icon ? icons.get(base.icon) : null;
  return (
    <>
      <NodeResizer isVisible={selected && !data.locked} minWidth={80} minHeight={60} color={kind.color} handleClassName="rsz" lineClassName="rszline" />
      <div
        className={'grp' + (selected ? ' sel' : '') + (data.kind === 'section' ? ' section' : '')}
        style={{
          // 섹션은 라이트에서 연한 색을 읽히게 진하게 (다크는 원래 색)
          '--grp-border-light': data.kind === 'section' ? readable(kind.color, 3) : kind.color,
          '--grp-border-dark': kind.color,
          borderColor: 'var(--grp-border)',
          borderStyle: kind.line === 'none' ? 'none' : kind.line,
          // 라이트는 공식 채움색, 다크는 테두리색을 어두운 바탕에 살짝 섞은 색 (styles.css 의 --grp-fill 이 고른다)
          '--grp-fill-light': kind.fill || 'transparent',
          '--grp-fill-dark': kind.fill ? `color-mix(in srgb, ${kind.color} 14%, #101d20)` : 'transparent',
          '--grp-text-light': data.kind === 'section' ? readable(kind.text) : kind.text,
          '--grp-text-dark': `color-mix(in srgb, ${kind.color} 55%, #e6f6f3)`,
          background: 'var(--grp-fill)',
        }}
      >
        {icon && <img src={icon.src} className="grp-icon" width={GROUP_ICON_SIZE} height={GROUP_ICON_SIZE} draggable={false} alt="" />}
        <div
          className="grp-label"
          style={{ color: 'var(--grp-text)', left: icon ? GROUP_LABEL_PAD.iconL : GROUP_LABEL_PAD.plainL, top: icon ? GROUP_LABEL_PAD.iconT : GROUP_LABEL_PAD.plainT, fontSize: `calc(${LABEL_PX}px * var(--label-scale, 1))` }}
        >
          {data.label}
        </div>
        <Pins pins={data.pins} />
        <Handles />
      </div>
    </>
  );
});

export const AwsIcon = memo(function AwsIcon({ data, selected }) {
  const { icons } = useCatalog();
  const icon = icons.get(data.icon);
  return (
    <div className={'ico' + (selected ? ' sel' : '')} title={icon?.name}>
      {icon ? <img src={icon.src} draggable={false} alt="" /> : <div className="ico-missing">?</div>}
      {data.label && (
        <div className="ico-label" style={{ width: LABEL_WIDTH, left: -(LABEL_WIDTH - 48) / 2, top: 48 + ICON_LABEL_GAP, fontSize: `calc(${LABEL_PX}px * var(--label-scale, 1))`, color: INK }}>
          {data.label}
        </div>
      )}
      <Pins pins={data.pins} />
      <Handles />
    </div>
  );
});

// 카드: 아이콘(선택) + 제목 + 설명. 솔루션 구성도용. 크기 조절 가능.
export const AwsCard = memo(function AwsCard({ data, selected }) {
  const { icons } = useCatalog();
  const icon = data.icon ? icons.get(data.icon) : null;
  return (
    <>
      <NodeResizer isVisible={selected && !data.locked} minWidth={120} minHeight={48} handleClassName="rsz" lineClassName="rszline" />
      <div className={'card' + (selected ? ' sel' : '')} style={data.accent ? { borderColor: data.accent } : undefined}>
        {icon && <img src={icon.src} className="card-icon" draggable={false} alt="" />}
        <div className="card-text">
          <div className="card-title">{data.label || '제목'}</div>
          {data.body && <div className="card-body">{data.body}</div>}
        </div>
        <Pins pins={data.pins} />
        <Handles />
      </div>
    </>
  );
});

// 글상자: 테두리 없는 자유 텍스트 (제목, 설명, 메모)
const TEXT_PX = { sm: 11, md: 13, lg: 16, xl: 22 };
export const AwsText = memo(function AwsText({ data, selected }) {
  return (
    <>
      <NodeResizer isVisible={selected && !data.locked} minWidth={40} minHeight={20} handleClassName="rsz" lineClassName="rszline" />
      <div className={'textbox' + (selected ? ' sel' : '') + (data.label ? '' : ' empty')} style={{ fontSize: `calc(${TEXT_PX[data.size] || 13}px * var(--label-scale, 1))`, fontWeight: data.bold ? 700 : 400, ...(data.accent ? { color: data.accent } : {}) }}>
        {data.label || '텍스트'}
        <Handles />
      </div>
    </>
  );
});

// 번호 배지 ①②③: 흐름 순서를 표시
export const AwsBadge = memo(function AwsBadge({ data, selected }) {
  return (
    <div className={'badge-node' + (selected ? ' sel' : '')} style={data.accent ? { background: data.accent } : undefined}>
      {data.label || '1'}
      <Handles />
    </div>
  );
});

export const nodeTypes = { awsGroup: AwsGroup, awsIcon: AwsIcon, awsCard: AwsCard, awsText: AwsText, awsBadge: AwsBadge };
