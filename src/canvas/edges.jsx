// 연결선. 양 끝 노드의 절대 사각형에서 면을 골라 그린다(geometry.js) — PowerPoint 내보내기와 같은 계산.
import React, { memo, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, useInternalNode, useReactFlow } from '@xyflow/react';
import { edgeGeometry, edgePath } from '../model/geometry.js';
import { LABEL_DROP } from '../model/schema.js';
import { INK, LINE_PX } from '../export/scene.js';

const dropOf = (n) => (n.type === 'awsIcon' && n.data?.label ? LABEL_DROP : 0);
const EDGE_COLOR = () => (document.querySelector('.app.theme-dark') ? '#7FE3D6' : INK);
import { Pins } from './nodes.jsx';

export const rectOfInternal = (n) => ({
  x: n.internals.positionAbsolute.x,
  y: n.internals.positionAbsolute.y,
  w: n.measured?.width ?? n.width ?? 48,
  h: n.measured?.height ?? n.height ?? 48,
});

// 라벨 위에서 오른쪽 클릭해도 그 연결선 메뉴가 뜨게 App 으로 알린다
const edgeCtx = (e, id) => { e.preventDefault(); e.stopPropagation(); window.dispatchEvent(new CustomEvent('arch-edge-ctx', { detail: { id, x: e.clientX, y: e.clientY } })); };

// 선 끝 옮기기: 선택한 선의 양 끝 손잡이를 끌어 다른 노드에 놓으면 연결 대상이 바뀐다 (App 이 arch-reconnect 를 받아 반영)
function useEndDrag(id) {
  const rf = useReactFlow();
  const [drag, setDrag] = useState(null);   // { end, x, y } 흐름 좌표
  const start = (end, from) => (e) => {
    e.preventDefault(); e.stopPropagation();
    let lit = null;
    const light = (el) => { if (lit === el) return; lit?.classList.remove('reconnect-target'); lit = el; lit?.classList.add('reconnect-target'); };
    const nodeAt = (ev) => document.elementsFromPoint(ev.clientX, ev.clientY).map((el) => el.closest?.('.react-flow__node')).find(Boolean) || null;
    const move = (ev) => { const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY }); setDrag({ end, x: p.x, y: p.y }); light(nodeAt(ev)); };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      const hit = nodeAt(ev); light(null); setDrag(null);
      if (hit?.dataset.id) window.dispatchEvent(new CustomEvent('arch-reconnect', { detail: { id, end, node: hit.dataset.id } }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    setDrag({ end, x: from.x, y: from.y });
  };
  return { drag, start };
}

export const ArchEdge = memo(function ArchEdge({ id, source, target, data = {}, selected, markerStart, markerEnd }) {
  const a = useInternalNode(source);
  const b = useInternalNode(target);
  const { drag, start } = useEndDrag(id);
  if (!a || !b) return null;
  const geo = edgeGeometry(rectOfInternal(a), rectOfInternal(b), dropOf(a), dropOf(b));
  const { d, mid } = edgePath(geo, data.shape);
  const fixed = drag ? (drag.end === 'source' ? geo.p2 : geo.p1) : null;
  return (
    <>
      {drag && <path className="edge-reconnect-preview" d={`M${fixed.x},${fixed.y} L${drag.x},${drag.y}`} />}
      <BaseEdge
        id={id}
        path={d}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{ stroke: selected ? '#2E73B8' : EDGE_COLOR(), strokeWidth: selected ? LINE_PX + 1 : LINE_PX + 0.4, strokeDasharray: data.line === 'dashed' ? '6 4' : undefined }}
      />
      {selected && !drag && (
        <EdgeLabelRenderer>
          {[['source', geo.p1], ['target', geo.p2]].map(([end, p]) => (
            <div key={end} className="edge-end nodrag nopan" title="끌어서 다른 요소에 놓으면 연결 대상이 바뀝니다"
              style={{ transform: `translate(-50%,-50%) translate(${p.x}px,${p.y}px)` }}
              onPointerDown={start(end, p)} />
          ))}
        </EdgeLabelRenderer>
      )}
      {(data.label || data.pins?.length > 0) && (
        <EdgeLabelRenderer>
          <div className="edge-label nodrag nopan" style={{ transform: `translate(-50%,-50%) translate(${mid.x}px,${mid.y}px)`, pointerEvents: 'all' }} onContextMenu={(e) => edgeCtx(e, id)}>
            {data.label}
            <Pins pins={data.pins} />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

export const edgeTypes = { arch: ArchEdge };
