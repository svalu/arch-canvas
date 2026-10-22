// AI 가 좌표 없이 추가한 노드를 연결 관계를 보고 놓는다.
//  - 두 노드 사이에 끼워 넣는 경우(P → N → S): P 와 S 사이. 자리가 좁으면 P 쪽을 밀어 공간을 만든다.
//  - 한쪽만 연결된 경우: 흐름 방향 옆(받는 쪽은 오른쪽, 보내는 쪽은 왼쪽), WAF 같은 부착형은 위/아래.
//  - parent 를 안 줬으면: 리전/글로벌 서비스(CloudFront, WAF, S3, Route 53 …)는 VPC 밖에 두고,
//    그 밖의 것은 연결 상대가 모두 같은 그룹 안에 있으면 그 그룹에 넣는다.
//  - 기존 노드·그룹과 겹치지 않게 주변을 훑어 빈 자리를 찾는다.
import { ICON_SIZE } from './schema.js';
import { absoluteRects, freeSlot } from './geometry.js';

// VPC 밖에 그리는 서비스 (리전·글로벌·사용자 측)
const OUTSIDE_VPC = /CloudFront|WAF|Shield|Route-53|Simple-Storage-Service|Users|User_|Client|Mobile|Internet(?!-Gateway)|Cognito|CloudWatch|Identity-and-Access|IAM|DynamoDB|API-Gateway|Simple-Queue|Simple-Notification|EventBridge|Step-Functions|Certificate-Manager|Global-Accelerator|Organizations|Bedrock|Elastic-Container-Registry|Key-Management|Secrets-Manager|Systems-Manager|CloudTrail|Config|GuardDuty|Backup/;
// 대상에 붙는 형태(옆이 아니라 위·아래가 자연스러운 것)
const ATTACH = /WAF|Shield|Certificate-Manager|Key-Management|CloudWatch|CloudTrail|GuardDuty/;

const GAP = 40;              // 노드 사이 최소 간격
const STEP = 130;            // 옆 자리 간격(아이콘 + 라벨)
// 아이콘의 차지 영역: 라벨(가로 120)까지 포함
const boxOf = (x, y, n) => (n?.type === 'card' || n?.type === 'text' || n?.type === 'badge'
  ? { x, y, w: n.w, h: n.h }
  : { x: x - 30, y, w: ICON_SIZE + 60, h: ICON_SIZE + 36 });
const hit = (a, b, pad = 8) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
const inside = (p, r) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h;

function chainOf(g, id) {
  const out = [];
  for (let p = id; p; p = g.groups.find((x) => x.id === p)?.parent) out.push(p);
  return out;   // [그룹, 부모, 조부모 …]
}

/**
 * @param g        그래프(바로 고친다)
 * @param autoIds  좌표 없이 추가된 노드 id
 * @param parented 그중 parent 를 명시한 노드 id
 */
export function placeAutoNodes(g, autoIds, parented = new Set()) {
  if (!autoIds?.size) return g;
  const todo = new Set([...autoIds].filter((id) => g.nodes.some((n) => n.id === id)));
  const placed = (id) => !todo.has(id) && (g.nodes.some((n) => n.id === id) || g.groups.some((x) => x.id === id));
  const nodeOf = (id) => g.nodes.find((n) => n.id === id);

  // 사슬 먼저: 놓인 P → 새 노드들 → 놓인 S (예: 사용자 → WAF → CloudFront → IGW) 는 P 와 S 사이에 한 줄로
  for (const e of g.edges) {
    if (!placed(e.source) || !todo.has(e.target)) continue;
    const chain = [];
    let cur = e.target, end = null;
    while (cur && todo.has(cur) && !chain.includes(cur)) {
      chain.push(cur);
      const outs = g.edges.filter((x) => x.source === cur && !chain.includes(x.target));
      const nextTodo = outs.find((x) => todo.has(x.target));
      const nextPlaced = outs.find((x) => placed(x.target) && x.target !== e.source);
      // 이미 놓인 노드로 이어지면 거기서 사슬이 끝난다(옆가지인 S3 같은 것은 나중에 따로)
      if (nextPlaced) { end = nextPlaced.target; cur = null; } else if (nextTodo) cur = nextTodo.target; else cur = null;
    }
    if (chain.length >= 2 && end && chain.every((id) => !parented.has(id) && OUTSIDE_VPC.test(nodeOf(id)?.icon || '')) && placeChain(g, e.source, chain.map(nodeOf), end)) chain.forEach((id) => todo.delete(id));
  }

  let guard = 0;
  while (todo.size && guard++ < 200) {
    // 이미 놓인 이웃이 가장 많은 것부터
    const score = (id) => g.edges.filter((e) => (e.source === id && placed(e.target)) || (e.target === id && placed(e.source))).length;
    const next = [...todo].sort((a, b) => score(b) - score(a))[0];
    placeOne(g, nodeOf(next), parented.has(next), placed);
    todo.delete(next);
  }
  return g;
}

function placeOne(g, n, hasParent, placed) {
  const rects = absoluteRects(g);
  const ins = g.edges.filter((e) => e.target === n.id && placed(e.source)).map((e) => e.source);
  const outs = g.edges.filter((e) => e.source === n.id && placed(e.target)).map((e) => e.target);
  const nbs = [...new Set([...ins, ...outs])].filter((id) => rects.has(id));
  if (!nbs.length) return;   // 연결이 없으면 기존 빈 자리 그대로

  // 1) 들어갈 그룹 정하기
  if (!hasParent) {
    if (OUTSIDE_VPC.test(n.icon || '')) n.parent = null;
    else {
      // 이웃들이 공통으로 들어 있는 가장 안쪽 그룹
      const chains = nbs.map((id) => chainOf(g, (g.nodes.find((x) => x.id === id) || g.groups.find((x) => x.id === id))?.parent));
      // 오토 스케일링 그룹·보안 그룹은 묶음 표시일 뿐이라 다른 서비스를 넣는 자리로 쓰지 않는다
      const kindOf = (gid) => g.groups.find((x) => x.id === gid)?.kind;
      const common = chains[0].find((gid) => chains.every((c) => c.includes(gid)) && !['auto-scaling', 'auto-scaling-group', 'security-group', 'spot-fleet'].includes(kindOf(gid)));
      n.parent = common || null;
    }
  }
  const parentRect = n.parent ? rects.get(n.parent) : null;
  const pChain = new Set(chainOf(g, n.parent));

  // 2) 이상적인 위치(절대 좌표, 아이콘 왼쪽 위)
  const c = (id) => { const r = rects.get(id); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };
  let ideal; const order = [];
  if (ins.length && outs.length) {
    const a = c(ins[0]), b = c(outs[0]);
    ideal = { x: (a.x + b.x) / 2 - ICON_SIZE / 2, y: (a.y + b.y) / 2 - ICON_SIZE / 2 };
    order.push('between');
  } else {
    const base = rects.get(nbs[0]);
    const nx = base.x + base.w / 2 - ICON_SIZE / 2, ny = base.y + base.h / 2 - ICON_SIZE / 2;
    if (ATTACH.test(n.icon || '')) order.push({ x: nx, y: base.y - STEP - 30 }, { x: nx, y: base.y + base.h + 100 }, { x: nx - STEP, y: ny }, { x: nx + STEP, y: ny });
    else if (ins.length) order.push({ x: base.x + base.w + STEP - ICON_SIZE, y: ny }, { x: nx, y: base.y + base.h + 100 }, { x: nx, y: base.y - STEP - 30 }, { x: nx - STEP, y: ny });
    else order.push({ x: base.x - STEP, y: ny }, { x: nx, y: base.y - STEP - 30 }, { x: nx, y: base.y + base.h + 100 }, { x: nx + STEP, y: ny });
    ideal = order[0];
  }

  // 3) 피해야 할 것: 다른 노드, (밖에 있어야 하면) 그룹, (그룹 안이면) 형제 그룹
  const blockers = () => {
    const rs = absoluteRects(g);
    const list = g.nodes.filter((x) => x.id !== n.id).map((x) => { const r = rs.get(x.id); return r && boxOf(r.x, r.y, x); }).filter(Boolean);
    for (const grp of g.groups) if (!pChain.has(grp.id)) list.push(rs.get(grp.id));
    return list;
  };
  const free = (p) => {
    const b = boxOf(p.x, p.y, n);
    // 그룹 안이면 아이콘(+라벨 한 줄)이 그룹 안에 다 들어가야 한다. 밖으로 나가면 그룹이 커져 옆 그룹을 덮는다
    if (parentRect && !(p.x >= parentRect.x + 12 && p.y >= parentRect.y + 34 && p.x + ICON_SIZE <= parentRect.x + parentRect.w - 12 && p.y + ICON_SIZE + 18 <= parentRect.y + parentRect.h - 4)) return false;
    return !blockers().some((r) => hit(b, r));
  };

  let pos = null;
  if (order[0] === 'between') {
    pos = betweenSpot(g, n, ins[0], outs[0], ideal, free, rects);
  } else {
    pos = order.find(free) || null;
  }
  if (!pos) pos = spiral(ideal, free, parentRect ? 20 : 12);
  if (!pos && parentRect) pos = grid(parentRect, free);   // 그룹 안 빈칸을 촘촘히
  if (!pos) { const s = freeSlot(g, n.parent); const pr = parentRect || { x: 0, y: 0 }; pos = { x: pr.x + s.x, y: pr.y + s.y }; }
  const pr = parentRect || { x: 0, y: 0 };
  n.x = Math.round(pos.x - pr.x);
  n.y = Math.round(pos.y - pr.y);
}

// P → N → S 사이 자리. 중간점이 그룹 안이면(밖에 있어야 하는데) 그 그룹의 P 쪽 바깥 가장자리로 옮기고,
// 그래도 P 와 부딪히면 P(와 P 쪽 최상위 노드들)를 밀어 공간을 만든다.
function betweenSpot(g, n, pId, sId, ideal, free, rects) {
  if (free(ideal)) return ideal;
  const P = rects.get(pId), S = rects.get(sId);
  // S 를 감싼 최상위 그룹(밖에 있어야 할 때 피해야 할 벽)
  const sItem = g.nodes.find((x) => x.id === sId) || g.groups.find((x) => x.id === sId);
  const top = sItem ? chainOf(g, sItem.parent).filter((gid) => !n.parent || !chainOf(g, n.parent).includes(gid)).pop() : null;
  const wall = top ? rects.get(top) : S;
  const y = P.y + P.h / 2 - ICON_SIZE / 2;
  const leftOfWall = P.x < wall.x;
  const cand = leftOfWall ? { x: wall.x - GAP - ICON_SIZE - 36, y } : { x: wall.x + wall.w + GAP + 36, y };
  if (free(cand)) return cand;
  // 밀기: N 이 들어갈 폭만큼 P 쪽 최상위 노드들을 바깥으로
  const need = ICON_SIZE + 72 + GAP;
  const pNode = g.nodes.find((x) => x.id === pId);
  if (pNode && !pNode.parent) {
    for (const x of g.nodes) {
      if (x.parent || x.id === n.id) continue;
      if (leftOfWall ? x.x <= P.x + 1 : x.x >= P.x - 1) x.x += leftOfWall ? -need : need;
    }
    if (free(cand)) return cand;
  }
  return null;
}

function grid(r, free) {
  for (let y = r.y + 40; y + ICON_SIZE < r.y + r.h; y += 20) for (let x = r.x + 40; x + ICON_SIZE < r.x + r.w; x += 20) if (free({ x, y })) return { x, y };
  return null;
}

function spiral(from, free, rings = 12) {
  for (let r = 1; r <= rings; r++) {
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const p = { x: from.x + dx * r * 40, y: from.y + dy * r * 40 };
      if (free(p)) return p;
    }
  }
  return null;
}

// 사슬 놓기: P 와 S 를 감싼 최상위 그룹(벽) 사이에 같은 간격으로. 자리가 모자라면 P 쪽 최상위 노드들을 밀어낸다.
function placeChain(g, pId, nodes, sId) {
  const rects = absoluteRects(g);
  const P = rects.get(pId), S = rects.get(sId);
  if (!P || !S) return false;
  const sItem = g.nodes.find((x) => x.id === sId) || g.groups.find((x) => x.id === sId);
  const top = chainOf(g, sItem?.parent).pop();
  const wall = top ? rects.get(top) : S;
  const left = P.x < wall.x;
  const y = P.y + P.h / 2 - ICON_SIZE / 2;
  const span = nodes.length * STEP;
  const room = left ? wall.x - (P.x + P.w) : P.x - (wall.x + wall.w);
  const need = span + GAP;
  if (room < need) {
    const shift = need - room;
    const pNode = g.nodes.find((x) => x.id === pId);
    if (!pNode || pNode.parent) return false;
    for (const x of g.nodes) if (!x.parent && !nodes.includes(x) && (left ? x.x <= P.x + 1 : x.x >= P.x - 1)) x.x += left ? -shift : shift;
  }
  const R2 = absoluteRects(g); const P2 = R2.get(pId);
  nodes.forEach((n, i) => {
    n.parent = null;
    n.x = Math.round(left ? P2.x + P2.w + GAP + i * STEP + (STEP - ICON_SIZE) / 2 : P2.x - GAP - (i + 1) * STEP + (STEP - ICON_SIZE) / 2);
    n.y = Math.round(y);
  });
  return true;
}
