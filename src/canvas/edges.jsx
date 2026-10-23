// 연결선. 양 끝 노드의 절대 사각형에서 면을 골라 그린다(geometry.js) — PowerPoint 내보내기와 같은 계산.
import React, { memo, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, useInternalNode, useReactFlow } from '@xyflow/react';
import { edgeGeometry, edgePath, bendOf, isBent } from '../model/geometry.js';
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

// 직각선 꺾이는 위치 옮기기: 가운데 구간의 손잡이를 끌면 그 구간이 따라 움직인다. 두 번 클릭하면 가운데로.
function useBendDrag(id) {
  const rf = useReactFlow();
  const [bend, setBend] = useState(null);   // 끄는 중의 임시 값
  const start = (geo) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const { p1, p2, horizontal } = geo;
    const span = horizontal ? p2.x - p1.x : p2.y - p1.y;
    const at = (ev) => {
      const q = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const k = ((horizontal ? q.x - p1.x : q.y - p1.y)) / span;
      const snapPx = 6 / (rf.getZoom() || 1);
      return Math.abs((k - 0.5) * span) < snapPx ? 0.5 : Math.round(k * 1000) / 1000;   // 가운데 근처면 가운데에 붙는다
    };
    let last = null;
    const move = (ev) => { last = at(ev); setBend(last); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      setBend(null);
      if (last != null) window.dispatchEvent(new CustomEvent('arch-bend', { detail: { id, bend: last } }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };
  return { bend, start };
}

export const ArchEdge = memo(function ArchEdge({ id, source, target, data = {}, selected, markerStart, markerEnd }) {
  const a = useInternalNode(source);
  const b = useInternalNode(target);
  const { drag, start } = useEndDrag(id);
  const bd = useBendDrag(id);
  if (!a || !b) return null;
  const geo = edgeGeometry(rectOfInternal(a), rectOfInternal(b), dropOf(a), dropOf(b));
  const bend = bd.bend ?? bendOf(data.bend);
  const { d, mid } = edgePath(geo, data.shape, bend);
  const bent = isBent(geo, data.shape);
  // 손잡이: 가운데 구간 위. 이름표가 있으면 겹치지 않게 구간의 1/4 지점
  const hp = !data.label ? mid : geo.horizontal ? { x: mid.x, y: geo.p1.y + (geo.p2.y - geo.p1.y) * 0.25 } : { x: geo.p1.x + (geo.p2.x - geo.p1.x) * 0.25, y: mid.y };
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
          {bent && (
            <div className={'edge-bend nodrag nopan ' + (geo.horizontal ? 'h' : 'v')} title="끌어서 꺾이는 위치를 옮깁니다 · 두 번 클릭하면 가운데로"
              style={{ transform: `translate(-50%,-50%) translate(${hp.x}px,${hp.y}px)` }}
              onPointerDown={bd.start(geo)}
              onDoubleClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('arch-bend', { detail: { id, bend: 0.5 } })); }} />
          )}
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
