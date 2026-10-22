// 그래프 좌표 계산. 캔버스 엣지 그리기와 PowerPoint 내보내기가 같은 함수를 써서 모양이 어긋나지 않게 한다.
import { ICON_SIZE } from './schema.js';

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
export function edgeGeometry(a, b, dropA = 0, dropB = 0) {
  const [s, t] = pickSides(a, b);
  const p1 = sidePoint(a, s);
  const p2 = sidePoint(b, t);
  if (s === 'b') p1.y += dropA;
  if (t === 'b') p2.y += dropB;
  return { s, t, p1, p2, horizontal: s === 'l' || s === 'r' };
}

export function edgePath(geo, shape) {
  const { p1, p2, horizontal } = geo;
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
    const mx = (p1.x + p2.x) / 2;
    return { d: `M ${p1.x} ${p1.y} L ${mx} ${p1.y} L ${mx} ${p2.y} L ${p2.x} ${p2.y}`, mid: { x: mx, y: (p1.y + p2.y) / 2 } };
  }
  const my = (p1.y + p2.y) / 2;
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

const PAD = 24;
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
