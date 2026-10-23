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

// 선 끝 옮기기: 선택한 선의 양 끝 손잡이를 끈다. 끄는 동안 선 자체가 커서를 따라오고,
// 요소 위에 놓으면 그 요소에 연결, 빈 곳에 놓으면 그 자리에 끝이 남는다 (App 이 arch-reconnect 를 받아 반영)
function useEndDrag(id) {
  const rf = useReactFlow();
  const [drag, setDrag] = useState(null);   // { end, x, y, node } 흐름 좌표, node = 지금 올라가 있는 요소
  const start = (end) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch { /* 없어도 동작 */ }
    let lit = null, raf = 0, last = e;
    const light = (n) => { if (lit === n) return; lit?.classList.remove('reconnect-target'); lit = n; lit?.classList.add('reconnect-target'); };
    const nodeAt = (ev) => document.elementsFromPoint(ev.clientX, ev.clientY).map((x) => x.closest?.('.react-flow__node')).find(Boolean) || null;
    const frame = () => {
      raf = 0;
      const p = rf.screenToFlowPosition({ x: last.clientX, y: last.clientY });
      const n = nodeAt(last); light(n);
      setDrag({ end, x: p.x, y: p.y, node: n?.dataset.id || null });
    };
    const move = (ev) => { last = ev; if (!raf) raf = requestAnimationFrame(frame); };
    const done = (ev) => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', done); el.removeEventListener('pointercancel', done);
      if (raf) cancelAnimationFrame(raf);
      const hit = ev.type === 'pointerup' ? nodeAt(ev) : null; light(null); setDrag(null);
      if (ev.type !== 'pointerup') return;
      const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      window.dispatchEvent(new CustomEvent('arch-reconnect', { detail: { id, end, node: hit?.dataset.id || null, point: { x: Math.round(p.x), y: Math.round(p.y) } } }));
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', done); el.addEventListener('pointercancel', done);
    frame();
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
  const rf = useReactFlow();
  const a = useInternalNode(source);
  const b = useInternalNode(target);
  const { drag, start } = useEndDrag(id);
  const bd = useBendDrag(id);
  if (!a || !b) return null;
  // 끝 사각형: 요소, 빈 끝(좌표), 또는 끄는 중인 커서 위치
  const rectOf = (end, n, pt) => {
    if (drag?.end === end) {
      const over = drag.node && drag.node !== (end === 'source' ? target : source) ? rf.getInternalNode(drag.node) : null;
      return over ? [rectOfInternal(over), dropOf(over)] : [{ x: drag.x, y: drag.y, w: 0, h: 0 }, 0];
    }
    return pt ? [{ x: pt.x, y: pt.y, w: 0, h: 0 }, 0] : [rectOfInternal(n), dropOf(n)];
  };
  const [ra, da] = rectOf('source', a, data.sp), [rb, db] = rectOf('target', b, data.tp);
  const geo = edgeGeometry(ra, rb, da, db);
  const bend = bd.bend ?? bendOf(data.bend);
  const { d, mid } = edgePath(geo, data.shape, bend);
  const bent = isBent(geo, data.shape);
  // 손잡이: 가운데 구간 위. 이름표가 있으면 겹치지 않게 구간의 1/4 지점
  const hp = !data.label ? mid : geo.horizontal ? { x: mid.x, y: geo.p1.y + (geo.p2.y - geo.p1.y) * 0.25 } : { x: geo.p1.x + (geo.p2.x - geo.p1.x) * 0.25, y: mid.y };
  return (
    <>
      <BaseEdge
        id={id}
        path={d}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{ stroke: selected ? '#2E73B8' : EDGE_COLOR(), strokeWidth: selected ? LINE_PX + 1 : LINE_PX + 0.4, strokeDasharray: data.line === 'dashed' ? '6 4' : undefined }}
      />
      {(selected || drag) && (
        <EdgeLabelRenderer>
          {[['source', geo.p1, data.sp], ['target', geo.p2, data.tp]].map(([end, p, free]) => (
            <div key={end} className={'edge-end nodrag nopan' + (free ? ' free' : '') + (drag?.end === end ? ' dragging' : '')} title="끌어서 다른 요소에 놓으면 연결 대상이 바뀌고, 빈 곳에 놓으면 그 자리에 끝이 남습니다"
              style={{ transform: `translate(-50%,-50%) translate(${p.x}px,${p.y}px)` }}
              onPointerDown={start(end)} />
          ))}
          {bent && !drag && (
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
