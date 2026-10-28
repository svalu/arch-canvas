// 문서 탭 줄: 여러 다이어그램을 오가며 그린다. 클릭=전환, 더블클릭=이름 바꾸기, 가운데 클릭/×=닫기, 끌어서 순서 바꾸기, 오른쪽 클릭=메뉴.
import React, { useState } from 'react';
import { Icon } from './Icons.jsx';

export function DocTabs({ docs, onSwitch, onAdd, onClose, onRename, onDuplicate, onMove, onContext }) {
  const [editing, setEditing] = useState(null);
  const [drag, setDrag] = useState(null);
  return (
    <div className="doctabs" role="tablist" aria-label="다이어그램 탭">
      {docs.list.map((d, i) => {
        const active = d.id === docs.active;
        return (
          <div
            key={d.id} role="tab" aria-selected={active} tabIndex={0}
            className={'doctab' + (active ? ' on' : '') + (drag?.over === i ? ' drop' : '')}
            title={d.title}
            onClick={() => onSwitch(d.id)}
            onDoubleClick={() => setEditing(d.id)}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); onClose(d.id); } }}
            onContextMenu={(e) => { e.preventDefault(); onContext(e, d, i); }}
            onKeyDown={(e) => { if (e.key === 'Enter') onSwitch(d.id); if (e.key === 'F2') setEditing(d.id); }}
            draggable={editing !== d.id}
            onDragStart={(e) => { e.dataTransfer.setData('application/x-doctab', String(i)); setDrag({ from: i, over: i }); }}
            onDragOver={(e) => { if (drag) { e.preventDefault(); if (drag.over !== i) setDrag({ ...drag, over: i }); } }}
            onDrop={(e) => { e.preventDefault(); if (drag && drag.from !== i) onMove(drag.from, i); setDrag(null); }}
            onDragEnd={() => setDrag(null)}
          >
            {editing === d.id ? (
              <input
                autoFocus defaultValue={d.title} className="doctab-input"
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== d.title) onRename(d.id, v); setEditing(null); }}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(null); }}
              />
            ) : <span className="doctab-title">{d.title}</span>}
            <button className="doctab-x" title="닫기 (가운데 클릭)" aria-label={`${d.title} 닫기`} onClick={(e) => { e.stopPropagation(); onClose(d.id); }}><Icon name="close" size={12} /></button>
          </div>
        );
      })}
      <button className="doctab-add" title="새 다이어그램 탭 (Ctrl+T)" aria-label="새 탭" onClick={() => onAdd()}>+</button>
    </div>
  );
}
