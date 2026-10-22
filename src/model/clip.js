// 요소 복사·붙여넣기와 "조각 템플릿" 의 공통 부분: 선택한 것을 작은 그래프로 떼어 내고, 다른 그래프에 새 id 로 끼워 넣는다.
import { uid, allIds } from './schema.js';
import { absoluteRects, descendants, innermostGroupAt } from './geometry.js';

export const CLIP_MARK = 'arch-canvas/clip@1';

/** 선택 id 들(과 그 안의 것들)을 떼어 낸다. 좌표는 묶음의 왼쪽 위를 0,0 으로 하는 절대 좌표. */
export function extractSubgraph(g, ids) {
  const want = new Set(ids);
  const parentOf = (id) => (g.groups.find((x) => x.id === id) || g.nodes.find((x) => x.id === id))?.parent;
  const roots = [...g.groups, ...g.nodes].filter((x) => want.has(x.id)).filter((x) => { let p = parentOf(x.id); while (p) { if (want.has(p)) return false; p = parentOf(p); } return true; });
  if (!roots.length) return null;
  const sub = new Set();
  for (const r of roots) { sub.add(r.id); if (g.groups.some((q) => q.id === r.id)) for (const d of descendants(g, r.id)) sub.add(d); }
  const rects = absoluteRects(g);
  const rootIds = new Set(roots.map((r) => r.id));
  let x0 = Infinity, y0 = Infinity;
  for (const id of rootIds) { const r = rects.get(id); x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); }
  const fix = (x) => {
    const out = { ...x };
    if (rootIds.has(x.id)) { const r = rects.get(x.id); out.x = Math.round(r.x - x0); out.y = Math.round(r.y - y0); out.parent = null; }
    return out;
  };
  return {
    schema: CLIP_MARK,
    groups: g.groups.filter((x) => sub.has(x.id)).map(fix),
    nodes: g.nodes.filter((x) => sub.has(x.id)).map(fix),
    edges: g.edges.filter((e) => sub.has(e.source) && sub.has(e.target)).map((e) => ({ ...e })),
    roots: [...rootIds],
  };
}

export const subgraphSize = (p) => {
  let w = 0, h = 0;
  const rects = absoluteRects({ groups: p.groups, nodes: p.nodes, edges: [], annotations: [] });
  for (const id of p.roots) { const r = rects.get(id); if (r) { w = Math.max(w, r.x + r.w); h = Math.max(h, r.y + r.h); } }
  return { w, h };
};

/**
 * 조각을 그래프에 넣는다. at: 조각 왼쪽 위의 절대 좌표. parent: 넣을 그룹(없으면 at 위치의 가장 안쪽 그룹, 그것도 없으면 최상위).
 * 반환: 새 루트 id 목록.
 */
export function insertSubgraph(g, piece, { at = { x: 0, y: 0 }, parent } = {}) {
  const taken = allIds(g);
  const map = new Map();
  const newId = (old, prefix) => { const id = uid(prefix, taken); taken.add(id); map.set(old, id); return id; };
  const rects = absoluteRects(g);
  const target = parent !== undefined ? parent : innermostGroupAt(g, rects, { x: at.x + 1, y: at.y + 1 });
  const po = target ? rects.get(target) : { x: 0, y: 0 };
  const rootSet = new Set(piece.roots);
  const groups = piece.groups.map((x) => ({ ...x, id: newId(x.id, x.kind || 'g') }));
  const nodes = piece.nodes.map((x) => ({ ...x, id: newId(x.id, x.type === 'card' ? 'c' : x.type === 'text' ? 't' : x.type === 'badge' ? 'b' : 'n') }));
  const oldIdOf = new Map([...map.entries()].map(([o, n]) => [n, o]));
  for (const x of [...groups, ...nodes]) {
    const old = oldIdOf.get(x.id);
    if (rootSet.has(old)) { x.parent = target || null; x.x = Math.round(at.x - po.x + x.x); x.y = Math.round(at.y - po.y + x.y); }
    else x.parent = map.get(x.parent) || null;
  }
  const edges = piece.edges.map((e) => ({ ...e, id: uid('e', taken), source: map.get(e.source), target: map.get(e.target) })).filter((e) => e.source && e.target);
  edges.forEach((e) => taken.add(e.id));
  g.groups.push(...groups); g.nodes.push(...nodes); g.edges.push(...edges);
  return piece.roots.map((r) => map.get(r));
}
