// 개요도: 제안서 한 칸(슬라이드 1/4)에 들어가게 원본 그림을 줄인다. 원본은 건드리지 않고 새 그래프를 돌려준다.
//   1. 같은 상자가 반복되면(AZ A·C 처럼 종류가 같고 이름이 끝 글자만 다른 형제) 하나만 남기고 이름에 ×N 을 붙인다.
//      안의 것은 종류·이름(아이콘은 모양·이름)으로 짝지어 합치고, 한쪽에만 있는 것은 남는 상자로 옮겨 살린다. 선은 남은 쪽으로.
//   2. 보조 요소(NAT Gateway 등)는 뺀다. DR·백업 같은 보조 환경과 관리·보안 서비스 묶음은 상자 하나로 접고, 선은 그 상자로 잇는다.
//   3. 겹치는 상자(Auto Scaling 등)는 접고, 안에 있던 아이콘 이름에 "(Auto Scaling)" 처럼 붙인다. 합친 AZ 안의 DB 는 "Multi-AZ".
//   4. 세로로 쌓인 상자들은 한 줄로 눕혀서 가로로 긴 모양을 만들고, 빈 공간을 줄인다.
import { absoluteRects, autoArrange, depthMap } from './geometry.js';
import { isOverlay, membersOf } from './contain.js';

const HELPER_ICON = /NAT-Gateway|Bastion/i;                 // 개요도에서 빼는 보조 아이콘
const DB_ICON = /RDS|Aurora|DynamoDB|DocumentDB|ElastiCache/i;
const EC2_ICON = /EC2|Instance|Auto-Scaling|Container|Fargate|ECS|EKS/i;
const AUX_ENV = /(^|[^A-Za-z])DR([^A-Za-z]|$)|재해|복구|백업|backup|standby|스탠바이|disaster/i;   // 보조 환경 상자 이름
const MGMT_ICON = /CloudWatch|CloudTrail|Identity-and-Access|IAM|Identity-Center|Config|GuardDuty|Security-Hub|Key-Management|Systems-Manager|Organizations|Inspector|Macie|Audit-Manager|Control-Tower/i;
const shortName = (s) => String(s || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/^[①-⑳\s]+/, '').trim();
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

// "Availability Zone A" → "Availability Zone", "App 서브넷 C" → "App 서브넷", "Private subnet (App)" 은 그대로
const baseLabel = (s) => String(s || '').replace(/\s*[-·]?\s*(?:[A-Z]|\d{1,2}|[가-힣])$/, '').trim() || String(s || '');
const groupKey = (x) => `${x.kind}|${baseLabel(x.label).toLowerCase()}`;
// 아이콘 짝짓기용 이름: 끝의 A/C, (주)·(대기)·Primary·Standby 같은 역할 표시는 뺀다
const nodeKey = (n) => `${n.icon || n.type}|${baseLabel(String(n.label || '').replace(/\s*\((?:주|대기|primary|standby|active|passive|replica|복제본?)\)/gi, '').replace(/(?:primary|standby)/gi, '')).toLowerCase()}`;

/**
 * drop 을 keep 에 합친다. 짝이 있는 것은 alias(지울 id → 남길 id)에 넣고, 짝이 없는 것은 keep 쪽으로 옮겨 살린다.
 * 상자는 종류+이름, 아이콘은 모양+이름 → 그래도 남으면 같은 모양끼리 짝짓는다(RDS 주/대기 같은 것).
 */
function mergeInto(g, keep, drop, alias) {
  alias.set(drop.id, keep.id);
  const kidsOf = (p) => g.groups.filter((c) => c.parent === p.id && !isOverlay(c)).sort(byPos);
  const ka = kidsOf(keep), used = new Set();
  for (const c of kidsOf(drop)) {
    const m = ka.find((k) => !used.has(k.id) && groupKey(k) === groupKey(c));
    if (m) { used.add(m.id); m.label = baseLabel(m.label); mergeInto(g, m, c, alias); } else c.parent = keep.id;
  }
  const nodesOf = (p) => g.nodes.filter((n) => n.parent === p.id).sort(byPos);
  const na = nodesOf(keep), taken = new Set(), left = [];
  for (const n of nodesOf(drop)) {
    const m = na.find((k) => !taken.has(k.id) && nodeKey(k) === nodeKey(n));
    if (m) { taken.add(m.id); alias.set(n.id, m.id); } else left.push(n);
  }
  for (const n of left) {
    const m = na.find((k) => !taken.has(k.id) && (k.icon || k.type) === (n.icon || n.type));
    if (m) { taken.add(m.id); alias.set(n.id, m.id); } else n.parent = keep.id;
  }
}

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
    else {
      const dx = Math.round(x - Math.min(...kids.map((k) => k.x))); if (dx > 0) for (const k of kids) k.x += dx;
      // 안쪽 상자가 넓어져서 옆 상자와 겹치면 옆으로 민다 (위아래로 쌓이지 않게)
      const placed = [];
      for (const k of [...kids].sort((a, b) => a.x - b.x)) {
        for (const p of placed) if (k.y < p.y + p.h && p.y < k.y + k.h && k.x < p.x + p.w + GAP) k.x = p.x + p.w + GAP;
        placed.push(k);
      }
    }
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

  // 1. 쌍둥이 상자 합치기 (바깥 상자부터)
  const memo = new Map(), alias = new Map(), mergedAz = new Set();
  const depth = depthMap(g);
  const parents = [...new Set(g.groups.map((x) => x.parent))].sort((a, b) => (a == null ? -1 : depth.get(a)) - (b == null ? -1 : depth.get(b)));
  for (const pid of parents) {
    if (pid != null && alias.has(pid)) continue;                 // 이미 합쳐진 상자의 안쪽은 합칠 때 처리했다
    const sibs = g.groups.filter((x) => x.parent === pid && !isOverlay(x) && !alias.has(x.id));
    // 이름이 있으면 종류+이름(끝 글자 빼고)이 같은 형제끼리, 이름이 끝 글자까지 똑같거나 없으면 구조까지 같아야 쌍둥이
    const buckets = new Map();
    for (const s of sibs) {
      const named = baseLabel(s.label) && baseLabel(s.label) !== String(s.label || '').trim();
      const k = named ? 'n:' + groupKey(s) : 's:' + signature(g, s, memo);
      if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(s);
    }
    for (const twins of buckets.values()) {
      if (twins.length < 2) continue;
      twins.sort(byPos);
      const keep = twins[0], base = baseLabel(keep.label) || keep.kind;
      for (const d of twins.slice(1)) mergeInto(g, keep, d, alias);
      keep.label = `${base} ×${twins.length}`;
      if (keep.kind === 'az') mergedAz.add(keep.id);
      notes.push(`${base} ${twins.length}개 → 1개`);
    }
  }
  const dropIds = new Set([...alias.keys()]);
  g.groups = g.groups.filter((x) => !dropIds.has(x.id));
  g.nodes = g.nodes.filter((x) => !dropIds.has(x.id));
  const re = (id) => (id == null ? id : alias.has(id) ? alias.get(id) : dropIds.has(id) ? null : id);
  g.edges = g.edges.map((e) => ({ ...e, source: re(e.source), target: re(e.target) })).filter((e) => (e.source || e.sp) && (e.target || e.tp) && e.source !== e.target);

  // 2. 보조 아이콘 빼기
  const helpers = new Set(g.nodes.filter((n) => HELPER_ICON.test(n.icon || '')).map((n) => n.id));
  if (helpers.size) { notes.push(`보조 아이콘 ${helpers.size}개 뺌`); g.nodes = g.nodes.filter((n) => !helpers.has(n.id)); g.edges = g.edges.filter((e) => !helpers.has(e.source) && !helpers.has(e.target)); }

  // 2-1. 보조 환경(DR 등)·관리 묶음 접기: 안의 것을 지우고 그 상자 하나만 남긴다. 선은 상자로 옮긴다
  const folded = new Set();
  const under = (id) => { const out = new Set(); let grew = true; out.add(id); while (grew) { grew = false; for (const x of [...g.groups, ...g.nodes]) if (x.parent && out.has(x.parent) && !out.has(x.id)) { out.add(x.id); grew = true; } } out.delete(id); return out; };
  const fold = (grp, label) => {
    const gone = under(grp.id);
    g.groups = g.groups.filter((x) => !gone.has(x.id));
    g.nodes = g.nodes.filter((x) => !gone.has(x.id));
    g.edges = g.edges.map((e) => ({ ...e, source: gone.has(e.source) ? grp.id : e.source, target: gone.has(e.target) ? grp.id : e.target })).filter((e) => e.source !== e.target);
    if (label) grp.label = label;
    grp.w = Math.max(200, Math.round(String(grp.label).length * 8 + 90)); grp.h = 96;
    folded.add(grp.id);
    return gone.size;
  };
  const isFoldedIn = (x) => { let p = x.parent; while (p) { if (folded.has(p)) return true; p = g.groups.find((q) => q.id === p)?.parent; } return false; };
  const dep = depthMap(g);
  for (const grp of [...g.groups].sort((a, b) => dep.get(a.id) - dep.get(b.id) || byPos(a, b))) {   // 바깥 상자부터
    if (!g.groups.includes(grp) || isFoldedIn(grp) || isOverlay(grp)) continue;
    if (AUX_ENV.test(grp.label || '') && under(grp.id).size) { const n = fold(grp); notes.push(`${shortName(grp.label) || '보조 환경'} 접음 (${n}개)`); continue; }
    const kids = g.nodes.filter((n) => n.parent === grp.id);
    if (kids.length >= 2 && !g.groups.some((c) => c.parent === grp.id && !isOverlay(c)) && kids.every((n) => MGMT_ICON.test(n.icon || ''))) {
      const names = [...new Set(kids.map((n) => shortName(n.label)).filter(Boolean))];
      fold(grp, `${shortName(grp.label) || '관리·보안'} · ${names.slice(0, 4).join('·')}${names.length > 4 ? ' 외' : ''}`);
      notes.push(`관리 서비스 ${kids.length}개를 묶음 하나로`);
    }
  }

  // 3. 겹치는 상자 접기 + 이름표에 표시
  const rects = absoluteRects(g);
  const tag = (n, t) => { if (t && !String(n.label || '').includes(t)) n.label = `${n.label || ''} (${t})`.trim(); };
  const tagged = new Set();
  for (const ov of g.groups.filter(isOverlay)) {
    const t = OVERLAY_TAG[ov.kind] ?? baseLabel(String(ov.label || '').replace(/\s*\(.*?\)/g, ''));   // "ECS Cluster (Fargate)" → "ECS Cluster"
    // "Auto Scaling · 콘솔·CCP" 처럼 대상이 적혀 있으면 그 이름이 든 아이콘에만. Auto Scaling 은 EC2 류에만 붙는다
    const desc = String(ov.label || '').split(/\s+[·\-–:]\s+/).slice(1).join(' ');
    const words = desc.split(/[\s·,/()]+/).filter((w) => w.length >= 2);
    for (const id of membersOf(g, rects, ov.id)) {
      const n = g.nodes.find((x) => x.id === id);
      if (!n) continue;
      if (/auto-scaling/.test(ov.kind) && !EC2_ICON.test(n.icon || '')) continue;
      if (words.length && !words.some((w) => String(n.label || '').toLowerCase().includes(w.toLowerCase()))) continue;
      tag(n, t); tagged.add(id);
    }
    if (t && !notes.includes(`${t} 상자 접음`)) notes.push(`${t} 상자 접음`);
  }
  g.groups = g.groups.filter((x) => !isOverlay(x));
  if (mergedAz.size) {
    const inAz = new Set(); for (const id of mergedAz) { inAz.add(id); for (const x of [...g.groups, ...g.nodes]) if (x.parent && inAz.has(x.parent)) inAz.add(x.id); }
    for (const n of g.nodes) if (inAz.has(n.id) && DB_ICON.test(n.icon || '')) {
      n.label = String(n.label || '').replace(/\s*\((?:주|대기|primary|standby)\)/gi, '').replace(/\s+(?:primary|standby)$/i, '');   // "RDS Primary" → "RDS"
      tag(n, 'Multi-AZ');
    }
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
        if (folded.has(x.id) || g.nodes.some((n) => n.parent === x.id) || g.groups.some((c) => c.parent === x.id)) continue;
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
