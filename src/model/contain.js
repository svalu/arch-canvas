// 소속 규칙 하나: "보이는 대로가 사실". 숨은 부모 관계를 따로 두지 않고, 화면 위치로 매번 다시 정한다.
//
//  담는 상자(container): Region, VPC, AZ, 서브넷, 사내 데이터센터, AWS 계정, 섹션 …
//    - 아이콘·카드는 "가운데"가 놓인 가장 작은 담는 상자에 속한다.
//    - 상자는 자기를 "완전히" 감싸는 가장 작은 담는 상자에 속한다.
//    - 속한 것은 상자를 따라 움직인다.
//  겹치는 상자(overlay): 오토 스케일링 그룹, 보안 그룹, 스팟 플릿, (표시한) 클러스터 …
//    - 아무것도 품지 않는다. 그 안에 보이는 아이콘은 서브넷에 속한 채 "멤버"일 뿐이다.
//    - 끌면 테두리만 움직인다.
import { absoluteRects } from './geometry.js';
import { sortGroups } from './schema.js';

export const OVERLAY_KINDS = new Set(['auto-scaling', 'auto-scaling-group', 'security-group', 'spot-fleet']);
export const isOverlay = (grp) => !!grp && (grp.overlay === true || (grp.overlay !== false && OVERLAY_KINDS.has(grp.kind)));

const area = (r) => r.w * r.h;
const containsPt = (r, p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const containsRect = (o, r, tol = 2) => r.x >= o.x - tol && r.y >= o.y - tol && r.x + r.w <= o.x + o.w + tol && r.y + r.h <= o.y + o.h + tol;

/**
 * 한 요소가 들어갈 담는 상자. rect 는 절대 좌표.
 * @param kind 'node' | 'group'
 * @param skip 후보에서 뺄 id (자기 자신, 끄는 중인 것들)
 */
export function containerFor(g, rects, rect, kind, skip = new Set(), current = null) {
  let best = null, bestA = Infinity;
  const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  for (const c of g.groups) {
    if (skip.has(c.id) || isOverlay(c)) continue;
    const r = rects.get(c.id); if (!r) continue;
    const ok = kind === 'node' ? containsPt(r, center) : (containsRect(r, rect) && area(r) > area(rect));
    if (!ok) continue;
    const a = area(r);
    if (a < bestA - 0.5 || (Math.abs(a - bestA) <= 0.5 && c.id === current)) { best = c.id; bestA = a; }
  }
  return best;
}

/** 겹치는 상자 중 이 점(아이콘 가운데)이 들어간 것들 */
export function overlaysAt(g, rects, pt, skip = new Set()) {
  return g.groups.filter((c) => isOverlay(c) && !skip.has(c.id) && rects.get(c.id) && containsPt(rects.get(c.id), pt)).map((c) => c.id);
}

/** 겹치는 상자의 멤버(가운데가 그 안에 있는 아이콘·카드) */
export function membersOf(g, rects, overlayId) {
  const r = rects.get(overlayId); if (!r) return [];
  return g.nodes.filter((n) => { const q = rects.get(n.id); return q && containsPt(r, { x: q.x + q.w / 2, y: q.y + q.h / 2 }); }).map((n) => n.id);
}

/**
 * 모든 요소의 소속을 화면 위치로 다시 정한다. 화면 위치(절대 좌표)는 그대로 두고 부모와 상대 좌표만 바꾼다.
 * 바뀐 것이 없으면 같은 객체를 돌려준다.
 */
export function settleContainment(graph) {
  const g = graph;
  const rects = absoluteRects(g);
  const byId = new Map([...g.groups, ...g.nodes].map((x) => [x.id, x]));
  const next = new Map();
  // 상자: 큰 것부터 정해야 작은 것의 후보가 안정된다(계산은 절대 좌표로 하므로 순서와 무관하지만, 같은 넓이일 때 현재 부모 유지)
  for (const x of g.groups) {
    const r = rects.get(x.id); if (!r) continue;
    next.set(x.id, containerFor(g, rects, r, 'group', new Set([x.id]), x.parent));
  }
  for (const n of g.nodes) {
    const r = rects.get(n.id); if (!r) continue;
    next.set(n.id, containerFor(g, rects, r, 'node', new Set(), n.parent));
  }
  // 순환 방지: 상자 A 의 부모 후보가 A 안에 있는 상자가 되는 일은 "더 넓은 상자만 부모" 조건으로 생기지 않는다
  let changed = false;
  for (const [id, p] of next) if ((byId.get(id).parent ?? null) !== (p ?? null)) { changed = true; break; }
  if (!changed) return g;
  const out = { ...g, groups: g.groups.map((x) => ({ ...x })), nodes: g.nodes.map((x) => ({ ...x })) };
  for (const x of [...out.groups, ...out.nodes]) {
    if (!next.has(x.id)) continue;
    const p = next.get(x.id) ?? null;
    const abs = rects.get(x.id), pr = p ? rects.get(p) : { x: 0, y: 0 };
    x.parent = p;
    x.x = Math.round(abs.x - pr.x); x.y = Math.round(abs.y - pr.y);
  }
  out.groups = sortGroups(out.groups);
  return out;
}

/** 끄는 동안 안내용: 놓으면 들어갈 상자와 멤버가 될 겹치는 상자 */
export function dropPreview(g, rects, rect, kind, skip) {
  const into = containerFor(g, rects, rect, kind, skip);
  const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  const over = kind === 'node' ? overlaysAt(g, rects, center, skip) : [];
  return { into, over };
}
