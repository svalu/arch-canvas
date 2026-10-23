// JSON 그래프 <-> React Flow 노드/엣지.
// 그리는 순서: 그룹은 groups 배열 순서대로 zIndex 를 주고, 엣지는 그룹 위, 아이콘은 맨 위.
import { normalizeGraph, sortGroups, SCHEMA, ICON_SIZE } from './schema.js';
import { isOverlay } from './contain.js';

export const Z_EDGE = 9000;
export const Z_ICON = 10000;

export function graphToFlow(input) {
  const g = normalizeGraph(input);
  const pins = new Map();
  for (const a of g.annotations) (pins.get(a.target) || pins.set(a.target, []).get(a.target)).push(a);
  const nodes = [];
  g.groups.forEach((x, i) => {
    nodes.push({
      id: x.id,
      type: 'awsGroup',
      position: { x: x.x, y: x.y },
      ...(x.parent ? { parentId: x.parent } : {}),
      width: x.w,
      height: x.h,
      // 띠: 담는 상자(1~) < 겹치는 상자(3000~) < 연결선(9000) < 아이콘(10000~) < 번호(15000~)
      zIndex: (isOverlay(x) ? 3000 : 0) + i + 1,
      ...(x.locked ? { draggable: false, className: 'is-locked' } : {}),
      data: { locked: !!x.locked, ...(x.set ? { set: x.set } : {}), ...(typeof x.overlay === 'boolean' ? { overlay: x.overlay } : {}), kind: x.kind, label: x.label, pins: pins.get(x.id) || [], ...(x.color ? { color: x.color } : {}), ...('fill' in x ? { fill: x.fill } : {}), ...(x.line ? { line: x.line } : {}) },
    });
  });
  g.nodes.forEach((n, ni) => {
    const card = n.type === 'card', text = n.type === 'text', badge = n.type === 'badge', box = card || text || badge;
    nodes.push({
      id: n.id,
      type: card ? 'awsCard' : text ? 'awsText' : badge ? 'awsBadge' : 'awsIcon',
      position: { x: n.x, y: n.y },
      ...(n.parent ? { parentId: n.parent } : {}),
      width: box ? n.w : ICON_SIZE,
      height: box ? n.h : ICON_SIZE,
      // 아이콘끼리는 배열 순서가 곧 앞뒤 순서(뒤가 앞). 번호 배지는 늘 맨 위
      zIndex: (badge ? Z_ICON + 5000 : Z_ICON) + ni,
      ...(n.locked ? { draggable: false, className: 'is-locked' } : {}),
      data: { locked: !!n.locked, ...(n.set ? { set: n.set } : {}), icon: n.icon, label: n.label, pins: pins.get(n.id) || [], ...(card ? { body: n.body, accent: n.accent } : {}), ...(text ? { size: n.size, bold: n.bold, accent: n.accent } : {}), ...(badge ? { accent: n.accent } : {}) },
    });
  });
  const edges = g.edges.map((e) => edgeToFlow(e, pins.get(e.id), g.theme));
  return { nodes, edges, title: g.title, annotations: g.annotations, context: g.context, mode: g.mode, theme: g.theme };
}

const ARROW = (theme) => ({ type: 'arrowclosed', color: theme === 'dark' ? '#7FE3D6' : '#232F3E', width: 12, height: 12 });

export function edgeToFlow(e, pins = [], theme = 'light') {
  return {
    id: e.id,
    source: e.source ?? e.target,
    target: e.target ?? e.source,
    type: 'arch',
    zIndex: Z_EDGE,
    ...(e.arrow !== 'none' ? { markerEnd: ARROW(theme) } : {}),
    ...(e.arrow === 'both' ? { markerStart: ARROW(theme) } : {}),
    data: { label: e.label, line: e.line, shape: e.shape, arrow: e.arrow, pins, ...(typeof e.bend === 'number' ? { bend: e.bend } : {}), ...(e.sp ? { sp: e.sp } : {}), ...(e.tp ? { tp: e.tp } : {}) },
  };
}

const r1 = (v) => Math.round(v * 10) / 10;

export function flowToGraph(nodes, edges, { title = '새 다이어그램', annotations = [], context = null, mode = 'infra', theme = 'light' } = {}) {
  const groups = [], items = [];
  for (const n of nodes) {
    if (n.type === 'awsGroup') {
      groups.push({
        id: n.id, kind: n.data.kind, label: n.data.label ?? '', parent: n.parentId || null, ...(n.data.locked ? { locked: true } : {}), ...(n.data.set ? { set: n.data.set } : {}), ...(typeof n.data.overlay === 'boolean' ? { overlay: n.data.overlay } : {}),
        x: r1(n.position.x), y: r1(n.position.y),
        w: r1(n.width ?? n.measured?.width ?? 320), h: r1(n.height ?? n.measured?.height ?? 200),
        ...(n.data.color ? { color: n.data.color } : {}), ...('fill' in n.data ? { fill: n.data.fill } : {}), ...(n.data.line ? { line: n.data.line } : {}),
      });
    } else if (n.type === 'awsIcon') {
      items.push({ id: n.id, icon: n.data.icon, label: n.data.label ?? '', parent: n.parentId || null, x: r1(n.position.x), y: r1(n.position.y), ...(n.data.locked ? { locked: true } : {}), ...(n.data.set ? { set: n.data.set } : {}) });
    } else if (n.type === 'awsText' || n.type === 'awsBadge') {
      const text = n.type === 'awsText';
      items.push({
        id: n.id, type: text ? 'text' : 'badge', icon: null, label: n.data.label ?? '', parent: n.parentId || null, ...(n.data.locked ? { locked: true } : {}), ...(n.data.set ? { set: n.data.set } : {}),
        x: r1(n.position.x), y: r1(n.position.y), w: r1(n.width ?? n.measured?.width ?? (text ? 180 : 28)), h: r1(n.height ?? n.measured?.height ?? (text ? 40 : 28)),
        ...(text ? { size: n.data.size || 'md', bold: !!n.data.bold } : {}), ...(n.data.accent ? { accent: n.data.accent } : {}),
      });
    } else if (n.type === 'awsCard') {
      items.push({
        id: n.id, type: 'card', icon: n.data.icon || null, label: n.data.label ?? '', body: n.data.body ?? '', parent: n.parentId || null, ...(n.data.locked ? { locked: true } : {}), ...(n.data.set ? { set: n.data.set } : {}),
        x: r1(n.position.x), y: r1(n.position.y), w: r1(n.width ?? n.measured?.width ?? 200), h: r1(n.height ?? n.measured?.height ?? 84),
        ...(n.data.accent ? { accent: n.data.accent } : {}),
      });
    }
  }
  return {
    schema: SCHEMA,
    title,
    mode, theme,
    context: context || { title: '', requirements: '', constraints: '' },
    groups: sortGroups(groups),
    nodes: items,
    edges: edges.map((e) => ({
      id: e.id, source: e.data?.sp ? null : e.source, target: e.data?.tp ? null : e.target,
      ...(e.data?.sp ? { sp: e.data.sp } : {}), ...(e.data?.tp ? { tp: e.data.tp } : {}),
      label: e.data?.label ?? '', line: e.data?.line ?? 'solid', shape: e.data?.shape ?? 'straight', arrow: e.data?.arrow ?? 'end',
      ...(typeof e.data?.bend === 'number' ? { bend: e.data.bend } : {}),
    })),
    annotations,
  };
}
