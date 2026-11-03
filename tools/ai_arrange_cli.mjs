// AI 정렬을 앱 없이 재현: 그래프 → 배치안 프롬프트 → claude CLI → columns → autoArrange(plan). 배치안이 그래프 id 와 맞는지, 자리가 바뀌는지 본다.
// 사용: node tools/ai_arrange_cli.mjs <graph.json> [out.json] [--reply reply.txt(이미 받은 답을 다시 적용)]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeGraph } from '../src/model/schema.js';
import { buildArrangeMessages, parseJsonReply } from '../src/ai/prompts.js';
import { autoArrange, absoluteRects, lineCrossings } from '../src/model/geometry.js';
import { LABEL_DROP } from '../src/model/schema.js';
import { isOverlay } from '../src/model/contain.js';
import { applyPatch, alignParentsToPlan } from '../src/model/patch.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const replyAt = args.indexOf('--reply');
const replyFile = replyAt >= 0 ? args.splice(replyAt, 2)[1] : null;
const [inFile, outFile] = args;
if (!inFile) { console.error('사용: node tools/ai_arrange_cli.mjs <graph.json> [out.json] [--reply reply.txt]'); process.exit(2); }
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/icons.json'), 'utf8'));
const catalog = { icons: new Map(data.icons.map((i) => [i.key, i])), kinds: new Map(data.groupKinds.map((k) => [k.id, k])) };
const g = normalizeGraph(JSON.parse(fs.readFileSync(inFile, 'utf8')));
const { system, user } = buildArrangeMessages(g, catalog);

let text;
if (replyFile) text = fs.readFileSync(replyFile, 'utf8');
else {
  const sysFile = path.join(os.tmpdir(), 'arch_arrange_sys.txt');
  fs.writeFileSync(sysFile, system);
  const t0 = Date.now();
  const r = spawnSync('claude', ['-p', '--output-format', 'json', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--system-prompt-file', sysFile], { input: user, encoding: 'utf8', shell: true, maxBuffer: 64 << 20, timeout: 240000 });
  console.log(`claude: exit ${r.status} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (r.status !== 0) { console.error(r.stderr.slice(0, 2000)); process.exit(1); }
  const j = JSON.parse(r.stdout);
  text = j.result || '';
  fs.writeFileSync(path.join(os.tmpdir(), 'arch_arrange_reply.txt'), text);
  console.log('reply saved:', path.join(os.tmpdir(), 'arch_arrange_reply.txt'));
}
const j = parseJsonReply(text);
console.log('summary:', j.summary);
const plan = j.rows && typeof j.rows === 'object' ? Object.fromEntries(Object.entries(j.rows).map(([k, v]) => [k, { rows: v }])) : j.columns && typeof j.columns === 'object' ? j.columns : {};
let g2 = g;
if (Array.isArray(j.ops) && j.ops.length) { const had = new Set(g.groups.map((x) => x.id)); const r = applyPatch(g, j.ops, null); g2 = r.graph; const fixed = alignParentsToPlan(g2, plan, new Set(g2.groups.map((x) => x.id).filter((id) => !had.has(id)))); console.log(`ops ${j.ops.length}: applied ${r.applied}${r.errors.length ? ' · errors ' + JSON.stringify(r.errors).slice(0, 300) : ''} · 부모 보정 ${fixed}`); }
const known = new Set([...g2.groups.map((x) => x.id), ...g2.nodes.map((x) => x.id)]);
const childrenOf = (pid) => [...g2.groups.filter((x) => (x.parent ?? null) === pid && !isOverlay(x)), ...g2.nodes.filter((n) => (n.parent ?? null) === pid && n.type !== 'badge')].map((x) => x.id);
for (const k of Object.keys(plan)) {
  const pid = k === 'root' ? null : k;
  const ok = k === 'root' || known.has(k);
  const kids = new Set(childrenOf(pid));
  const lists = Array.isArray(plan[k]) ? plan[k] : plan[k]?.rows || [];
  const ids = lists.flat().map(String);
  const hit = ids.filter((id) => kids.has(id)), miss = ids.filter((id) => !kids.has(id));
  console.log(`${ok ? '✓' : '✗'} ${k}: ${plan[k]?.rows ? '행' : '단'} ${lists.length} · 자식 ${kids.size} 중 ${hit.length} 맞음${miss.length ? ' · 자식 아님: ' + miss.join(',') : ''}${kids.size - hit.length ? ' · 빠짐: ' + [...kids].filter((id) => !hit.includes(id)).join(',') : ''}`);
}
const before = absoluteRects(g2);
const ids = [...g2.groups.map((x) => x.id), ...g2.nodes.map((x) => x.id)];
autoArrange(g2, ids, isOverlay, new Set([...g2.groups, ...g2.nodes].filter((x) => x.locked).map((x) => x.id)), { plan });
const after = absoluteRects(g2);
let moved = 0;
for (const [id, r] of after) { const b = before.get(id); if (b && (Math.abs(b.x - r.x) > 1 || Math.abs(b.y - r.y) > 1)) moved++; }
console.log(`moved ${moved} / ${after.size}`);
{ const rs = [...after.values()]; const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h)); console.log(`bbox ${Math.round(x1 - x0)}×${Math.round(y1 - y0)} aspect ${((x1 - x0) / (y1 - y0)).toFixed(2)}`); }
{ const lab = new Set(g2.nodes.filter((n) => n.type !== 'card' && n.type !== 'text' && n.type !== 'badge' && n.label).map((n) => n.id)); const cr = lineCrossings(g2, (id) => (lab.has(id) ? LABEL_DROP : 0)); console.log(`crossings ${cr.length}` + (cr.length ? ': ' + cr.slice(0, 8).map((c) => `${c.source}→${c.target} via ${c.through.join('/')}`).join(' | ') : '')); }
console.log('top-level order:', g2.groups.filter((x) => !x.parent && !isOverlay(x)).sort((a, b) => a.x - b.x).map((x) => `${x.id}@${x.x}`).join(' '));
if (outFile) fs.writeFileSync(outFile, JSON.stringify(g2, null, 1));
