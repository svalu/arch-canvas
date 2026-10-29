// 개요도: 제안서 한 칸(슬라이드 1/4)에 들어가게 원본 그림을 줄인다. 원본은 건드리지 않고 새 그래프를 돌려준다.
//   1. 같은 구조가 반복되는 상자(AZ A·B 같은 쌍둥이)는 하나만 남기고 이름에 ×N 을 붙인다. 선은 남은 쪽으로 옮기고 겹치면 하나로.
//   2. 보조 요소(NAT Gateway 등)는 뺀다.
//   3. 겹치는 상자(Auto Scaling 등)는 접고, 안에 있던 아이콘 이름에 "(Auto Scaling)" 처럼 붙인다. 합친 AZ 안의 DB 는 "Multi-AZ".
//   4. 세로로 쌓인 상자들은 한 줄로 눕혀서 가로로 긴 모양을 만들고, 빈 공간을 줄인다.
import { absoluteRects, autoArrange, depthMap } from './geometry.js';
import { isOverlay, membersOf } from './contain.js';

const HELPER_ICON = /NAT-Gateway|Bastion/i;                 // 개요도에서 빼는 보조 아이콘
const DB_ICON = /RDS|Aurora|DynamoDB|DocumentDB|ElastiCache/i;
const OVERLAY_TAG = { 'auto-scaling': 'Auto Scaling', 'auto-scaling-group': 'Auto Scaling', 'security-group': '', 'spot-fleet': 'Spot' };
const GAP = 12;

const clone = (g) => JSON.parse(JSON.stringify(g));
const byPos = (a, b) => a.y - b.y || a.x - b.x;

/** 상자의 "구조 서명": 종류 + 안에 든 상자 서명들 + 안에 든 아이콘들. 서명이 같으면 쌍둥이로 본다. */
function signature(g, grp, memo) {
  if (memo.has(grp.id)) return memo.get(grp.id);
  const kids = g.groups.filter((c) => c.parent === grp.id && !isOverlay(c)).map((c) => signature(g, c, memo)).sort();
  const icons = g.nodes.filter((n) => n.parent === grp.id).map((n) => n.icon || n.type || '').sort();
  const s = `${grp.kind}[${kids.join(',')}|${icons.join(',')}]`;
  memo.set(grp.id, s);
  return s;
}

/** 남길 상자와 지울 상자를 같은 자리끼리 짝지어 alias(지울 id → 남길 id)를 채운다. */
function pairTrees(g, keep, drop, memo, alias) {
  alias.set(drop.id, keep.id);
  const kidsOf = (p) => g.groups.filter((c) => c.parent === p.id && !isOverlay(c)).sort((a, b) => signature(g, a, memo).localeCompare(signature(g, b, memo)) || byPos(a, b));
  const nodesOf = (p) => g.nodes.filter((n) => n.parent === p.id).sort((a, b) => (a.icon || '').localeCompare(b.icon || '') || byPos(a, b));
  const ka = kidsOf(keep), kb = kidsOf(drop);
  for (let i = 0; i < Math.min(ka.length, kb.length); i++) pairTrees(g, ka[i], kb[i], memo, alias);
  const na = nodesOf(keep), nb = nodesOf(drop);
  for (let i = 0; i < Math.min(na.length, nb.length); i++) alias.set(nb[i].id, na[i].id);
}

// "Availability Zone A" → "Availability Zone", "Private subnet (App)" 은 그대로
const baseLabel = (s) => String(s || '').replace(/\s*[-·]?\s*(?:[A-Z]|\d{1,2}|[가-힣])$/, '').trim() || String(s || '');

/** 세로로 쌓인 자식 상자들은 한 줄로 눕히고, 같은 상자에 직접 든 아이콘(IGW·ALB 등)은 그 왼쪽에 흐름 순서로 세운다. */
function rowify(g, changed) {
  // 안쪽 상자부터: 바깥 상자가 줄을 세울 때 안쪽이 이미 납작해져 있어야 세로 가운데가 맞는다
  const depth = depthMap(g);
  const parents = [...new Set(g.groups.map((x) => x.parent))].sort((a, b) => (b == null ? -1 : depth.get(b)) - (a == null ? -1 : depth.get(a)));
  for (const pid of parents) {
    const kids = g.groups.filter((c) => c.parent === pid && !isOverlay(c)).sort((a, b) => a.y - b.y);
    const siblings = g.nodes.filter((n) => n.parent === pid).sort((a, b) => a.x - b.x || a.y - b.y);
    if (!kids.length) continue;
    let stacked = kids.length >= 2;
    for (let i = 1; i < kids.length && stacked; i++) if (kids[i].y < kids[i - 1].y + kids[i - 1].h - 4) stacked = false;
    if (!stacked && !(changed && siblings.length)) continue;   // 아무것도 안 줄었으면 자리도 안 건드린다
    const y = Math.min(...kids.map((k) => k.y));
    const bandH = stacked ? Math.max(...kids.map((k) => k.h)) : Math.max(...kids.map((k) => k.y + k.h)) - y;
    let x = Math.min(...kids.map((k) => k.x), ...siblings.map((n) => n.x));
    for (const n of siblings) { n.x = Math.round(x); n.y = Math.round(y + bandH / 2 - 24); x += 48 + 72; }
    if (stacked) for (const k of kids) { k.x = Math.round(x); k.y = y; x += k.w + GAP; }
    else { const dx = Math.round(x - Math.min(...kids.map((k) => k.x))); if (dx > 0) for (const k of kids) k.x += dx; }
    // 줄을 세운 상자는 바로 납작하게 (정확한 크기는 뒤의 조이기가 맞춘다)
    const P = g.groups.find((x) => x.id === pid);
    if (P) { P.h = Math.round(y + bandH + 20); P.w = Math.round(Math.max(...kids.map((k) => k.x + k.w), ...siblings.map((n) => n.x + 48)) + 24); }
  }
}

/**
 * @returns { graph, notes: string[] }  notes 는 무엇을 줄였는지 한 줄씩 (토스트용)
 */
export function compactGraph(src) {
  const g = clone(src);
  const notes = [];
  const n0 = { groups: g.groups.length, nodes: g.nodes.length, edges: g.edges.length };

  // 1. 쌍둥이 상자 합치기
  const memo = new Map(), alias = new Map(), mergedAz = new Set();
  const parents = [...new Set(g.groups.map((x) => x.parent))];
  for (const pid of parents) {
    const sibs = g.groups.filter((x) => x.parent === pid && !isOverlay(x));
    const bySig = new Map();
    for (const s of sibs) { const k = signature(g, s, memo); if (!bySig.has(k)) bySig.set(k, []); bySig.get(k).push(s); }
    for (const twins of bySig.values()) {
      if (twins.length < 2) continue;
      twins.sort(byPos);
      const keep = twins[0], base = baseLabel(keep.label) || keep.kind;
      for (const d of twins.slice(1)) pairTrees(g, keep, d, memo, alias);
      keep.label = `${base} ×${twins.length}`;
      if (keep.kind === 'az') mergedAz.add(keep.id);
      notes.push(`${base} ${twins.length}개 → 1개`);
    }
  }
  const dropIds = new Set([...alias.keys()]);
  // 지울 상자의 후손도 모두 지운다 (짝이 안 맞아 alias 에 없는 것 포함)
  let grew = true;
  while (grew) { grew = false; for (const x of [...g.groups, ...g.nodes]) if (x.parent && dropIds.has(x.parent) && !dropIds.has(x.id)) { dropIds.add(x.id); grew = true; } }
  g.groups = g.groups.filter((x) => !dropIds.has(x.id));
  g.nodes = g.nodes.filter((x) => !dropIds.has(x.id));
  const re = (id) => (id == null ? id : alias.has(id) ? alias.get(id) : dropIds.has(id) ? null : id);
  g.edges = g.edges.map((e) => ({ ...e, source: re(e.source), target: re(e.target) })).filter((e) => (e.source || e.sp) && (e.target || e.tp) && e.source !== e.target);

  // 2. 보조 아이콘 빼기
  const helpers = new Set(g.nodes.filter((n) => HELPER_ICON.test(n.icon || '')).map((n) => n.id));
  if (helpers.size) { notes.push(`보조 아이콘 ${helpers.size}개 뺌`); g.nodes = g.nodes.filter((n) => !helpers.has(n.id)); g.edges = g.edges.filter((e) => !helpers.has(e.source) && !helpers.has(e.target)); }

  // 3. 겹치는 상자 접기 + 이름표에 표시
  const rects = absoluteRects(g);
  const tag = (n, t) => { if (t && !String(n.label || '').includes(t)) n.label = `${n.label || ''} (${t})`.trim(); };
  for (const ov of g.groups.filter(isOverlay)) {
    const t = OVERLAY_TAG[ov.kind] ?? baseLabel(String(ov.label || '').replace(/\s*\(.*?\)/g, ''));   // "ECS Cluster (Fargate)" → "ECS Cluster"
    for (const id of membersOf(g, rects, ov.id)) { const n = g.nodes.find((x) => x.id === id); if (n) tag(n, t); }
    if (t) notes.push(`${t} 상자 접음`);
  }
  g.groups = g.groups.filter((x) => !isOverlay(x));
  if (mergedAz.size) {
    const inAz = new Set(); for (const id of mergedAz) { inAz.add(id); for (const x of [...g.groups, ...g.nodes]) if (x.parent && inAz.has(x.parent)) inAz.add(x.id); }
    for (const n of g.nodes) if (inAz.has(n.id) && DB_ICON.test(n.icon || '')) tag(n, 'Multi-AZ');
  }

  // 선: 이름표·꺾임은 빼고, 같은 선은 하나로
  const seen = new Set();
  g.edges = g.edges.filter((e) => { const k = `${e.source || 'f'}>${e.target || 'f'}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((e) => { const { label, bend, ...rest } = e; return rest; });

  // 4. 빈 상자(보조 아이콘을 빼고 나서 비었거나 원래 빈 것)는 뺀다. 아이콘이 하나도 없는 뼈대 그림이면 그대로 둔다.
  if (g.nodes.length) {
    let removed = 0, again = true;
    while (again) {
      again = false;
      for (const x of [...g.groups]) {
        if (g.nodes.some((n) => n.parent === x.id) || g.groups.some((c) => c.parent === x.id)) continue;
        g.groups = g.groups.filter((y) => y !== x); removed++; again = true;
      }
    }
    if (removed) notes.push(`빈 상자 ${removed}개 뺌`);
  }

  // 5. 눕히고 조이기
  // 먼저 조여서 상자들이 실제 크기가 된 뒤에 줄을 세우고, 다시 조인다
  const all = () => [...g.groups.map((x) => x.id), ...g.nodes.map((x) => x.id)];
  autoArrange(g, all(), isOverlay);
  rowify(g, alias.size > 0 || helpers.size > 0);
  autoArrange(g, all(), isOverlay);

  g.title = `${src.title || '다이어그램'} (개요도)`;
  g.annotations = [];
  notes.push(`선 ${n0.edges} → ${g.edges.length}`);
  return { graph: g, notes, before: n0, after: { groups: g.groups.length, nodes: g.nodes.length, edges: g.edges.length } };
}
