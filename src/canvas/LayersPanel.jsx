// 레이어 패널: 무엇이 어느 상자 안에 들어 있는지(따라 움직이는 관계)와 앞뒤 순서를 한눈에.
// 위에 있는 줄이 앞에 그려진다. 줄을 끌어 상자 위에 놓으면 그 안으로, 다른 줄 위에 놓으면 그 앞으로.
import React, { useMemo, useState } from 'react';
import { useCatalog } from '../catalog.js';
import { layerTree } from '../model/layers.js';
import { isOverlay } from '../model/contain.js';

export function LayersPanel({ graph, selected, onSelect, onMove, onOrder, onLock }) {
  const catalog = useCatalog();
  const tree = useMemo(() => layerTree(graph), [graph]);
  const [closed, setClosed] = useState(() => new Set());
  const [drag, setDrag] = useState(null);   // { id, over }
  const sel = new Set(selected);
  const nameOf = (row) => {
    const x = row.item;
    if (row.kind === 'group') return x.label || catalog.kinds.get(x.kind)?.name || '상자';
    if (x.type === 'text') return x.label?.split('\n')[0] || '글상자';
    if (x.type === 'badge') return `번호 ${x.label || ''}`;
    return x.label || catalog.icons.get(x.icon)?.name || '아이콘';
  };
  const countAll = (row) => row.children.reduce((s, c) => s + 1 + countAll(c), 0);
  const Row = ({ row, depth }) => {
    const x = row.item, isG = row.kind === 'group';
    const kind = isG ? catalog.kinds.get(x.kind) : null;
    const icon = !isG && x.icon ? catalog.icons.get(x.icon) : null;
    const open = !closed.has(row.id);
    const n = isG ? countAll(row) : 0;
    return (
      <>
        <div
          className={'lyr-row' + (sel.has(row.id) ? ' on' : '') + (drag?.over === row.id ? (isG ? ' drop-in' : ' drop-before') : '') + (x.locked ? ' locked' : '')}
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable
          onDragStart={(e) => { e.dataTransfer.setData('text/plain', row.id); setDrag({ id: row.id, over: null }); }}
          onDragOver={(e) => { if (drag && drag.id !== row.id) { e.preventDefault(); if (drag.over !== row.id) setDrag({ ...drag, over: row.id }); } }}
          onDragLeave={() => drag?.over === row.id && setDrag({ ...drag, over: null })}
          onDrop={(e) => { e.preventDefault(); if (drag && drag.id !== row.id) onMove(drag.id, row.id); setDrag(null); }}
          onDragEnd={() => setDrag(null)}
          onClick={(e) => onSelect(row.id, e.shiftKey || e.ctrlKey || e.metaKey)}
          role="treeitem" aria-selected={sel.has(row.id)} aria-expanded={isG ? open : undefined} tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') onSelect(row.id, false); if (isG && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) setClosed((c) => { const s = new Set(c); if (e.key === 'ArrowLeft') s.add(row.id); else s.delete(row.id); return s; }); }}
          title={isG ? `${nameOf(row)} — 안에 ${n}개. 이 상자를 움직이면 안의 것도 함께 움직입니다` : nameOf(row)}
        >
          {isG
            ? <button className="lyr-tw" aria-label={open ? '접기' : '펼치기'} onClick={(e) => { e.stopPropagation(); setClosed((c) => { const s = new Set(c); if (open) s.add(row.id); else s.delete(row.id); return s; }); }}>{row.children.length ? (open ? '▾' : '▸') : ''}</button>
            : <span className="lyr-tw" />}
          {isG
            ? <span className="lyr-box" style={{ borderColor: x.color || kind?.color || '#7D8998', borderStyle: (x.line || kind?.line) === 'dashed' ? 'dashed' : 'solid' }} />
            : icon ? <img src={icon.src} alt="" className="lyr-ic" /> : <span className="lyr-box txt">{x.type === 'badge' ? '#' : 'T'}</span>}
          <span className="lyr-name" title={nameOf(row)}>{nameOf(row)}</span>
          {isG && isOverlay(x) && <span className="lyr-tag" title="겹치는 상자: 아무것도 품지 않고 테두리만 움직입니다">겹침</span>}
          {isG && n > 0 && <span className="lyr-count" title="함께 움직이는 요소 수">{n}</span>}
          <button className={'lyr-lock' + (x.locked ? ' on' : '')} title={x.locked ? '잠금 해제' : '잠그기 (끌어도 움직이지 않음)'} aria-label={x.locked ? '잠금 해제' : '잠그기'} onClick={(e) => { e.stopPropagation(); onLock(row.id, !x.locked); }}>{x.locked ? '🔒' : '🔓'}</button>
        </div>
        {isG && open && row.children.map((c) => <Row key={c.id} row={c} depth={depth + 1} />)}
      </>
    );
  };
  return (
    <div className="insp layers">
      <h3>레이어</h3>
      <p className="hint">소속은 화면 위치로 정해집니다: 아이콘은 가운데가 놓인 가장 작은 상자에, 상자는 자기를 완전히 감싸는 가장 작은 상자에 속하고, 속한 것은 상자를 따라 움직입니다. [겹침] 상자(ASG·보안 그룹)는 아무것도 품지 않습니다.</p>
      <div className="lyr-order" role="group" aria-label="앞뒤 순서">
        <button className="small" disabled={!selected.length} onClick={() => onOrder('front')} title="맨 앞으로 (Ctrl+Shift+])">맨 앞</button>
        <button className="small" disabled={!selected.length} onClick={() => onOrder('forward')} title="앞으로 (Ctrl+])">앞으로</button>
        <button className="small" disabled={!selected.length} onClick={() => onOrder('backward')} title="뒤로 (Ctrl+[)">뒤로</button>
        <button className="small" disabled={!selected.length} onClick={() => onOrder('back')} title="맨 뒤로 (Ctrl+Shift+[)">맨 뒤</button>
      </div>
      <div className="lyr-tree" role="tree" aria-label="레이어">
        {tree.map((row) => <Row key={row.id} row={row} depth={0} />)}
        {!tree.length && <p className="hint">캔버스가 비어 있습니다.</p>}
      </div>
      <p className="hint">아이콘·카드는 언제나 상자보다 앞에 그려집니다. 상자끼리, 아이콘끼리 순서를 바꿀 수 있습니다.</p>
    </div>
  );
}
