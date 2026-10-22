// 정렬 · 간격 맞추기 · 크기 맞추기, 그리고 끌 때 보이는 정렬 안내선(스마트 가이드).
// 좌표는 모두 절대 좌표로 계산하고, 마지막에 각자 부모 기준 상대 좌표로 되돌린다.
import { absoluteRects } from '../model/geometry.js';

const isGroupOrCard = (g, id) => g.groups.some((x) => x.id === id) || g.nodes.some((x) => x.id === id && x.type === 'card');

function writeAbs(g, id, ax, ay) {
  const rects = absoluteRects(g);
  const item = g.groups.find((x) => x.id === id) || g.nodes.find((x) => x.id === id);
  if (!item) return;
  const pr = item.parent ? rects.get(item.parent) : { x: 0, y: 0 };
  item.x = Math.round(ax - pr.x);
  item.y = Math.round(ay - pr.y);
}

// 선택한 것 중 다른 선택 항목 안에 들어 있는 건 빼고(부모가 움직이면 같이 움직인다) 정렬 대상으로 삼는다
function topLevel(g, ids) {
  const want = new Set(ids);
  const parentOf = (id) => (g.groups.find((x) => x.id === id) || g.nodes.find((x) => x.id === id))?.parent;
  return ids.filter((id) => { let p = parentOf(id); while (p) { if (want.has(p)) return false; p = parentOf(p); } return true; });
}

/** how: left | hcenter | right | top | vcenter | bottom */
export function alignItems(graph, ids, how) {
  const g = structuredClone(graph);
  const list = topLevel(g, ids);
  if (list.length < 2) return g;
  const rects = absoluteRects(g);
  const rs = list.map((id) => ({ id, ...rects.get(id) })).filter((r) => r.w != null);
  const minX = Math.min(...rs.map((r) => r.x)), maxX = Math.max(...rs.map((r) => r.x + r.w));
  const minY = Math.min(...rs.map((r) => r.y)), maxY = Math.max(...rs.map((r) => r.y + r.h));
  // 가운데 정렬은 기준을 "선택 영역의 가운데"로
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  for (const r of rs) {
    let x = r.x, y = r.y;
    if (how === 'left') x = minX;
    if (how === 'right') x = maxX - r.w;
    if (how === 'hcenter') x = cx - r.w / 2;
    if (how === 'top') y = minY;
    if (how === 'bottom') y = maxY - r.h;
    if (how === 'vcenter') y = cy - r.h / 2;
    writeAbs(g, r.id, x, y);
  }
  return g;
}

/** axis: 'h' | 'v' — 양 끝은 그대로 두고 사이 간격을 같게 */
export function distributeItems(graph, ids, axis) {
  const g = structuredClone(graph);
  const list = topLevel(g, ids);
  if (list.length < 3) return g;
  const rects = absoluteRects(g);
  const rs = list.map((id) => ({ id, ...rects.get(id) })).filter((r) => r.w != null);
  const key = axis === 'h' ? 'x' : 'y', size = axis === 'h' ? 'w' : 'h';
  rs.sort((a, b) => a[key] - b[key]);
  const start = rs[0][key], end = rs[rs.length - 1][key] + rs[rs.length - 1][size];
  const total = rs.reduce((s, r) => s + r[size], 0);
  const gap = (end - start - total) / (rs.length - 1);
  let pos = start;
  for (const r of rs) {
    writeAbs(g, r.id, axis === 'h' ? pos : r.x, axis === 'h' ? r.y : pos);
    pos += r[size] + gap;
  }
  return g;
}

/** 그룹·카드 크기 맞추기: dim 'w' | 'h' | 'both'. 기준은 가장 큰 것. 아이콘은 크기가 고정이라 건너뛴다. */
export function sameSize(graph, ids, dim) {
  const g = structuredClone(graph);
  const items = ids.filter((id) => isGroupOrCard(g, id)).map((id) => g.groups.find((x) => x.id === id) || g.nodes.find((x) => x.id === id));
  if (items.length < 2) return g;
  const W = Math.max(...items.map((x) => x.w || 0)), H = Math.max(...items.map((x) => x.h || 0));
  for (const x of items) { if (dim !== 'h') x.w = W; if (dim !== 'w') x.h = H; }
  return g;
}

export const canResizeCount = (graph, ids) => ids.filter((id) => isGroupOrCard(graph, id)).length;

/**
 * 끌 때 정렬 안내선: 끌고 있는 사각형 r(절대 좌표)과 다른 사각형들의 왼쪽·가운데·오른쪽 / 위·가운데·아래가
 * threshold 안이면 그 위치로 붙이고, 그릴 선을 돌려준다.
 */
export function snapGuides(r, others, threshold) {
  const xsOf = (o) => [o.x, o.x + o.w / 2, o.x + o.w];
  const ysOf = (o) => [o.y, o.y + o.h / 2, o.y + o.h];
  const mine = { x: xsOf(r), y: ysOf(r) };
  let bestX = null, bestY = null;
  for (const o of others) {
    const ox = xsOf(o), oy = ysOf(o);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const dx = ox[j] - mine.x[i];
      if (Math.abs(dx) <= threshold && (!bestX || Math.abs(dx) < Math.abs(bestX.d))) bestX = { d: dx, at: ox[j], o };
      const dy = oy[j] - mine.y[i];
      if (Math.abs(dy) <= threshold && (!bestY || Math.abs(dy) < Math.abs(bestY.d))) bestY = { d: dy, at: oy[j], o };
    }
  }
  const dx = bestX ? bestX.d : 0, dy = bestY ? bestY.d : 0;
  const lines = [];
  if (bestX) { const top = Math.min(r.y + dy, bestX.o.y), bot = Math.max(r.y + dy + r.h, bestX.o.y + bestX.o.h); lines.push({ x1: bestX.at, y1: top - 12, x2: bestX.at, y2: bot + 12 }); }
  if (bestY) { const left = Math.min(r.x + dx, bestY.o.x), right = Math.max(r.x + dx + r.w, bestY.o.x + bestY.o.w); lines.push({ x1: left - 12, y1: bestY.at, x2: right + 12, y2: bestY.at }); }
  return { dx, dy, lines };
}
