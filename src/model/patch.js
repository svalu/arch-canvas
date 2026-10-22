// 그래프 패치. 나중에 모델(Claude)이 자연어를 이 명령 목록으로 바꿔 내보내고, 캔버스는 applyPatch 로 반영한다.
// 지금은 캔버스의 "패치 적용" 창과 테스트에서 쓴다. 원본 그래프는 건드리지 않고 새 그래프를 돌려준다.
//
// 명령(op) 목록
//   add_group  { id?, kind, label?, parent?, x?, y?, w?, h? }
//   add_node   { id?, icon, label?, parent?, x?, y? }            x/y 를 안 주면 부모 그룹 안 빈 자리에 놓는다
//   connect    { id?, source, target, label?, line?, shape?, arrow? }
//   disconnect { id } | { source, target }
//   move_into  { id, parent, x?, y? }                             화면상 위치는 그대로, 부모만 바꾼다 (parent=null 이면 최상위)
//   move       { id, x?, y? }                                     부모 기준 좌표 (한쪽만 주면 다른 쪽은 그대로)
//   resize     { id, w, h }                                       그룹만
//   update     { id, set: { label?, kind?, icon?, line?, shape?, arrow?, x?, y?, w?, h? } }
//   remove     { id }                                             그룹이면 안의 것까지, 걸린 엣지와 핀도 함께
//   annotate   { id?, target, level, message }                    검수 핀
//   clear_annotations { target? }
//
// 결과: { graph, applied, errors: [{ index, op, message }] }. 잘못된 명령은 건너뛰고 나머지는 계속 반영한다.
// id/source/target/parent 는 문자열로, 좌표·크기는 숫자로 바꿔서 쓴다(숫자로 못 바꾸면 그 명령만 오류).

import { normalizeGraph, sortGroups, uid, allIds, toText, EDGE_DEFAULTS, LINES, SHAPES, ARROWS, LEVELS } from './schema.js';
import { absoluteRects, descendants, fitGroups, freeSlot, packAutoGroups } from './geometry.js';
import { placeAutoNodes } from './place.js';

// 이번 applyPatch 에서 좌표 없이 놓인 그룹 id (끝에 겹치지 않게 다시 배치).
// pos: 자리를 자동으로 잡을 그룹, size: 크기를 명시해서 자동 배치 때 줄이지 않을 그룹
const AUTO = new WeakMap();
const MIN = { group: { w: 80, h: 60 }, card: { w: 120, h: 48 } };

/**
 * @param {object} graph   현재 그래프
 * @param {Array}  ops     패치 명령 목록
 * @param {object} [catalog] { iconKeys:Set, groupKinds:Set } 를 주면 아이콘/그룹 종류 이름을 검사한다
 */
export function applyPatch(graph, ops, catalog) {
  const g = structuredClone(normalizeGraph(graph));
  AUTO.set(g, { pos: new Set(), size: new Set(), nodes: new Set(), parented: new Set() });
  const errors = [];
  let applied = 0;
  const list = Array.isArray(ops) ? ops : ops?.ops || [];
  list.forEach((raw, index) => {
    // 모델이 op 대신 type/action 으로 쓰기도 해서 셋 다 받는다
    const op = raw && typeof raw === 'object' ? { ...raw, op: raw.op ?? raw.type ?? raw.action } : raw;
    try {
      if (op && typeof op === 'object') for (const k of ['id', 'source', 'target', 'parent']) if (op[k] != null) op[k] = String(op[k]);
      OPS[op?.op] ? OPS[op.op](g, op, catalog) : fail(`모르는 op입니다: ${op?.op}`);
      applied++;
    } catch (e) {
      errors.push({ index, op: op?.op, message: e.message });
    }
  });
  g.groups = sortGroups(g.groups);
  const auto = AUTO.get(g);
  packAutoGroups(g, auto.pos, auto.size);
  fitGroups(g);
  // 좌표 없이 들어온 노드는 연결 관계를 보고 자리를 정한다 (그룹 배치가 끝난 뒤)
  placeAutoNodes(g, auto.nodes, auto.parented);
  fitGroups(g);
  return { graph: g, applied, errors };
}

function fail(msg) { throw new Error(msg); }
const findGroup = (g, id) => g.groups.find((x) => x.id === id);
const findItem = (g, id) => g.groups.find((x) => x.id === id) || g.nodes.find((x) => x.id === id);
const checkParent = (g, parent) => {
  if (parent == null) return null;
  if (!findGroup(g, parent)) fail(`부모 그룹이 없습니다: ${parent}`);
  return parent;
};
const newId = (g, want, prefix) => {
  const ids = allIds(g);
  if (want != null && want !== '') { want = String(want); if (ids.has(want)) fail(`이미 있는 id입니다: ${want}`); return want; }
  return uid(prefix, ids);
};
/** 숫자 필드: 없으면 undefined, 숫자로 못 바꾸면 오류. 소수 한 자리로 반올림. */
const numField = (v, what = '좌표') => {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'string' ? Number(v.trim()) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n) || (typeof v === 'string' && !v.trim())) fail(`${what}가 숫자가 아닙니다: ${JSON.stringify(v)}`);
  return Math.round(n * 10) / 10;
};
const minOf = (item) => (item.type === 'card' ? MIN.card : item.type === 'text' ? { w: 40, h: 20 } : item.type === 'badge' ? { w: 20, h: 20 } : MIN.group);
const dropAuto = (g, id) => { AUTO.get(g)?.pos.delete(id); AUTO.get(g)?.nodes.delete(id); };

const OPS = {
  add_group(g, op, cat) {
    if (cat && !cat.groupKinds.has(op.kind)) fail(`모르는 그룹 종류입니다: ${op.kind}`);
    const parent = checkParent(g, op.parent);
    const x = numField(op.x), y = numField(op.y), w = numField(op.w, '크기'), h = numField(op.h, '크기');
    const id = newId(g, op.id, op.kind || 'group');
    const auto = x == null || y == null;
    const pos = auto ? freeSlot(g, parent) : { x, y };
    if (auto) AUTO.get(g)?.pos.add(id);
    if (w != null || h != null) AUTO.get(g)?.size.add(id);   // 크기를 줬으면 자동 배치 때 줄이지 않는다
    g.groups.push({ id, kind: op.kind || 'generic', label: toText(op.label), parent, x: pos.x, y: pos.y, w: Math.max(MIN.group.w, w ?? 320), h: Math.max(MIN.group.h, h ?? 200), ...(op.color ? { color: op.color } : {}), ...('fill' in op ? { fill: op.fill } : {}), ...(op.line ? { line: op.line } : {}) });
  },
  add_node(g, op, cat) {
    if (!op.icon) fail('icon 이 필요합니다');
    if (cat && !cat.iconKeys.has(op.icon)) fail(`모르는 아이콘입니다: ${op.icon}`);
    const parent = checkParent(g, op.parent);
    const x = numField(op.x), y = numField(op.y);
    const id = newId(g, op.id, 'n');
    const pos = x == null || y == null ? freeSlot(g, parent) : { x, y };
    if (x == null || y == null) { AUTO.get(g)?.nodes.add(id); if (parent) AUTO.get(g)?.parented.add(id); }
    g.nodes.push({ id, icon: op.icon, label: toText(op.label), parent, x: pos.x, y: pos.y });
  },
  // 카드(솔루션 구성도): 아이콘은 선택, 제목(label) + 설명(body)
  add_card(g, op, cat) {
    if (op.icon && cat && !cat.iconKeys.has(op.icon)) fail(`모르는 아이콘입니다: ${op.icon}`);
    const parent = checkParent(g, op.parent);
    const x = numField(op.x), y = numField(op.y), w = numField(op.w, '크기'), h = numField(op.h, '크기');
    const id = newId(g, op.id, 'c');
    const pos = x == null || y == null ? freeSlot(g, parent) : { x, y };
    g.nodes.push({ id, type: 'card', icon: op.icon || null, label: toText(op.label), body: toText(op.body), parent, x: pos.x, y: pos.y, w: Math.max(MIN.card.w, w ?? 200), h: Math.max(MIN.card.h, h ?? 84), ...(op.accent ? { accent: op.accent } : {}) });
  },
  connect(g, op) {
    if (!findItem(g, op.source)) fail(`source 가 없습니다: ${op.source}`);
    if (!findItem(g, op.target)) fail(`target 이 없습니다: ${op.target}`);
    if (op.source === op.target) fail('자기 자신과는 연결할 수 없습니다');
    const id = newId(g, op.id, 'e');
    g.edges.push({
      ...EDGE_DEFAULTS,
      id, source: op.source, target: op.target,
      label: toText(op.label),
      line: LINES.includes(op.line) ? op.line : EDGE_DEFAULTS.line,
      shape: SHAPES.includes(op.shape) ? op.shape : EDGE_DEFAULTS.shape,
      arrow: ARROWS.includes(op.arrow) ? op.arrow : EDGE_DEFAULTS.arrow,
    });
  },
  disconnect(g, op) {
    const gone = new Set(g.edges.filter((e) => (op.id ? e.id === op.id : e.source === op.source && e.target === op.target)).map((e) => e.id));
    if (!gone.size) fail('지울 연결선이 없습니다');
    g.edges = g.edges.filter((e) => !gone.has(e.id));
    g.annotations = g.annotations.filter((a) => !gone.has(a.target));
  },
  move_into(g, op) {
    const item = findItem(g, op.id) || fail(`없는 id입니다: ${op.id}`);
    const parent = checkParent(g, op.parent ?? null);
    if (parent && (parent === item.id || descendants(g, item.id).has(parent))) fail('자기 안으로는 넣을 수 없습니다');
    const x = numField(op.x), y = numField(op.y);
    const rects = absoluteRects(g);
    const abs = rects.get(item.id);
    const po = parent ? rects.get(parent) : { x: 0, y: 0 };
    item.parent = parent;
    AUTO.get(g)?.parented.add(item.id);
    item.x = Math.round(abs.x - po.x);
    item.y = Math.round(abs.y - po.y);
    if (x != null) item.x = x;
    if (y != null) item.y = y;
    if (x != null || y != null) dropAuto(g, item.id);
  },
  move(g, op) {
    const item = findItem(g, op.id) || fail(`없는 id입니다: ${op.id}`);
    const x = numField(op.x), y = numField(op.y);
    if (x == null && y == null) fail('옮길 좌표(x, y)가 없습니다');
    if (x != null) item.x = x;
    if (y != null) item.y = y;
    dropAuto(g, item.id);
  },
  resize(g, op) {
    const grp = findGroup(g, op.id) || fail(`그룹이 아닙니다: ${op.id}`);
    const w = numField(op.w, '크기'), h = numField(op.h, '크기');
    if (w == null && h == null) fail('크기(w, h)가 없습니다');
    if (w != null) grp.w = Math.max(MIN.group.w, w);
    if (h != null) grp.h = Math.max(MIN.group.h, h);
    AUTO.get(g)?.size.add(grp.id);
  },
  update(g, op, cat) {
    const item = findItem(g, op.id) || g.edges.find((e) => e.id === op.id) || fail(`없는 id입니다: ${op.id}`);
    const set = op.set && typeof op.set === 'object' ? op.set : {};
    if (set.kind != null && cat && !cat.groupKinds.has(set.kind)) fail(`모르는 그룹 종류입니다: ${set.kind}`);
    if (set.icon != null && cat && !cat.iconKeys.has(set.icon)) fail(`모르는 아이콘입니다: ${set.icon}`);
    // 숫자 먼저 검사(잘못되면 아무것도 바꾸지 않는다)
    const nums = {};
    for (const k of ['x', 'y', 'w', 'h']) if (k in set && k in item) nums[k] = numField(set[k], k === 'w' || k === 'h' ? '크기' : '좌표');
    for (const k of ['label', 'kind', 'icon', 'line', 'shape', 'arrow', 'body', 'accent', 'color', 'fill']) {
      if (!(k in set)) continue;
      if (!(k in item || (item.type === 'card' && ['body', 'accent', 'icon'].includes(k)) || (item.type === 'text' && ['accent', 'size', 'bold'].includes(k)) || (item.type === 'badge' && k === 'accent') || k === 'locked' || (item.kind && ['color', 'fill', 'line'].includes(k)))) continue;
      item[k] = k === 'label' || k === 'body' ? toText(set[k]) : set[k];
    }
    for (const [k, v] of Object.entries(nums)) if (v != null) item[k] = k === 'w' || k === 'h' ? Math.max(minOf(item)[k], v) : v;
    if (nums.x != null || nums.y != null) dropAuto(g, item.id);
    if (nums.w != null || nums.h != null) AUTO.get(g)?.size.add(item.id);
  },
  remove(g, op) {
    if (!findItem(g, op.id) && !g.edges.some((e) => e.id === op.id)) fail(`없는 id입니다: ${op.id}`);
    const gone = new Set([op.id, ...descendants(g, op.id)]);
    for (const e of g.edges) if (gone.has(e.source) || gone.has(e.target)) gone.add(e.id);   // 걸린 엣지(와 그 핀)도 함께
    g.groups = g.groups.filter((x) => !gone.has(x.id));
    g.nodes = g.nodes.filter((x) => !gone.has(x.id));
    g.edges = g.edges.filter((e) => !gone.has(e.id));
    g.annotations = g.annotations.filter((a) => !gone.has(a.target));
  },
  annotate(g, op) {
    if (!findItem(g, op.target) && !g.edges.some((e) => e.id === op.target)) fail(`없는 target입니다: ${op.target}`);
    const id = newId(g, op.id, 'a');
    g.annotations.push({ id, target: op.target, level: LEVELS.includes(op.level) ? op.level : 'info', message: toText(op.message) });
  },
  clear_annotations(g, op) {
    g.annotations = op.target != null ? g.annotations.filter((a) => a.target !== op.target) : [];
  },
};

export const PATCH_OPS = Object.keys(OPS);
