// 자동 정렬 스트레스 테스트: 복잡한 그림을 만들고(또는 불러와서) 일부러 어지럽힌 뒤 autoArrange 를 돌려 결과를 잰다.
// 사용: node tools/arrange_stress.mjs [그림.json ...]   (인자가 없으면 합성 그림 + templates/ + _dev/nacs_orig.json)
//   --dump   가장 나쁜 결과를 _dev/stress_*.json 으로 저장
// 확인하는 것:
//   - 형제 상자 겹침 · 아이콘(이름표 포함)끼리 겹침 · 상자 밖으로 나간 요소 → 모두 0 이어야 한다
//   - 소속(parent)이 바뀌지 않는다 · 두 번 돌려도 같은 결과(멱등) · 크기는 줄거나 비슷해야 한다
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeGraph, ICON_SIZE, LABEL_WIDTH } from '../src/model/schema.js';
import { autoArrange, absoluteRects } from '../src/model/geometry.js';
import { isOverlay } from '../src/model/contain.js';
import { compactGraph } from '../src/model/compact.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--save');
const DUMP = process.argv.includes('--dump');
const LABEL_SPACE = 34;
const half = (LABEL_WIDTH - ICON_SIZE) / 2;

// ---- 결정적 난수 -------------------------------------------------------------------------
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// ---- 합성 그림: 리전 × VPC × AZ × 서브넷 × 아이콘, ASG, 리전 밖 서비스, 선 ----------------------
const ICONS = { pub: ['Res_Elastic-Load-Balancing_Application-Load-Balancer', 'Res_Amazon-VPC_NAT-Gateway'], app: ['Res_Amazon-EC2_Instance', 'Arch_AWS-Lambda', 'Arch_Amazon-Elastic-Container-Service'], db: ['Res_Amazon-Aurora_Amazon-RDS-Instance', 'Arch_Amazon-ElastiCache', 'Arch_Amazon-DynamoDB'] };
const GLOBAL = ['Arch_Amazon-CloudFront', 'Arch_Amazon-Route-53', 'Arch_AWS-WAF', 'Arch_Amazon-Simple-Storage-Service', 'Arch_Amazon-CloudWatch', 'Arch_AWS-CloudTrail'];
function synth(name, { regions = 1, vpcs = 1, azs = 2, perSub = 2, seed = 1, asg = true }) {
  const r = rng(seed);
  const g = { schema: 'arch-canvas/graph@1', title: name, groups: [], nodes: [], edges: [], annotations: [] };
  const R = (a, b) => Math.round(a + r() * (b - a));
  let e = 0;
  const link = (s, t) => g.edges.push({ id: 'e' + (++e), source: s, target: t });
  g.nodes.push({ id: 'users', icon: 'Res_Users_Light', label: 'Users', x: 0, y: 200 });
  for (let ri = 0; ri < regions; ri++) {
    const rid = `r${ri}`;
    g.groups.push({ id: rid, kind: 'region', label: `Region ${ri + 1}`, x: 200 + ri * 1800, y: 0, w: 1700, h: 1400 });
    for (const [gi, key] of GLOBAL.slice(0, 3).entries()) g.nodes.push({ id: `${rid}-g${gi}`, icon: key, label: key.split('_').pop(), parent: rid, x: R(20, 400), y: R(40, 300) });
    link('users', `${rid}-g0`);
    for (let vi = 0; vi < vpcs; vi++) {
      const vid = `${rid}-v${vi}`;
      g.groups.push({ id: vid, kind: 'vpc', label: `VPC ${vi + 1}`, parent: rid, x: R(0, 300), y: R(300, 600) + vi * 50, w: R(900, 1500), h: R(700, 1000) });
      g.nodes.push({ id: `${vid}-igw`, icon: 'Res_Amazon-VPC_Internet-Gateway', label: 'IGW', parent: vid, x: R(10, 300), y: R(10, 200) });
      link(`${rid}-g0`, `${vid}-igw`);
      const asgMembers = [];
      for (let ai = 0; ai < azs; ai++) {
        const aid = `${vid}-az${ai}`;
        g.groups.push({ id: aid, kind: 'az', label: `Availability Zone ${String.fromCharCode(65 + ai)}`, parent: vid, x: R(0, 600), y: R(80, 400), w: R(300, 600), h: R(400, 800) });
        let prev = `${vid}-igw`;
        for (const [si, tier] of ['pub', 'app', 'db'].entries()) {
          const sid = `${aid}-${tier}`;
          g.groups.push({ id: sid, kind: tier === 'pub' ? 'public-subnet' : 'private-subnet', label: `${tier === 'pub' ? 'Public' : tier === 'app' ? 'App' : 'Data'} subnet ${String.fromCharCode(65 + ai)}`, parent: aid, x: R(0, 200), y: R(0, 400), w: R(200, 500), h: R(120, 260) });
          for (let k = 0; k < perSub; k++) {
            const nid = `${sid}-n${k}`;
            g.nodes.push({ id: nid, icon: ICONS[tier][k % ICONS[tier].length], label: `${tier}-${k}`, parent: sid, x: R(0, 300), y: R(0, 150) });
            if (k === 0) { link(prev, nid); prev = nid; }
            if (tier === 'app' && k === 0) asgMembers.push(nid);
          }
        }
      }
      if (asg && asgMembers.length) g.groups.push({ id: `${vid}-asg`, kind: 'auto-scaling', label: 'Auto Scaling group', parent: vid, x: 100, y: 300, w: 800, h: 150, members: asgMembers });
    }
    for (const [gi, key] of GLOBAL.slice(3).entries()) g.nodes.push({ id: `${rid}-m${gi}`, icon: key, label: key.split('_').pop(), parent: rid, x: R(20, 1500), y: R(1100, 1350) });
  }
  return g;
}

// ---- 어지럽히기: 같은 부모 안에서 자리를 마구 흔들고, 상자를 키우거나 겹치게 ------------------
function messify(g0, seed) {
  const g = JSON.parse(JSON.stringify(g0));
  const r = rng(seed);
  for (const x of g.groups) { if (!x.parent) continue; x.x = Math.round(x.x * (0.4 + r() * 1.4) + r() * 300); x.y = Math.round(x.y * (0.4 + r() * 1.4) + r() * 200); x.w = Math.round(x.w * (0.8 + r() * 0.8)); x.h = Math.round(x.h * (0.8 + r() * 0.8)); }
  for (const n of g.nodes) { n.x = Math.round(n.x + (r() - 0.5) * 300); n.y = Math.round(n.y + (r() - 0.5) * 200); }
  return g;
}

// ---- 지표 -------------------------------------------------------------------------------
const isBox = (n) => n.type === 'card' || n.type === 'text' || n.type === 'badge';
function metrics(g, why = false) {
  const R = absoluteRects(g);
  const hit = (a, b, m = 0) => a.x < b.x + b.w - m && b.x < a.x + a.w - m && a.y < b.y + b.h - m && b.y < a.y + a.h - m;
  const nb = (n) => { const q = R.get(n.id); return isBox(n) ? q : { x: q.x - half, y: q.y, w: LABEL_WIDTH, h: ICON_SIZE + LABEL_SPACE }; };
  let boxOv = 0, iconOv = 0, iconOnBox = 0, outside = 0;
  const parents = [null, ...g.groups.map((x) => x.id)];
  for (const p of parents) {
    const gs = g.groups.filter((x) => x.parent === p && !isOverlay(x));
    const ns = g.nodes.filter((n) => n.parent === p);
    for (let i = 0; i < gs.length; i++) for (let j = 0; j < i; j++) if (hit(R.get(gs[i].id), R.get(gs[j].id))) { boxOv++; if (why && process.env.WHY) console.log('  box overlap', p, gs[i].id, JSON.stringify(R.get(gs[i].id)), gs[j].id, JSON.stringify(R.get(gs[j].id))); }
    for (let i = 0; i < ns.length; i++) for (let j = 0; j < i; j++) if (hit(nb(ns[i]), nb(ns[j]), 4)) { iconOv++; if (why && process.env.WHY) console.log('  icon overlap', p, ns[i].id, JSON.stringify(nb(ns[i])), ns[j].id, JSON.stringify(nb(ns[j]))); }
    for (const n of ns) for (const x of gs) if (hit(nb(n), R.get(x.id), 4)) { iconOnBox++; if (why && process.env.WHY) console.log('  icon on box', p, n.id, n.type || '', JSON.stringify(nb(n)), x.id, x.kind, JSON.stringify(R.get(x.id))); }
  }
  for (const x of [...g.groups.filter((q) => !isOverlay(q)), ...g.nodes]) {
    if (!x.parent) continue;
    const q = 'kind' in x ? R.get(x.id) : nb(x), p = R.get(x.parent);
    if (q.x < p.x - 1 || q.y < p.y - 1 || q.x + q.w > p.x + p.w + 1 || q.y + q.h > p.y + p.h + 1) outside++;
  }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const q of R.values()) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x + q.w); y1 = Math.max(y1, q.y + q.h); }
  // 선 교차(중심 잇는 선분 근사)
  const c = (id) => { const q = R.get(id); return q && { x: q.x + q.w / 2, y: q.y + q.h / 2 }; };
  const seg = g.edges.map((e) => [c(e.source), c(e.target)]).filter(([a, b]) => a && b);
  const d = (a, b, q) => (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x);
  let cross = 0; for (let i = 0; i < seg.length; i++) for (let j = 0; j < i; j++) { const [p, q] = seg[i], [s, t] = seg[j]; if (d(p, q, s) * d(p, q, t) < 0 && d(s, t, p) * d(s, t, q) < 0) cross++; }
  return { boxOv, iconOv, iconOnBox, outside, w: Math.round(x1 - x0), h: Math.round(y1 - y0), cross };
}
const parentsOf = (g) => JSON.stringify([...g.groups, ...g.nodes].map((x) => [x.id, x.parent || null]).sort());
const pos = (g) => JSON.stringify([...g.groups.map((x) => [x.id, x.x, x.y, x.w, x.h]), ...g.nodes.map((n) => [n.id, n.x, n.y])]);
const ids = (g) => [...g.groups.map((x) => x.id), ...g.nodes.map((x) => x.id)];

// ---- 실행 --------------------------------------------------------------------------------
const cases = [];
if (args.length) for (const f of args) cases.push([path.basename(f), JSON.parse(fs.readFileSync(f, 'utf8'))]);
else {
  cases.push(['합성 S (1리전·1VPC·2AZ)', synth('S', { seed: 3 })]);
  cases.push(['합성 M (1리전·2VPC·3AZ)', synth('M', { vpcs: 2, azs: 3, seed: 7 })]);
  cases.push(['합성 L (2리전·2VPC·3AZ·3개씩)', synth('L', { regions: 2, vpcs: 2, azs: 3, perSub: 3, seed: 11 })]);
  cases.push(['합성 XL (3리전·3VPC·3AZ·4개씩)', synth('XL', { regions: 3, vpcs: 3, azs: 3, perSub: 4, seed: 19 })]);
  for (const f of fs.readdirSync(path.join(root, 'templates')).filter((x) => x.endsWith('.json'))) cases.push([f.replace('.json', ''), JSON.parse(fs.readFileSync(path.join(root, 'templates', f), 'utf8'))]);
  const nacs = path.join(root, '_dev', 'nacs_orig.json');
  if (fs.existsSync(nacs)) cases.push(['NACS (실제 46개)', JSON.parse(fs.readFileSync(nacs, 'utf8'))]);
}

// --save <이름> : 그 케이스의 어지럽힌 그림(전)과 정렬한 그림(후)을 _dev/stress_<이름>_{before,after}.json 으로
const SAVE = process.argv.includes('--save') ? process.argv[process.argv.indexOf('--save') + 1] : null;
if (SAVE) {
  const c = cases.find(([n]) => n.startsWith(SAVE));
  if (c) {
    const g = normalizeGraph(messify(c[1], 101));
    fs.writeFileSync(path.join(root, '_dev', `stress_${SAVE}_before.json`), JSON.stringify(g));
    autoArrange(g, ids(g), isOverlay);
    fs.writeFileSync(path.join(root, '_dev', `stress_${SAVE}_after.json`), JSON.stringify(g));
    console.log('saved', SAVE);
  }
}
const rows = [];
let fails = 0;
for (const [name, raw] of cases) {
  for (const [variant, seed] of [['원본', 0], ['어지럽힘1', 101], ['어지럽힘2', 202]]) {
    let g = normalizeGraph(seed ? messify(raw, seed) : raw);
    const before = metrics(g), par0 = parentsOf(g);
    const t0 = performance.now();
    autoArrange(g, ids(g), isOverlay);
    const ms = performance.now() - t0;
    if (process.env.WHY) console.log('##', name, variant);
    const after = metrics(g, true);
    const once = pos(g);
    autoArrange(g, ids(g), isOverlay);
    const stable = pos(g) === once;
    const parentOk = parentsOf(g) === par0;
    const bad = after.boxOv + after.iconOv + after.iconOnBox + after.outside > 0 || !parentOk;
    if (bad) fails++;
    rows.push({ name, variant, n: g.nodes.length, gr: g.groups.length, before, after, ms, stable, parentOk, bad });
    if (DUMP && bad) fs.writeFileSync(path.join(root, '_dev', `stress_${name.replace(/[^A-Za-z0-9가-힣]+/g, '_')}_${variant}.json`), JSON.stringify(seed ? messify(raw, seed) : raw));
  }
}
const f = (m) => `${String(m.w).padStart(5)}×${String(m.h).padEnd(5)} 상자겹침${m.boxOv} 아이콘겹침${m.iconOv} 아이콘·상자${m.iconOnBox} 밖${m.outside} 교차${m.cross}`;
for (const r of rows) console.log(`${r.bad ? '✗' : '✓'} ${r.name.padEnd(30)} ${r.variant.padEnd(6)} 아이콘${String(r.n).padStart(4)} 상자${String(r.gr).padStart(3)} | 전: ${f(r.before)} | 후: ${f(r.after)} | ${r.ms.toFixed(0)}ms ${r.stable ? '멱등' : '두번째에 또 바뀜'}${r.parentOk ? '' : ' 소속바뀜!'}`);
console.log(`\n${rows.length}건 중 문제 ${fails}건 · 두 번째 실행에 또 바뀐 것 ${rows.filter((r) => !r.stable).length}건 · 가장 느린 것 ${Math.max(...rows.map((r) => r.ms)).toFixed(0)}ms`);

// 개요도도 함께: 합성 그림에서 겹침 없이 만들어지는지
if (!args.length) {
  for (const [name, raw] of cases.filter(([n]) => n.startsWith('합성') || n.startsWith('NACS'))) {
    const { graph, notes } = compactGraph(normalizeGraph(raw));
    const m = metrics(normalizeGraph(graph));
    console.log(`개요도 ${name.padEnd(30)} ${f(m)} | ${notes.slice(0, 4).join(' · ')}`);
  }
}
process.exitCode = fails ? 1 : 0;
