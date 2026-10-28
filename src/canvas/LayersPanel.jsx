// 레이어 목록(고급): 실제로 그려지는 순서 그대로 한 줄씩. 위에 있는 줄이 앞에 그려진다.
// 소속은 화면 위치로 정해지므로 여기서는 바꾸지 않고, 회색 꼬리표로만 보여 준다. 줄을 끌어 다른 줄 위에 놓으면 그 앞으로.
import React, { useMemo, useState } from 'react';
import { Icon } from '../Icons.jsx';
import { useCatalog } from '../catalog.js';
import { layerList } from '../model/layers.js';
import { isOverlay } from '../model/contain.js';

export function LayersPanel({ graph, selected, onSelect, onMove, onOrder, onLock, onClose }) {
  const catalog = useCatalog();
  const rows = useMemo(() => layerList(graph), [graph]);
  const [drag, setDrag] = useState(null);   // { id, over }
  const sel = new Set(selected);
  const byId = useMemo(() => new Map([...graph.groups, ...graph.nodes].map((x) => [x.id, x])), [graph]);
  const nameOfItem = (x) => {
    if (!x) return '';
    if ('w' in x && 'kind' in x) return x.label || catalog.kinds.get(x.kind)?.name || '상자';
    if (x.type === 'text') return x.label?.split('\n')[0] || '글상자';
    if (x.type === 'badge') return `번호 ${x.label || ''}`;
    return x.label || catalog.icons.get(x.icon)?.name || '아이콘';
  };
  // 소속 꼬리표: 가까운 상자 두 단계까지
  const tagOf = (x) => {
    const names = [];
    for (let p = x.parent, i = 0; p && i < 2; p = byId.get(p)?.parent, i++) names.push(nameOfItem(byId.get(p)));
    return names.join(' · ');
  };
  const sets = new Map();
  for (const x of [...graph.groups, ...graph.nodes]) if (x.set) sets.set(x.set, (sets.get(x.set) || 0) + 1);
  const setNo = new Map([...sets.keys()].map((k, i) => [k, i + 1]));
  let lastBand = null;
  const bandOf = (r) => (r.kind === 'group' ? (isOverlay(r.item) ? '겹치는 상자' : '담는 상자') : r.item.type === 'badge' ? '번호' : '아이콘 · 글');
  return (
    <div className="insp layers">
      <h3>레이어 목록 <button className="small lyr-close" onClick={onClose} aria-label="닫기">닫기</button></h3>
      <p className="hint">위에 있을수록 앞에 그려집니다. 순서는 요소를 오른쪽 클릭해서 바꾸는 것이 가장 쉽습니다. 여기서는 줄을 끌어 다른 줄 위에 놓으면 그 앞으로 갑니다.</p>
      <div className="lyr-order" role="group" aria-label="앞뒤 순서">
        <button className="small" disabled={!selected.length} onClick={() => onOrder('front')} title="맨 앞으로 (Ctrl+Shift+])">맨 앞</button>
        <button className="small" disabled={!selected.length} onClick={() => onOrder('forward')} title="앞으로 (Ctrl+])">앞으로</button>
        <button className="small" disabled={!selected.length} onClick={() => onOrder('backward')} title="뒤로 (Ctrl+[)">뒤로</button>
        <button className="small" disabled={!selected.length} onClick={() => onOrder('back')} title="맨 뒤로 (Ctrl+Shift+[)">맨 뒤</button>
      </div>
      <div className="lyr-tree" role="listbox" aria-label="레이어" aria-multiselectable="true">
        {rows.map((row) => {
          const x = row.item, isG = row.kind === 'group';
          const kind = isG ? catalog.kinds.get(x.kind) : null;
          const icon = !isG && x.icon ? catalog.icons.get(x.icon) : null;
          const band = bandOf(row), head = band !== lastBand; lastBand = band;
          const tag = tagOf(x);
          return (
            <React.Fragment key={row.id}>
              {head && <div className="lyr-band">{band}</div>}
              <div
                className={'lyr-row' + (sel.has(row.id) ? ' on' : '') + (drag?.over === row.id ? ' drop-before' : '') + (x.locked ? ' locked' : '')}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData('text/plain', row.id); setDrag({ id: row.id, over: null }); }}
                onDragOver={(e) => { if (drag && drag.id !== row.id) { e.preventDefault(); if (drag.over !== row.id) setDrag({ ...drag, over: row.id }); } }}
                onDragLeave={() => drag?.over === row.id && setDrag({ ...drag, over: null })}
                onDrop={(e) => { e.preventDefault(); if (drag && drag.id !== row.id) onMove(drag.id, row.id); setDrag(null); }}
                onDragEnd={() => setDrag(null)}
                onClick={(e) => onSelect(row.id, e.shiftKey || e.ctrlKey || e.metaKey)}
                role="option" aria-selected={sel.has(row.id)} tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') onSelect(row.id, false); }}
                title={nameOfItem(x) + (tag ? ` — ${tag} 안` : '')}
              >
                {isG
                  ? <span className="lyr-box" style={{ borderColor: x.color || kind?.color || '#7D8998', borderStyle: (x.line || kind?.line) === 'dashed' ? 'dashed' : 'solid' }} />
                  : icon ? <img src={icon.src} alt="" className="lyr-ic" /> : <span className="lyr-box txt">{x.type === 'badge' ? '#' : 'T'}</span>}
                <span className="lyr-text">
                  <span className="lyr-name">{nameOfItem(x)}</span>
                  {tag && <span className="lyr-sub">{tag}</span>}
                </span>
                {x.set && <span className="lyr-tag" title="Ctrl+G 묶음: 함께 선택되고 함께 움직입니다">묶음 {setNo.get(x.set)}</span>}
                <button className={'lyr-lock' + (x.locked ? ' on' : '')} title={x.locked ? '잠금 해제' : '잠그기 (움직이지 않음)'} aria-label={x.locked ? '잠금 해제' : '잠그기'} onClick={(e) => { e.stopPropagation(); onLock(row.id, !x.locked); }}><Icon name={x.locked ? 'lock' : 'unlock'} size={14} /></button>
              </div>
            </React.Fragment>
          );
        })}
        {!rows.length && <p className="hint">캔버스가 비어 있습니다.</p>}
      </div>
    </div>
  );
}
