// 그래프 좌표 계산. 캔버스 엣지 그리기와 PowerPoint 내보내기가 같은 함수를 써서 모양이 어긋나지 않게 한다.
import { ICON_SIZE, LABEL_WIDTH } from './schema.js';

/** id -> {x, y, w, h} 절대 좌표(캔버스 px). 그룹과 아이콘 노드 모두. */
export function absoluteRects(g) {
  const groups = new Map(g.groups.map((x) => [x.id, x]));
  const memo = new Map();
  const originOf = (pid, guard = 0) => {
    if (!pid || !groups.has(pid) || guard > 512) return { x: 0, y: 0 };
    if (memo.has(pid)) return memo.get(pid);
    const p = groups.get(pid);
    const o = originOf(p.parent, guard + 1);
    const r = { x: o.x + p.x, y: o.y + p.y };
    memo.set(pid, r);
    return r;
  };
  const rects = new Map();
  for (const x of g.groups) {
    const o = originOf(x.parent);
    rects.set(x.id, { x: o.x + x.x, y: o.y + x.y, w: x.w, h: x.h });
  }
  for (const n of g.nodes) {
    const o = originOf(n.parent);
    const box = n.type === 'card' || n.type === 'text' || n.type === 'badge';
    rects.set(n.id, { x: o.x + n.x, y: o.y + n.y, w: box ? n.w : ICON_SIZE, h: box ? n.h : ICON_SIZE });
  }
  return rects;
}

// 연결 지점. PowerPoint 사각형/그림의 연결점 번호와 같다: 0 위, 1 왼쪽, 2 아래, 3 오른쪽.
export const SIDE_IDX = { t: 0, l: 1, b: 2, r: 3 };

/** 두 사각형 사이 간격이 더 큰 방향으로 양쪽 면을 고른다. */
export function pickSides(a, b) {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  const gapX = Math.abs(dx) - (a.w + b.w) / 2;
  const gapY = Math.abs(dy) - (a.h + b.h) / 2;
  if (gapX >= gapY) return dx >= 0 ? ['r', 'l'] : ['l', 'r'];
  return dy >= 0 ? ['b', 't'] : ['t', 'b'];
}

export function sidePoint(r, side) {
  switch (side) {
    case 't': return { x: r.x + r.w / 2, y: r.y };
    case 'b': return { x: r.x + r.w / 2, y: r.y + r.h };
    case 'l': return { x: r.x, y: r.y + r.h / 2 };
    default: return { x: r.x + r.w, y: r.y + r.h / 2 };
  }
}

/**
 * 엣지 한 개의 양 끝점/면. shape=elbow 는 가운데에서 한 번 꺾는 3구간 선(PowerPoint bentConnector3 와 같은 모양).
 * dropA/dropB: 아이콘 아래 라벨 높이. 아래쪽(b) 면으로 나갈 때는 라벨을 관통하지 않게 그만큼 내려서 시작한다.
 */
export function edgeGeometry(a, b, dropA = 0, dropB = 0, offA = 0, offB = 0) {
  const [s, t] = pickSides(a, b);
  const p1 = sidePoint(a, s);
  const p2 = sidePoint(b, t);
  if (s === 'b') p1.y += dropA;
  if (t === 'b') p2.y += dropB;
  // 포트: 같은 면에 선이 여럿이면 면 중앙에서 비켜 붙는다(portOffsets)
  if (s === 'l' || s === 'r') p1.y += offA; else p1.x += offA;
  if (t === 'l' || t === 'r') p2.y += offB; else p2.x += offB;
  return { s, t, p1, p2, horizontal: s === 'l' || s === 'r' };
}

export const PORT_GAP_MAX = 28;   // 포트 사이 최대 간격(px). 아이콘(48)은 2개면 16, 3개면 12 간격

/**
 * 포트 배정: 같은 요소의 같은 면으로 모이는 선들을 면을 따라 펼친다(한 점에 겹치지 않게).
 * 반대쪽 끝이 있는 방향 순서로 배정해서 포트 앞에서 서로 꼬이지 않는다.
 * 반환: Map edgeId → { s, t } = 면 중앙에서의 px 오프셋(위·아래 면은 x, 왼쪽·오른쪽 면은 y). 캔버스·PNG·PowerPoint 가 같이 쓴다.
 */
export function portOffsets(edges, rects, drops = () => 0) {
  const bySide = new Map();   // "id:side" → [{ e, end, far, len }]
  for (const e of edges) {
    const a = endRect(rects, e.source, e.sp), b = endRect(rects, e.target, e.tp);
    if (!a || !b || (e.source && e.source === e.target)) continue;
    const [s, t] = pickSides(a, b);
    const put = (id, side, r, other) => {
      if (!id) return;
      const vert = side === 'l' || side === 'r';
      const far = vert ? other.y + other.h / 2 : other.x + other.w / 2;
      const k = id + ':' + side;
      if (!bySide.has(k)) bySide.set(k, []);
      bySide.get(k).push({ e, end: id === e.source && side === s ? 's' : 't', far, len: vert ? r.h : r.w });
    };
    put(e.source, s, a, b);
    put(e.target, t, b, a);
  }
  const out = new Map();
  const get = (id) => { if (!out.has(id)) out.set(id, { s: 0, t: 0 }); return out.get(id); };
  for (const list of bySide.values()) {
    if (list.length < 2) continue;
    list.sort((p, q) => p.far - q.far || (p.e.id < q.e.id ? -1 : 1));
    const gap = Math.min(PORT_GAP_MAX, list[0].len / (list.length + 1));
    list.forEach((p, i) => { get(p.e.id)[p.end] = Math.round((i - (list.length - 1) / 2) * gap * 10) / 10; });
  }
  staggerBends(edges, rects, drops, bySide, out);
  return out;
}

export const BEND_GAP = 12;    // 같은 면으로 모이는 직각선들의 꺾임 간격(px)
export const BEND_MIN = 18;    // 면에서 첫 꺾임까지

/**
 * 꺾임 계단 배치(채널 라우팅): 같은 면으로 모이는 직각선들은 꺾이는 위치를 면에서 18, 30, 42px… 로 비켜 둔다.
 * 전부 가운데(0.5)에서 꺾으면 세로 구간이 서로 엇갈려 어느 선이 어디로 가는지 안 보이기 때문.
 * 순서는 선끼리 교차가 가장 적은 배열을 고른다(≤6개는 전부 시도, 그 이상은 긴 구간이 바깥).
 * 결과는 out 의 b(꺾임 비율, PowerPoint bentConnector3 adj1 과 같은 뜻). 사용자가 직접 옮긴 꺾임(edge.bend)이 있으면 쓰는 쪽에서 그것을 우선한다.
 */
function staggerBends(edges, rects, drops, bySide, out) {
  // 선마다 더 붐비는 쪽 면을 고른다(허브 쪽). 둘 다 1개면 계단 없음
  const pick = new Map();   // edgeId → { key, end }
  for (const [key, list] of bySide) {
    if (list.length < 2) continue;
    for (const p of list) {
      const cur = pick.get(p.e.id);
      if (!cur || list.length > bySide.get(cur.key).length || (list.length === bySide.get(cur.key).length && p.end === 't')) pick.set(p.e.id, { key, end: p.end });
    }
  }
  const byKey = new Map();
  for (const [id, v] of pick) { if (!byKey.has(v.key)) byKey.set(v.key, []); byKey.get(v.key).push(id); }
  const geoOf = new Map();
  for (const e of edges) {
    if (!pick.has(e.id) || e.shape !== 'elbow') continue;
    const a = endRect(rects, e.source, e.sp), b = endRect(rects, e.target, e.tp);
    const po = out.get(e.id) || { s: 0, t: 0 };
    const geo = edgeGeometry(a, b, drops(e.source), drops(e.target), po.s, po.t);
    if (Math.abs(geo.p1.x - geo.p2.x) < 1 || Math.abs(geo.p1.y - geo.p2.y) < 1) continue;   // 직선이면 꺾임 없음
    geoOf.set(e.id, geo);
  }
  for (const [key, ids0] of byKey) {
    const ids = ids0.filter((id) => geoOf.has(id));
    if (ids.length < 2) continue;
    const side = key.slice(key.lastIndexOf(':') + 1);
    const vert = side === 'l' || side === 'r';   // 면이 세로면 → 선은 가로로 나가고 꺾임은 x 위치
    // 선 i 가 면에서 d 만큼 떨어진 곳에서 꺾일 때의 꺾임 비율과 3구간 꺾은선
    const polyAt = (id, d) => {
      const geo = geoOf.get(id), { p1, p2 } = geo;
      const end = pick.get(id).end;
      const at = end === 's' ? p1 : p2, other = end === 's' ? p2 : p1;
      const dir = vert ? Math.sign(other.x - at.x) : Math.sign(other.y - at.y);
      const span = vert ? Math.abs(p2.x - p1.x) : Math.abs(p2.y - p1.y);
      if (span < d + 8) return null;
      const m = vert ? at.x + dir * d : at.y + dir * d;
      const k = vert ? (m - p1.x) / (p2.x - p1.x) : (m - p1.y) / (p2.y - p1.y);
      const pts = vert ? [p1, { x: m, y: p1.y }, { x: m, y: p2.y }, p2] : [p1, { x: p1.x, y: m }, { x: p2.x, y: m }, p2];
      return { k: Math.round(k * 1000) / 1000, pts };
    };
    const crosses = (A, B) => {
      let n = 0;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (segCross(A[i], A[i + 1], B[j], B[j + 1])) n++;
      return n;
    };
    const score = (order) => {
      const polys = order.map((id, i) => polyAt(id, BEND_MIN + i * BEND_GAP));
      let n = 0;
      for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) if (polys[i] && polys[j]) n += crosses(polys[i].pts, polys[j].pts);
      return n;
    };
    const spanOf = (id) => { const g = geoOf.get(id); return vert ? Math.abs(g.p2.y - g.p1.y) : Math.abs(g.p2.x - g.p1.x); };
    let best = [...ids].sort((p, q) => spanOf(p) - spanOf(q)), bestScore = score(best);   // 기본: 짧은 구간이 안쪽
    if (ids.length <= 6) {
      for (const order of permutations(ids)) { const s = score(order); if (s < bestScore) { best = order; bestScore = s; if (!s) break; } }
    }
    best.forEach((id, i) => { const r = polyAt(id, BEND_MIN + i * BEND_GAP); if (r) out.get(id).b = r.k; });
  }
}

function* permutations(arr) {
  if (arr.length <= 1) { yield arr; return; }
  for (let i = 0; i < arr.length; i++) for (const rest of permutations([...arr.slice(0, i), ...arr.slice(i + 1)])) yield [arr[i], ...rest];
}

// 두 선분이 서로 가로지르는지(끝점이 닿는 것·같은 선 위는 제외)
function segCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

/** 선 한쪽 끝의 사각형: 요소면 그 사각형, 빈 곳이면 크기 0 인 점 */
export const endRect = (rects, id, pt) => (id ? rects.get(id) : pt ? { x: pt.x, y: pt.y, w: 0, h: 0 } : null);

/** 직각선 꺾이는 위치: 시작점→끝점 사이 비율(0.5 = 가운데). PowerPoint bentConnector3 의 adj1 과 같은 뜻. */
export const bendOf = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0.5);
export const isBent = (geo, shape) => shape === 'elbow' && Math.abs(geo.p1.x - geo.p2.x) >= 1 && Math.abs(geo.p1.y - geo.p2.y) >= 1;

export function edgePath(geo, shape, bend) {
  const { p1, p2, horizontal } = geo;
  const k = bendOf(bend);
  const straightish = Math.abs(p1.x - p2.x) < 1 || Math.abs(p1.y - p2.y) < 1;
  if (shape === 'curve' && !straightish) {
    // 면 방향으로 나갔다가 들어오는 S자 곡선 (PowerPoint curvedConnector3 와 같은 모양)
    const c1 = horizontal ? { x: (p1.x + p2.x) / 2, y: p1.y } : { x: p1.x, y: (p1.y + p2.y) / 2 };
    const c2 = horizontal ? { x: (p1.x + p2.x) / 2, y: p2.y } : { x: p2.x, y: (p1.y + p2.y) / 2 };
    return { d: `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
  }
  if (shape !== 'elbow' || straightish) {
    return { d: `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
  }
  if (horizontal) {
    const mx = p1.x + (p2.x - p1.x) * k;
    return { d: `M ${p1.x} ${p1.y} L ${mx} ${p1.y} L ${mx} ${p2.y} L ${p2.x} ${p2.y}`, mid: { x: mx, y: (p1.y + p2.y) / 2 } };
  }
  const my = p1.y + (p2.y - p1.y) * k;
  return { d: `M ${p1.x} ${p1.y} L ${p1.x} ${my} L ${p2.x} ${my} L ${p2.x} ${p2.y}`, mid: { x: (p1.x + p2.x) / 2, y: my } };
}

/**
 * 점 위에 보이는 맨 위 그룹 id. groups 배열 순서가 그리는 순서라서 뒤에 있는 것이 위다.
 * (exclude 는 끌고 있는 그룹 자신과 자손을 빼기 위한 집합)
 */
export function innermostGroupAt(g, rects, pt, exclude = new Set()) {
  let best = null;
  for (const x of g.groups) {
    if (exclude.has(x.id)) continue;
    const r = rects.get(x.id);
    if (r && pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h) best = x.id;
  }
  return best;
}

export function depthMap(g) {
  const byId = new Map(g.groups.map((x) => [x.id, x]));
  const out = new Map();
  for (const x of g.groups) {
    let d = 0, p = x.parent;
    while (p && byId.has(p) && d < 512) { d++; p = byId.get(p).parent; }
    out.set(x.id, d);
  }
  return out;
}

export function descendants(g, id) {
  const out = new Set();
  let grew = true;
  out.add(id);
  while (grew) {
    grew = false;
    for (const x of [...g.groups, ...g.nodes]) {
      if (x.parent && out.has(x.parent) && !out.has(x.id)) { out.add(x.id); grew = true; }
    }
  }
  out.delete(id);
  return out;
}

const PAD = 32;
const LABEL_SPACE = 34; // 아이콘 아래 라벨 공간

/** 자식이 그룹 밖으로 삐져나오면 그룹을 키운다(줄이지는 않음). 안쪽 그룹부터 처리. */
export function fitGroups(g) {
  const depth = depthMap(g);
  const order = [...g.groups].sort((a, b) => depth.get(b.id) - depth.get(a.id));
  for (const grp of order) {
    let w = grp.w, h = grp.h;
    for (const c of g.groups) if (c.parent === grp.id) { w = Math.max(w, c.x + c.w + PAD); h = Math.max(h, c.y + c.h + PAD); }
    for (const n of g.nodes) if (n.parent === grp.id) { w = Math.max(w, n.x + nodeW(n) + PAD + 12); h = Math.max(h, n.y + nodeH(n) + (n.type === 'card' ? PAD : 0)); }
    grp.w = Math.round(w); grp.h = Math.round(h);
  }
  return g;
}

/** 그룹 안 빈 자리 찾기(모델 패치에서 좌표를 안 줬을 때). 왼쪽 위부터 격자로 훑는다. */
export function freeSlot(g, parent) {
  const STEP_X = 130, STEP_Y = 110, X0 = 40, Y0 = 56;
  const grp = parent ? g.groups.find((x) => x.id === parent) : null;
  const cols = grp ? Math.max(1, Math.floor((grp.w - X0) / STEP_X)) : 8;
  const taken = [...g.nodes.filter((n) => (n.parent || null) === (parent || null)),
    ...g.groups.filter((x) => (x.parent || null) === (parent || null)).map((x) => ({ ...x, isGroup: true }))];
  for (let i = 0; i < 400; i++) {
    const x = X0 + (i % cols) * STEP_X, y = Y0 + Math.floor(i / cols) * STEP_Y;
    const hit = taken.some((t) => t.isGroup
      ? x + ICON_SIZE > t.x && x < t.x + t.w && y + ICON_SIZE > t.y && y < t.y + t.h
      : Math.abs(t.x - x) < STEP_X - 20 && Math.abs(t.y - y) < STEP_Y - 20);
    if (!hit) return { x, y };
  }
  return { x: X0, y: Y0 };
}

/** 모델 패치에서 좌표 없이 추가된 그룹들을 겹치지 않게 다시 놓는다.
 *  같은 부모 아래: 먼저 있던 것(노드·좌표 준 그룹) 아래에 놓는다.
 *    - 같은 종류가 2개 이상이면(AZ 둘) 그 종류끼리 한 줄에 가로로 나란히(높이 맞춤)
 *    - 나머지(Auto Scaling group, 퍼블릭/프라이빗 하나씩)는 그 아래 줄에 세로로 쌓고, 위에 가로 줄이 있으면 그 폭만큼 넓힌다
 *  맨 바깥(부모 없음)은 노드 줄 오른쪽에 가로로. 안쪽 부모부터 처리해서 크기가 확정된 뒤 바깥을 놓는다.
 *  keepSize: 크기를 명시한 그룹(자식에 맞춰 줄이지 않음).
 *  끝으로, 커진 그룹이 뒤따르는 형제와 겹치면 형제를 오른쪽/아래로 민다(위로 전파). */
export function packAutoGroups(g, autoIds, keepSize = new Set()) {
  if (!autoIds || !autoIds.size) return g;
  const GAP = 24, X0 = 40, Y0 = 56;
  const before = new Map(g.groups.map((x) => [x.id, { x: x.x, y: x.y, w: x.w, h: x.h }]));
  const depth = depthMap(g);
  const parents = [...new Set(g.groups.filter((x) => autoIds.has(x.id)).map((x) => x.parent ?? null))];
  parents.sort((a, b) => (b ? depth.get(b) : -1) - (a ? depth.get(a) : -1));
  // 자동 그룹은 자식에 맞게 줄이기도 한다 (기본 fitGroups 는 키우기만 하므로, 재배치 전 크기가 남지 않게)
  const shrink = (grp) => {
    if (keepSize.has(grp.id)) return;
    let w = 0, h = 0, any = false;
    for (const c of g.groups) if (c.parent === grp.id) { any = true; w = Math.max(w, c.x + c.w + PAD); h = Math.max(h, c.y + c.h + PAD); }
    for (const n of g.nodes) if (n.parent === grp.id) { any = true; w = Math.max(w, n.x + nodeW(n) + PAD + 12); h = Math.max(h, n.y + nodeH(n) + (n.type === 'card' ? PAD : 0)); }
    if (any) { grp.w = Math.max(240, Math.round(w)); grp.h = Math.max(150, Math.round(h)); } else { grp.w = 240; grp.h = 150; }
  };
  for (const pid of parents) {
    for (const k of g.groups) if ((k.parent ?? null) === pid && autoIds.has(k.id)) shrink(k);
    fitGroups(g);
    const kids = g.groups.filter((x) => (x.parent ?? null) === pid && autoIds.has(x.id));
    if (!kids.length) continue;
    const fixed = [
      ...g.groups.filter((x) => (x.parent ?? null) === pid && !autoIds.has(x.id)),
      ...g.nodes.filter((n) => (n.parent ?? null) === pid).map((n) => ({ x: n.x, y: n.y, w: nodeW(n), h: nodeH(n) })),
    ];
    if (pid == null) {
      let x = fixed.reduce((m, r) => Math.max(m, r.x + r.w), X0 - GAP) + GAP;
      for (const k of kids) { k.x = x; k.y = Y0; x += k.w + GAP; }
      continue;
    }
    let y = fixed.reduce((m, r) => Math.max(m, r.y + r.h), Y0 - GAP) + GAP;
    const byKind = new Map();
    for (const k of kids) (byKind.get(k.kind) || byKind.set(k.kind, []).get(k.kind)).push(k);
    const rows = [...byKind.values()].filter((l) => l.length > 1);
    const singles = kids.filter((k) => byKind.get(k.kind).length === 1);
    // 같은 종류 2개 이상: 한 줄에 가로로, 높이를 맞춘다
    let rowW = 0;
    for (const row of rows) {
      const h = Math.max(...row.map((k) => k.h));
      let x = X0;
      for (const k of row) { k.h = h; k.x = x; k.y = y; x += k.w + GAP; }
      rowW = Math.max(rowW, x - GAP - X0);
      y += h + GAP;
    }
    // 나머지: 세로로 쌓고 너비를 맞춘다(위 가로 줄이 있으면 그 폭까지)
    if (singles.length) {
      const w = Math.max(rowW, ...singles.map((k) => k.w));
      for (const k of singles) { k.w = w; k.x = X0; k.y = y; y += k.h + GAP; }
    }
  }
  fitGroups(g);
  pushGrown(g, before);
  return g;
}

const isBox = (n) => n.type === 'card' || n.type === 'text' || n.type === 'badge';
const nodeW = (n) => (isBox(n) ? n.w : ICON_SIZE);
const nodeH = (n) => (isBox(n) ? n.h : ICON_SIZE + LABEL_SPACE);
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** 이번에 커진(또는 새로 생긴) 그룹과 새로 겹치게 된 형제를 오른쪽/아래로 민다. 밀어서 부모가 커지면 부모 단계에서 다시. */
function pushGrown(g, before, GAP = 24) {
  for (let pass = 0; pass < 64; pass++) {
    const depth = depthMap(g);
    const grown = g.groups
      .filter((x) => { const b = before.get(x.id); return !b || x.w > b.w || x.h > b.h || x.x !== b.x || x.y !== b.y; })
      .sort((a, b) => depth.get(b.id) - depth.get(a.id));
    let moved = false;
    for (const p of grown) moved = pushSiblings(g, p, before.get(p.id), GAP) || moved;
    if (!moved) break;
    fitGroups(g);
  }
}

function pushSiblings(g, grp, old, GAP) {
  const pid = grp.parent ?? null;
  const rectOf = (x) => ({ x: x.x, y: x.y, w: 'kind' in x ? x.w : nodeW(x), h: 'kind' in x ? x.h : nodeH(x) });
  const sibs = [...g.groups.filter((x) => (x.parent ?? null) === pid && x !== grp), ...g.nodes.filter((n) => (n.parent ?? null) === pid)];
  // 원래부터 겹쳐 있던 것(ASG 가 AZ 위에 걸침, IGW 가 VPC 경계에 걸침)은 의도한 배치라 건드리지 않는다
  const queue = [{ item: grp, old: old || null }];
  let moved = false, guard = 0;
  while (queue.length && guard++ < 2000) {
    const { item, old: was } = queue.shift();
    const A = rectOf(item);
    for (const s of sibs) {
      if (s === item) continue;
      const S = rectOf(s);
      if (!hit(A, S) || (was && hit(was, S))) continue;
      if (S.x < A.x && S.y < A.y) continue;            // 왼쪽 위(앞)에 있는 것은 밀지 않는다
      const penX = A.x + A.w - S.x, penY = A.y + A.h - S.y;
      // 원래 배치를 따른다: 예전 사각형의 오른쪽에 있던 건 오른쪽으로, 아래에 있던 건 아래로. 모르면 덜 겹친 쪽으로
      const right = was && S.x >= was.x + was.w ? true : was && S.y >= was.y + was.h ? false : S.x >= A.x && (S.y < A.y || penX <= penY);
      if (right) s.x = Math.round(A.x + A.w + GAP); else s.y = Math.round(A.y + A.h + GAP);
      queue.push({ item: s, old: S });
      moved = true;
    }
  }
  return moved;
}

/**
 * 이번에 새로 만든 담는 상자를 안의 것에 딱 맞게 줄인다(AI 가 준 대략 크기 때문에 생기는 빈 공간 제거).
 * 안쪽 상자부터. 안의 것을 왼쪽 위 여백에 맞춰 당기고(서로의 배치는 그대로), 크기를 내용 + 여백으로.
 * 비어 있는 상자와 겹치는 상자(ASG 등)는 건드리지 않는다.
 */
export function tightenGroups(g, ids, isOverlay = () => false) {
  if (!ids?.size) return g;
  const L = 32, T = 56, R = 32, B = 32;                // 왼쪽·위(이름표 자리)·오른쪽·아래 여백
  const half = Math.max(0, (LABEL_WIDTH - ICON_SIZE) / 2);   // 아이콘 이름표가 양옆으로 넘치는 폭
  const depth = depthMap(g);
  const order = g.groups.filter((x) => ids.has(x.id) && !isOverlay(x)).sort((a, b) => depth.get(b.id) - depth.get(a.id));
  for (const grp of order) {
    tidySiblings(g.groups.filter((c) => c.parent === grp.id && !isOverlay(c)), g.nodes.filter((n) => n.parent === grp.id));
    const kids = [...g.groups.filter((c) => c.parent === grp.id && !isOverlay(c)), ...g.nodes.filter((n) => n.parent === grp.id)];
    if (!kids.length) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const k of kids) {
      const box = 'kind' in k ? { x: k.x, y: k.y, w: k.w, h: k.h }
        : isBox(k) ? { x: k.x, y: k.y, w: k.w, h: k.h } : { x: k.x - half, y: k.y, w: ICON_SIZE + half * 2, h: ICON_SIZE + LABEL_SPACE };
      x0 = Math.min(x0, box.x); y0 = Math.min(y0, box.y); x1 = Math.max(x1, box.x + box.w); y1 = Math.max(y1, box.y + box.h);
    }
    const dx = Math.round(L - x0), dy = Math.round(T - y0);
    // 겹치는 상자는 안의 멤버를 따라 같이 옮긴다 (부모가 같으면)
    for (const k of [...kids, ...g.groups.filter((c) => c.parent === grp.id && isOverlay(c))]) { k.x += dx; k.y += dy; }
    grp.w = Math.max(160, Math.round(x1 - x0 + L + R));
    grp.h = Math.max(110, Math.round(y1 - y0 + T + B));
  }
  return g;
}

/**
 * 형제 정돈: 세로로 쌓인 것(서브넷들)은 폭과 왼쪽을 맞추고, 가로로 나란한 것(AZ 들)은 높이와 위를 맞춘다.
 * 그다음 순서는 그대로 두고 GAP 간격으로 붙인다(겹치면 밀고, 떨어져 있으면 당긴다).
 * 같은 상자에 직접 든 아이콘도 줄에 끼면 함께 움직여서, 당긴 상자가 아이콘을 덮지 않는다. 상자는 키우기만 한다.
 */
function tidySiblings(groups, nodes = [], GAP = 24) {
  const half = Math.max(0, (LABEL_WIDTH - ICON_SIZE) / 2);
  const items = [
    ...groups.map((o) => ({ o, grp: true, x: o.x, y: o.y, w: o.w, h: o.h })),
    ...nodes.map((o) => (isBox(o) ? { o, x: o.x, y: o.y, w: o.w, h: o.h } : { o, icon: true, x: o.x - half, y: o.y, w: ICON_SIZE + half * 2, h: ICON_SIZE + LABEL_SPACE })),
  ];
  if (items.length < 2) return;
  const ox = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = (a, b) => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  // 서로 위아래·좌우로 다 겹친 둘은 어느 쪽으로 풀지 정한다: AZ·VPC·리전은 나란히(가로), 서브넷은 쌓기(세로), 나머지는 덜 움직이는 쪽
  const SIDE = /^(az|vpc|region|aws-cloud|aws-cloud-dark|aws-cloud-logo|aws-cloud-logo-dark|aws-account|corporate-dc)$/, STACK = /subnet$/;
  const prefer = (a, b) => {
    const ka = a.o.kind, kb = b.o.kind;
    if (ka && kb && SIDE.test(ka) && SIDE.test(kb)) return 'x';
    if (ka && kb && STACK.test(ka) && STACK.test(kb)) return 'y';
    return ox(a, b) <= oy(a, b) ? 'x' : 'y';
  };
  const both = (a, b) => ox(a, b) > 2 && oy(a, b) > 2;
  const xOver = (a, b) => ox(a, b) > Math.min(a.w, b.w) * 0.5 && !(both(a, b) && prefer(a, b) === 'x');
  const yOver = (a, b) => oy(a, b) > Math.min(a.h, b.h) * 0.5 && !(both(a, b) && prefer(a, b) === 'y');
  const clusters = (same) => {
    const out = [];
    for (const x of items) {
      const hits = out.filter((cl) => cl.some((y) => same(x, y)));
      if (!hits.length) { out.push([x]); continue; }
      hits[0].push(x);
      for (const h of hits.slice(1)) { hits[0].push(...h); out.splice(out.indexOf(h), 1); }   // 이어진 무리는 하나로
    }
    return out.filter((c) => c.length > 1);
  };
  // 크기 맞추기는 이미 비슷한 것끼리만 (좁은 상자를 아래 넓은 띠에 맞춰 늘리지 않게)
  const similar = (vals) => Math.min(...vals) >= Math.max(...vals) * 0.7;
  const hit = (a, b, ax) => (ax === 'x' ? Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) : Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) > 2;
  // 무리 안에서 하나씩 위(왼쪽)로 미끄러뜨린다: 가로(세로)로 겹치는 앞의 것 바로 아래(옆)까지. 나란히 놓인 것은 같은 높이를 지킨다
  const slide = (list, ax) => {
    const pos = ax === 'y' ? 'y' : 'x', len = ax === 'y' ? 'h' : 'w', cross = ax === 'y' ? 'x' : 'y';
    const start = Math.min(...list.map((k) => k[pos]));
    list.sort((a, b) => a[pos] - b[pos]);
    const done = [];
    for (const k of list) {
      let v = start;
      for (const d of done) if (hit(d, k, cross)) v = Math.max(v, d[pos] + d[len] + GAP);
      // 앞의 것을 추월하지 않는다: 줄 세운 순서(아이콘 → 상자)가 짧은 상자가 긴 상자 옆 아이콘을 지나치며 깨지지 않게
      if (done.length) v = Math.max(v, done[done.length - 1][pos]);
      k[pos] = v; done.push(k);
    }
  };
  for (const col of clusters(xOver)) {           // 세로로 쌓인 것
    const bx = col.filter((k) => k.grp);
    if (bx.length > 1 && similar(bx.map((k) => k.w))) { const x = Math.min(...bx.map((k) => k.x)), w = Math.max(...bx.map((k) => k.w)); for (const k of bx) { k.x = x; k.w = w; } }
    slide(col, 'y');
  }
  for (const row of clusters(yOver)) {           // 가로로 나란한 것
    const bx = row.filter((k) => k.grp);
    if (bx.length > 1 && similar(bx.map((k) => k.h))) { const y = Math.min(...bx.map((k) => k.y)), h = Math.max(...bx.map((k) => k.h)); for (const k of bx) { k.y = y; k.h = h; } }
    slide(row, 'x');
  }
  for (const k of items) {
    if (k.grp) { k.o.x = Math.round(k.x); k.o.y = Math.round(k.y); k.o.w = Math.max(k.o.w, Math.round(k.w)); k.o.h = Math.max(k.o.h, Math.round(k.h)); }
    else { k.o.x = Math.round(k.icon ? k.x + half : k.x); k.o.y = Math.round(k.y); }
  }
}

/**
 * 형제 흐름 배치: 한 상자 안의 자식 상자·아이콘을 선이 가는 방향(출발 → 도착)대로 단을 나눠 놓는다.
 * 같은 단에 든 것은 옆으로 쌓고, 단은 흐름 축(가로. 서브넷끼리는 AWS 관례대로 세로)으로 나란히 둔다.
 * 단이 많아 너무 길쭉해지면 줄을 바꾼다(가로:세로 2.2 근처). 양방향·순환은 지금 그림의 읽는 순서(왼쪽 위가 먼저)를 따른다.
 * 형제 사이에 선이 하나도 없으면 자리를 건드리지 않는다.
 */
/**
 * AI 배치안(plan): Map 또는 객체, 키 = 부모 그룹 id('root' = 맨 바깥), 값 = 단(왼쪽→오른쪽) 배열, 단마다 위→아래 순서의 자식 id 배열.
 * 있으면 그 부모의 단·순서는 선을 보고 계산하지 않고 이것을 쓴다(없는 id 는 무시, 빠진 자식은 마지막 단 뒤에).
 */
const planFor = (plan, pid) => {
  if (!plan) return null;
  const k = pid == null ? 'root' : pid;
  const v = plan instanceof Map ? plan.get(k) : plan[k];
  return Array.isArray(v) && v.length ? v : null;
};

function flowSiblings(g, pid, groupIds, nodeIds, isOverlay, GAP = 24, plan = null) {
  const half = Math.max(0, (LABEL_WIDTH - ICON_SIZE) / 2);
  const kids = g.groups.filter((c) => (c.parent ?? null) === pid && !isOverlay(c) && groupIds.has(c.id));
  const ns = pid == null ? [] : g.nodes.filter((n) => (n.parent ?? null) === pid && nodeIds.has(n.id) && n.type !== 'badge');   // 맨 바깥 아이콘은 뒤에서 상자 옆에 따로 놓고, 번호 배지는 붙여 둔 자리 그대로
  const items = [
    ...kids.map((o) => ({ o, grp: true, x: o.x, y: o.y, w: o.w, h: o.h })),
    ...ns.map((o) => (isBox(o) ? { o, x: o.x, y: o.y, w: o.w, h: o.h } : { o, icon: true, x: o.x - half, y: o.y, w: ICON_SIZE + half * 2, h: ICON_SIZE + LABEL_SPACE })),
  ];
  if (items.length < 2) return false;
  // 어느 형제 밑에 있는지: 자손 → 형제
  const parentOf = new Map(g.groups.map((x) => [x.id, x.parent ?? null]));
  for (const n of g.nodes) parentOf.set(n.id, n.parent ?? null);
  const idx = new Map(items.map((k, i) => [k.o.id, i]));
  const owner = (id) => { let guard = 0; while (id != null && guard++ < 512) { if (idx.has(id)) return idx.get(id); id = parentOf.get(id); } return -1; };
  const n = items.length;
  const W = items.map(() => items.map(() => 0));
  let any = false;
  for (const e of g.edges) {
    const a = owner(e.source), b = owner(e.target);
    if (a < 0 || b < 0 || a === b) continue;
    if (e.arrow === 'both') { W[a][b] += 0.01; W[b][a] += 0.01; }   // 양방향은 이어졌다는 것만, 방향은 아니다
    else W[a][b] += 1;
    any = true;
  }
  const given = planFor(plan, pid);
  if (!any && !given) return false;
  const stack = kids.length && kids.every((k) => /subnet$/.test(k.kind || ''));
  const P = pid == null ? null : g.groups.find((q) => q.id === pid);
  // 서브넷끼리는 세로로 쌓고, 서브넷 안의 아이콘은 가로로 늘어놓는다(띠 모양). 나머지는 왼쪽 → 오른쪽 흐름
  const ax = stack || (!kids.length && P && /subnet$/.test(P.kind || '')) ? 'y' : 'x';
  const pos = ax, cross = ax === 'y' ? 'x' : 'y', len = ax === 'y' ? 'h' : 'w', clen = ax === 'y' ? 'w' : 'h';
  // 읽는 순서: 흐름 축이 먼저. 순환을 풀 때 이 순서를 따른다
  const order = items.map((_, i) => i).sort((i, j) => items[i][pos] - items[j][pos] || items[i][cross] - items[j][cross]);
  const rankOf = order.map(() => 0); order.forEach((i, r) => { rankOf[i] = r; });
  // Public 서브넷은 들어오는 선이 있어도 맨 앞(인터넷에서 들어오는 문)
  const isPub = (i) => items[i].grp && /public/.test(items[i].o.kind || '');
  const adj = items.map(() => []);
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    if (W[a][b] < 1 || isPub(b)) continue;   // 양방향뿐인 쌍은 단을 가르지 않는다
    // 지금 읽는 순서를 지킨다: 거꾸로 가는 선뿐일 때만 순서를 바꾼다 (서로 오가는 둘은 그린 사람이 둔 대로)
    if (rankOf[b] < rankOf[a] && (W[b][a] >= 1 || W[a][b] < 1)) continue;
    if (rankOf[a] < rankOf[b] && W[a][b] < 1 && W[b][a] >= 1) continue;
    adj[a].push(b);
  }
  // 남은 순환은 읽는 순서로 DFS 해서 되돌아가는 선을 버린다
  const color = items.map(() => 0);
  const dfs = (u) => { color[u] = 1; adj[u] = adj[u].filter((v) => { if (color[v] === 1) return false; if (!color[v]) dfs(v); return true; }); color[u] = 2; };
  for (const i of order) if (!color[i]) dfs(i);
  // 단: 가장 긴 경로
  const indeg = items.map(() => 0); for (const u of adj.keys()) for (const v of adj[u]) indeg[v]++;
  const rank = items.map(() => 0), q = order.filter((i) => !indeg[i]);
  const seen = new Set(q);
  while (q.length) { const u = q.shift(); for (const v of adj[u]) { rank[v] = Math.max(rank[v], rank[u] + 1); if (--indeg[v] === 0 && !seen.has(v)) { seen.add(v); q.push(v); } } }
  // 선이 없는 것은 읽는 순서로 바로 앞의 것과 같은 단
  const linked = items.map((_, i) => W[i].some(Boolean) || W.some((row) => row[i]));
  let prev = 0; for (const i of order) { if (linked[i]) prev = rank[i]; else rank[i] = prev; }
  const cols = [];
  for (let i = 0; i < n; i++) (cols[rank[i]] ||= []).push(i);
  let columns = cols.filter(Boolean);
  if (given) {
    // AI 배치안대로: 단과 단 안 순서를 그대로. 안 나온 자식은 마지막 단 뒤에
    const used = new Set();
    columns = given.map((col) => (Array.isArray(col) ? col : [col]).map((id) => idx.get(String(id))).filter((i) => i != null && !used.has(i) && used.add(i))).filter((c) => c.length);
    const rest = items.map((_, i) => i).filter((i) => !used.has(i));
    if (rest.length) columns.push(rest);
    columns.forEach((col, c) => col.forEach((i) => { rank[i] = c; }));
  }
  if (stack) columns = columns.flat().map((i) => [i]);   // 서브넷은 단마다 하나씩, 한 줄로 쌓는다
  // 단 안의 순서: 앞 단에서 이어진 것의 평균 자리(가까운 것끼리 붙게), 없으면 지금 자리
  const at = items.map((k) => k[cross]), mo = items.map(() => 0);
  for (let c = 0; c < columns.length; c++) {
    const key = (i) => { const src = c ? columns[c - 1].filter((u) => W[u][i] || W[i][u]) : []; return src.length ? src.reduce((s, u) => s + at[u], 0) / src.length : null; };
    if (!given) columns[c].sort((i, j) => (key(i) ?? Infinity) - (key(j) ?? Infinity) || rankOf[i] - rankOf[j]);   // 이어진 것이 먼저, 그다음 읽는 순서 (AI 배치안은 그 순서대로)
    // 아이콘만 넷 이상 한 단에 몰리면 길게 늘어놓지 않고 3개씩 접어 격자로
    const col = columns[c], per = col.every((i) => items[i].icon) && col.length > 3 ? Math.ceil(col.length / Math.ceil(col.length / 3)) : col.length;
    let v = 0, m = 0, k = 0;
    for (const i of col) {
      if (k === per) { k = 0; v = 0; m += items[col[0]][len] + GAP; }
      at[i] = v; mo[i] = m; v += items[i][clen] + GAP; k++;
    }
  }
  // AZ·VPC·리전끼리 같은 단이면 쌓지 않고 흐름 축으로 나란히 (AWS 관례: AZ 는 옆으로)
  const SIDE = /^(az|vpc|region|aws-cloud|aws-cloud-dark|aws-cloud-logo|aws-cloud-logo-dark|aws-account|corporate-dc)$/;
  const sideBy = columns.map((col) => col.length > 1 && col.every((i) => items[i].grp && SIDE.test(items[i].o.kind || '')));
  // 단 크기와 줄 바꾸기: 가로:세로가 2.2 에 가장 가까운 줄당 단 수
  const sizeOf = (col, side) => side
    ? { main: col.reduce((s, i) => s + items[i][len], 0) + GAP * (col.length - 1), cross: Math.max(...col.map((i) => items[i][clen])) }
    : { main: Math.max(...col.map((i) => mo[i] + items[i][len])), cross: Math.max(...col.map((i) => at[i] + items[i][clen])) };
  let size = columns.map((col, c) => sizeOf(col, sideBy[c]));
  // 낮은 단 합치기: 높은 단(VPC 등) 옆에 아이콘 한둘짜리 단이 줄줄이 서면 빈 공간만 커진다.
  // 이어지는 낮은 단들을 세로로 쌓아 한 단으로 (위에서 아래가 흐름 순서). 가장 높은 단과 AZ 줄은 그대로
  if (!stack && columns.length > 2) {   // AI 배치안에도 적용: 단 순서는 지키고 낮은 단만 위아래로 포갠다
    const tallest = Math.max(...size.map((z) => z.cross));
    const cols2 = [], side2 = [];
    for (let c = 0; c < columns.length; c++) {
      let col = columns[c], cross = size[c].cross;
      if (!sideBy[c] && cross < tallest * 0.9) {
        while (c + 1 < columns.length && !sideBy[c + 1] && cross + GAP + size[c + 1].cross <= tallest * 0.9) {
          const off = cross + GAP;
          for (const i of columns[c + 1]) at[i] += off;
          col = col.concat(columns[c + 1]); cross += GAP + size[c + 1].cross; c++;
        }
      }
      cols2.push(col); side2.push(sideBy[c] && col === columns[c]);
    }
    columns = cols2; sideBy.length = 0; sideBy.push(...side2);
    size = columns.map((col, c) => sizeOf(col, sideBy[c]));
  }
  const TARGET = 2.2;
  let best = null;
  for (let k = stack || given ? columns.length : 1; k <= columns.length; k++) {   // 서브넷은 줄을 바꾸지 않고 한 줄로 쌓는다. AI 배치안도 단을 그대로 한 줄로
    let M = 0, C = 0, rows = 0;
    for (let i = 0; i < columns.length; i += k) { const row = size.slice(i, i + k); M = Math.max(M, row.reduce((t, s) => t + s.main, 0) + GAP * (row.length - 1)); C += Math.max(...row.map((s) => s.cross)); rows++; }
    C += GAP * (rows - 1);
    const [w, h] = ax === 'x' ? [M, C] : [C, M];
    const score = Math.abs(Math.log((w / h) / TARGET));
    if (!best || score < best.score - 1e-9) best = { k, score };
  }
  const x0 = Math.min(...items.map((k) => k.x)), y0 = Math.min(...items.map((k) => k.y));
  const start = { x: x0, y: y0 };
  let c0 = start[cross];
  for (let i = 0; i < columns.length; i += best.k) {
    const row = columns.slice(i, i + best.k), rs = size.slice(i, i + best.k);
    const rowCross = Math.max(...rs.map((s) => s.cross));
    let m = start[pos];
    row.forEach((col, j) => {
      const off = ax === 'x' ? Math.round((rowCross - rs[j].cross) / 2) : 0;   // 가로 흐름은 단을 위아래 가운데에, 세로 쌓기는 왼쪽 맞춤
      if (sideBy[i + j]) { let mm = m; for (const t of col) { items[t][pos] = mm; items[t][cross] = c0 + off; mm += items[t][len] + GAP; } }
      else for (const t of col) { items[t][pos] = m + mo[t]; items[t][cross] = c0 + off + at[t]; }
      m += rs[j].main + GAP;
    });
    c0 += rowCross + GAP;
  }
  for (const k of items) {
    if (k.grp) { k.o.x = Math.round(k.x); k.o.y = Math.round(k.y); }
    else { k.o.x = Math.round(k.icon ? k.x + half : k.x); k.o.y = Math.round(k.y); }
  }
  return true;
}

/**
 * 자동으로 놓인 아이콘을 줄 맞춤: 같은 상자 안에서 거의 같은 높이(±28px)면 한 줄로, 거의 같은 가로 위치면 한 세로줄로.
 * 맞춘 뒤 다른 것과 겹치게 되는 이동은 하지 않는다.
 */
export function alignNodes(g, ids, tol = 28) {
  if (!ids?.size) return g;
  const byParent = new Map();
  for (const n of g.nodes) if (ids.has(n.id) && !isBox(n)) (byParent.get(n.parent ?? null) || byParent.set(n.parent ?? null, []).get(n.parent ?? null)).push(n);
  const boxOf = (n, x = n.x, y = n.y) => ({ x, y, w: ICON_SIZE, h: ICON_SIZE + LABEL_SPACE });
  for (const [pid, list] of byParent) {
    const others = [...g.nodes.filter((n) => (n.parent ?? null) === pid), ...g.groups.filter((x) => (x.parent ?? null) === pid)];
    const clear = (n, x, y) => others.every((o) => o === n || !hit(boxOf(n, x, y), 'kind' in o || isBox(o) ? { x: o.x, y: o.y, w: o.w, h: o.h } : boxOf(o)));
    for (const axis of ['y', 'x']) {
      const sorted = [...list].sort((a, b) => a[axis] - b[axis]);
      let band = [];
      const flush = () => {
        if (band.length > 1) {
          const v = Math.round(band.reduce((s, n) => s + n[axis], 0) / band.length);
          for (const n of band) if (axis === 'y' ? clear(n, n.x, v) : clear(n, v, n.y)) n[axis] = v;
        }
        band = [];
      };
      for (const n of sorted) { if (band.length && n[axis] - band[0][axis] > tol) flush(); band.push(n); }
      flush();
    }
  }
  return g;
}

/**
 * 자동 정렬(사용자가 고른 것): 고른 상자와 그 안의 상자를 내용에 맞게 줄이고 형제끼리 크기·간격을 맞춘 뒤, 아이콘 줄을 맞춘다.
 * 잠근 것은 skip 에 넣어 건드리지 않는다.
 */
/**
 * 마지막 안전망: 상자를 내용에 맞춰 키운 뒤(fitGroups) 형제끼리 다시 겹치면, 덜 움직이는 쪽(오른쪽 또는 아래)으로 비킨다.
 * 안쪽 상자부터 하고, 비킨 만큼 부모가 다시 커진다.
 */
function separate(g, ids, isOverlay, GAP = 24, refit = true) {
  const depth = depthMap(g);
  const half = Math.max(0, (LABEL_WIDTH - ICON_SIZE) / 2);
  const parents = [...new Set([...g.groups, ...g.nodes].filter((x) => ids.has(x.id)).map((x) => x.parent ?? null))]
    .sort((a, b) => (b == null ? -1 : depth.get(b)) - (a == null ? -1 : depth.get(a)));
  for (const pid of parents) {
    // 상자와 아이콘(이름표까지)을 같은 판에 놓고 겹침을 푼다. 아이콘끼리는 이름표 사이 간격을 좁게
    const L = [
      ...g.groups.filter((x) => x.parent == pid && !isOverlay(x) && ids.has(x.id)).map((o) => ({ o, x: o.x, y: o.y, w: o.w, h: o.h })),
      ...g.nodes.filter((n) => n.parent == pid && ids.has(n.id)).map((o) => (isBox(o) ? { o, x: o.x, y: o.y, w: o.w, h: o.h } : { o, icon: true, x: o.x - half, y: o.y, w: ICON_SIZE + half * 2, h: ICON_SIZE + LABEL_SPACE })),
    ];
    for (let round = 0; round < 12; round++) {
      let moved = false;
      L.sort((a, b) => a.x - b.x || a.y - b.y);
      for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
        const a = L[i], b = L[j], gap = a.icon && b.icon ? 8 : GAP;
        if (!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)) continue;
        const dx = a.x + a.w + gap - b.x, dy = a.y + a.h + gap - b.y;
        if (dx <= dy) b.x += dx; else b.y += dy;
        moved = true;
      }
      if (!moved) break;
    }
    for (const k of L) { k.o.x = Math.round(k.icon ? k.x + half : k.x); k.o.y = Math.round(k.y); }
    if (refit) fitGroups(g);
  }
}

/** 오른쪽·아래에 남은 빈 공간만 걷어 낸다(안의 것은 움직이지 않음). 앞 단계에서 자리가 당겨진 뒤 상자가 넓게 남는 것을 막는다. */
function trimGroups(g, ids, isOverlay) {
  const half = Math.max(0, (LABEL_WIDTH - ICON_SIZE) / 2);
  const depth = depthMap(g);
  for (const grp of g.groups.filter((x) => ids.has(x.id) && !isOverlay(x)).sort((a, b) => depth.get(b.id) - depth.get(a.id))) {
    const kids = [...g.groups.filter((c) => c.parent === grp.id), ...g.nodes.filter((n) => n.parent === grp.id)];
    if (!kids.length) continue;
    let r = 0, b = 0;
    for (const k of kids) {
      if ('kind' in k || isBox(k)) { r = Math.max(r, k.x + k.w); b = Math.max(b, k.y + k.h); }
      else { r = Math.max(r, k.x + ICON_SIZE + half); b = Math.max(b, k.y + ICON_SIZE + LABEL_SPACE); }
    }
    grp.w = Math.min(grp.w, Math.max(160, Math.round(r + 24)));   // 줄이기만 한다
    grp.h = Math.min(grp.h, Math.max(110, Math.round(b + 20)));
  }
}

function hugMembers(g, list) {
  if (!list.length) return;
  const rects = absoluteRects(g);
  for (const [grp, members] of list) {
    const rs = members.map((m) => rects.get(m)).filter(Boolean);
    if (!rs.length) continue;
    const half = Math.max(0, (LABEL_WIDTH - ICON_SIZE) / 2);
    const x0 = Math.min(...rs.map((r) => r.x)) - half - 16, y0 = Math.min(...rs.map((r) => r.y)) - 34;
    const x1 = Math.max(...rs.map((r) => r.x + r.w)) + half + 16, y1 = Math.max(...rs.map((r) => r.y + r.h)) + LABEL_SPACE + 10;
    const pr = grp.parent ? rects.get(grp.parent) : { x: 0, y: 0 };
    grp.x = Math.round(x0 - pr.x); grp.y = Math.round(y0 - pr.y); grp.w = Math.round(x1 - x0); grp.h = Math.round(y1 - y0);
  }
}

export function autoArrange(g, ids, isOverlay = () => false, skip = new Set(), { plan = null } = {}) {
  // 흐름 배치 뒤의 줄 맞춤(평균 자리)은 한 번에 자리를 잡지 못할 수 있어, 자리가 더 안 바뀔 때까지(최대 3번) 되풀이한다
  // 3번 안에 안 멈추면(어지럽힌 큰 그림) 그중 가장 작게 나온 결과를 택한다 — 되풀이할수록 커지지 않게
  const snap = () => JSON.stringify([...g.groups.map((x) => [x.x, x.y, x.w, x.h]), ...g.nodes.map((n) => [n.x, n.y])]);
  const area = () => { const rs = [...absoluteRects(g).values()]; if (!rs.length) return 0; const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h)); return (x1 - x0) * (y1 - y0); };
  const tries = [];
  for (let pass = 0; pass < 3; pass++) {
    const before = snap();
    arrangeOnce(g, ids, isOverlay, skip, plan);
    const after = snap();
    tries.push({ area: area(), groups: g.groups.map((x) => [x.x, x.y, x.w, x.h]), nodes: g.nodes.map((n) => [n.x, n.y]) });
    if (after === before) return g;
  }
  const best = tries.reduce((a, b) => (b.area < a.area ? b : a));
  if (best !== tries[tries.length - 1]) {
    g.groups.forEach((x, i) => { [x.x, x.y, x.w, x.h] = best.groups[i]; });
    g.nodes.forEach((n, i) => { [n.x, n.y] = best.nodes[i]; });
  }
  return g;
}

function arrangeOnce(g, ids, isOverlay, skip, plan = null) {
  const groups = new Set(), nodes = new Set();
  for (const id of ids) {
    if (skip.has(id)) continue;
    if (g.groups.some((x) => x.id === id)) { groups.add(id); for (const d of descendants(g, id)) (g.groups.some((x) => x.id === d) ? groups : nodes).add(d); }
    else nodes.add(id);
  }
  for (const id of skip) { groups.delete(id); nodes.delete(id); }
  // 상자 밖(최상위) 아이콘이 줄어든 상자에서 동떨어지지 않게: 줄이기 전 바깥 상자 테두리와의 거리를 기억해 둔다
  const tops = g.groups.filter((x) => !x.parent && !isOverlay(x));
  const before = absoluteRects(g);
  const box = (rs) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const t of tops) { const r = rs.get(t.id); x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); } return tops.length ? { x0, y0, x1, y1 } : null; };
  const B0 = box(before);
  // 맨 바깥에서 고른 것들의 왼쪽 위 모서리: 정리가 끝나면 그 자리로 되돌려, 누를 때마다 그림 전체가 미끄러지지 않게 한다
  const topSel = [...g.groups.filter((x) => !x.parent && !isOverlay(x) && groups.has(x.id)), ...g.nodes.filter((n) => !n.parent && nodes.has(n.id))];
  const corner = (rs) => topSel.length ? { x: Math.min(...topSel.map((t) => rs.get(t.id).x)), y: Math.min(...topSel.map((t) => rs.get(t.id).y)) } : null;
  const C0 = corner(before);
  // 겹치는 상자(ASG 등)는 멤버를 기억해 두었다가 정리 뒤 멤버에 다시 맞춘다
  const inside = (r, q) => q.x + q.w / 2 >= r.x && q.x + q.w / 2 <= r.x + r.w && q.y + q.h / 2 >= r.y && q.y + q.h / 2 <= r.y + r.h;
  // 멤버는 그 겹치는 상자가 든 상자 안의 것만 (밖의 아이콘을 안고 늘어나지 않게)
  const within = (n, pid) => { if (pid == null) return true; let p = n.parent; let guard = 0; while (p && guard++ < 512) { if (p === pid) return true; p = g.groups.find((q) => q.id === p)?.parent; } return false; };
  const overlayMembers = g.groups.filter((x) => isOverlay(x) && groups.has(x.id)).map((ov) => [ov, g.nodes.filter((n) => within(n, ov.parent ?? null) && inside(before.get(ov.id), before.get(n.id))).map((n) => n.id)]);
  tightenGroups(g, groups, isOverlay);
  // 흐름대로 단 나누기: 안쪽 상자부터(자식 자리가 정해져야 그 상자 크기가 정해진다). 맨 바깥은 고른 상자끼리만
  const depth = depthMap(g);
  for (const grp of g.groups.filter((x) => groups.has(x.id) && !isOverlay(x)).sort((a, b) => depth.get(b.id) - depth.get(a.id))) {
    if (flowSiblings(g, grp.id, groups, nodes, isOverlay, 24, plan)) tightenGroups(g, new Set([grp.id]), isOverlay);
  }
  flowSiblings(g, null, groups, nodes, isOverlay, 24, plan);
  // 맨 바깥 상자·아이콘끼리도 겹치거나 동떨어지지 않게 (선택에 든 것만)
  tidySiblings(g.groups.filter((x) => !x.parent && !isOverlay(x) && groups.has(x.id)), g.nodes.filter((n) => !n.parent && nodes.has(n.id)));
  alignNodes(g, nodes);
  fitGroups(g);
  separate(g, new Set([...groups, ...nodes]), isOverlay);
  hugMembers(g, overlayMembers);
  trimGroups(g, groups, isOverlay);
  const B1 = box(absoluteRects(g));
  if (B0 && B1) {
    const after = absoluteRects(g);
    const GAP = 64;
    for (const n of g.nodes) {
      if (n.parent || !nodes.has(n.id) || isBox(n)) continue;
      const r0 = before.get(n.id);
      const cx = r0.x + ICON_SIZE / 2;
      if (cx > B0.x1) n.x = Math.round(B1.x1 + Math.min(Math.max(r0.x - B0.x1, GAP), 160));          // 오른쪽에 있던 것: 오른쪽 테두리 옆으로
      else if (cx < B0.x0) n.x = Math.round(B1.x0 - ICON_SIZE - Math.min(Math.max(B0.x0 - r0.x - ICON_SIZE, GAP), 160));   // 왼쪽
      // 연결된 상자 안 아이콘과 같은 높이로 (가장 먼저 이어진 것)
      const e = g.edges.find((x) => (x.source === n.id && x.target) || (x.target === n.id && x.source));
      const other = e && (e.source === n.id ? e.target : e.source);
      const o = other && g.nodes.find((x) => x.id === other && x.parent) ? after.get(other) : null;
      if (o) n.y = Math.round(o.y + (o.h - ICON_SIZE) / 2);
      else if (r0.y > B0.y1) n.y = Math.round(B1.y1 + GAP);
    }
    // 바깥 아이콘끼리 겹치면 아래로 비킨다
    const outs = g.nodes.filter((n) => !n.parent && !isBox(n)).sort((a, b) => a.y - b.y || a.x - b.x);
    const sz = (n) => ({ x: n.x - 20, y: n.y, w: ICON_SIZE + 40, h: ICON_SIZE + LABEL_SPACE });
    for (let i = 0; i < outs.length; i++) for (let j = 0; j < i; j++) if (hit(sz(outs[i]), sz(outs[j]))) outs[i].y = outs[j].y + ICON_SIZE + LABEL_SPACE + 16;
  }
  // 바깥 아이콘을 다시 놓은 뒤에도 상자 위에 얹힌 것(소속 없이 상자 자리에 놓인 아이콘)이 없게 한 번 더
  separate(g, new Set(topSel.map((t) => t.id)), isOverlay, 24, false);   // 맨 바깥만 옮긴다(상자 크기는 그대로)
  if (C0) {
    const C1 = corner(absoluteRects(g));
    const dx = Math.round(C0.x - C1.x), dy = Math.round(C0.y - C1.y);
    if (dx || dy) for (const t of topSel) { t.x += dx; t.y += dy; }
    // 겹치는 상자 중 맨 바깥에 있는 것도 같이
    if (dx || dy) for (const ov of g.groups.filter((x) => !x.parent && isOverlay(x) && groups.has(x.id))) { ov.x += dx; ov.y += dy; }
  }
  return g;
}
