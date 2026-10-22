// 선택한 것 위에 떠 있는 "AI에게 물어보기" 바. 클릭하면 질문 입력칸이 펼쳐지고, 빈칸으로 보내면 기본 질문을 한다.
import React, { useEffect, useState } from 'react';
import { NodeToolbar, Position, useStore } from '@xyflow/react';

const selectedIds = (s) => s.nodes.filter((n) => n.selected).map((n) => n.id).join(',');

export function AskBar({ onAsk, busy }) {
  const ids = useStore(selectedIds);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => { setOpen(false); setQ(''); }, [ids]);
  if (!ids) return null;
  const list = ids.split(',');
  const send = () => { onAsk(q); setOpen(false); setQ(''); };
  // 툴바 안의 클릭이 캔버스(선택 해제/노드 선택)로 새지 않게 막는다
  const stop = (e) => e.stopPropagation();
  return (
    <NodeToolbar nodeId={list} isVisible position={Position.Top} offset={14} className="askbar-wrap nodrag nopan"
      onPointerDown={stop} onMouseDown={stop} onClick={stop} onDoubleClick={stop} onContextMenu={stop}>
      {!open ? (
        <button className="askbar" onClick={() => setOpen(true)} disabled={!!busy} title="선택한 것에 대해 AI에게 묻습니다">
          <span className={'spark' + (busy === 'ask' ? ' pulse' : '')}>✦</span>{busy === 'ask' ? <span className="busy"><span>답변 준비 중</span><span className="busy-dots" aria-hidden="true"><i /><i /><i /></span></span> : list.length > 1 ? `선택한 ${list.length}개 AI에게 물어보기` : 'AI에게 물어보기'}
        </button>
      ) : (
        <div className="askbar open nodrag nopan">
          <span className="spark">✦</span>
          <input
            autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="무엇이든 물어보세요 (비우면 역할·보강점을 묻습니다)"
            onKeyDown={(e) => { if (e.key === 'Enter') send(); if (e.key === 'Escape') setOpen(false); e.stopPropagation(); }}
          />
          <button className="small primary" onClick={send}>보내기</button>
          <button className="small" onClick={() => setOpen(false)}>닫기</button>
        </div>
      )}
    </NodeToolbar>
  );
}
