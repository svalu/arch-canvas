// 연결선. 양 끝 노드의 절대 사각형에서 면을 골라 그린다(geometry.js) — PowerPoint 내보내기와 같은 계산.
import React, { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, useInternalNode } from '@xyflow/react';
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

export const ArchEdge = memo(function ArchEdge({ id, source, target, data = {}, selected, markerStart, markerEnd }) {
  const a = useInternalNode(source);
  const b = useInternalNode(target);
  if (!a || !b) return null;
  const geo = edgeGeometry(rectOfInternal(a), rectOfInternal(b), dropOf(a), dropOf(b));
  const { d, mid } = edgePath(geo, data.shape);
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
