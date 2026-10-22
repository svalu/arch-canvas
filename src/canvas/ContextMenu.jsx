// 오른쪽 클릭 메뉴. 선택한 것(선·아이콘·그룹·카드) 또는 빈 캔버스에 맞는 항목만 보여준다.
// 항목은 { label, action } 또는 { label, options:[[value,name]], value, onPick } (한 줄 세그먼트) 또는 'sep'.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useExit } from '../useExit.js';

export function ContextMenu({ menu, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = Math.min(menu.x, window.innerWidth - r.width - 8);
    const y = Math.min(menu.y, window.innerHeight - r.height - 8);
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const down = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', onClose);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); window.removeEventListener('resize', onClose); };
  }, [menu, onClose]);
  const ex = useExit(menu, 140);
  const m = menu || ex.v;
  if (!m) return null;
  const closing = !menu;
  return (
    <div ref={ref} className={'ctx' + (closing ? ' closing' : '')} style={{ left: pos?.x ?? m.x, top: pos?.y ?? m.y, visibility: pos ? 'visible' : 'hidden' }} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {m.title && <div className="ctx-title">{m.title}</div>}
      {m.items.map((it, i) => {
        if (it === 'sep') return <div key={i} className="ctx-sep" />;
        if (it.options) {
          return (
            <div key={i} className="ctx-row">
              <span className="ctx-label">{it.label}</span>
              <span className="ctx-seg">
                {it.options.map(([v, n]) => <button key={v} className={it.value === v ? 'on' : ''} onClick={() => { it.onPick(v); if (!it.keepOpen) onClose(); }}>{n}</button>)}
              </span>
            </div>
          );
        }
        if (it.color) {
          return (
            <div key={i} className="ctx-row">
              <span className="ctx-label">{it.label}</span>
              <span className="ctx-seg">
                <input type="color" value={it.value || '#2DD4BF'} onChange={(e) => it.onPick(e.target.value.toUpperCase())} />
                {it.onReset && <button onClick={() => { it.onReset(); onClose(); }}>기본</button>}
              </span>
            </div>
          );
        }
        return (
          <button key={i} className={'ctx-item' + (it.danger ? ' danger' : '') + (it.ask ? ' ask' : '')} disabled={it.disabled} onClick={() => { it.action(); onClose(); }}>
            {it.label}{it.hint && <small>{it.hint}</small>}
          </button>
        );
      })}
    </div>
  );
}
