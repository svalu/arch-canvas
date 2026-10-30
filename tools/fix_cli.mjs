// "물어보기 → 이 답변대로 그림 고치기 → 적용(+자동 정렬)" 을 실제 claude CLI 로 끝까지 돌려 본다. 앱과 같은 프롬프트·패치 경로.
// 사용: node tools/fix_cli.mjs <그래프.json> ["질문"]   → _dev/fix_cli.json (결과 그래프), 콘솔에 지표
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeGraph } from '../src/model/schema.js';
import { applyPatch } from '../src/model/patch.js';
import { lint } from '../src/model/rules.js';
import { absoluteRects, autoArrange } from '../src/model/geometry.js';
import { isOverlay } from '../src/model/contain.js';
import { buildAskMessages, buildDrawMessages, parseJsonReply, fixFromAnswer } from '../src/ai/prompts.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2];
const question = process.argv[3] || '정렬한 다음에 더 잘 보이게 그려 주세요. 선이 엉켜 보여요.';
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'icons.json'), 'utf8'));
const SECTION = { id: 'section', name: '섹션', icon: null, color: '#2DD4BF', line: 'solid', fill: null, text: '#2DD4BF', colorSource: 'theme' };
data.groupKinds = [...data.groupKinds, SECTION];
const icons = new Map(data.icons.map((i) => [i.key, i]));
const kinds = new Map(data.groupKinds.map((k) => [k.id, k]));
const catalog = { icons, kinds, list: data.icons, groupKinds: data.groupKinds, check: { iconKeys: new Set(icons.keys()), groupKinds: new Set(kinds.keys()) } };

async function claude({ system, user }) {
  const env = { ...process.env }; for (const k of Object.keys(env)) if (/^CLAUDE/.test(k)) delete env[k];
  const p = spawn(process.platform === 'win32' ? 'claude.cmd' : 'claude', ['-p', '--output-format', 'json'], { env, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
  p.stdin.end(Buffer.from(`<system>\n${system}\n</system>\n\n${user}`, 'utf8'));
  const code = await new Promise((r) => p.on('close', r));
  if (code !== 0) throw new Error('claude 종료 코드 ' + code + ' ' + err.slice(0, 300));
  try { const j = JSON.parse(out); return String(j.result ?? out); } catch { return out; }
}

// 지표: 전체 크기, 형제 상자 겹침, 선 교차 수(선분 단순 근사), 선 길이 합
function metrics(g) {
  const R = absoluteRects(g);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const r of R.values()) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  let overlaps = 0;
  for (const p of [null, ...g.groups.map((x) => x.id)]) {
    const L = g.groups.filter((x) => x.parent === p && !isOverlay(x)).map((x) => R.get(x.id));
    for (let i = 0; i < L.length; i++) for (let j = 0; j < i; j++) { const a = L[i], b = L[j]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps++; }
  }
  const c = (id) => { const r = R.get(id); return r && { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };
  const segs = g.edges.map((e) => [c(e.source), c(e.target), e]).filter(([a, b]) => a && b);
  const cross = (p, q, r, s) => { const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); return d(p, q, r) * d(p, q, s) < 0 && d(r, s, p) * d(r, s, q) < 0; };
  let crossings = 0, len = 0;
  for (let i = 0; i < segs.length; i++) { len += Math.hypot(segs[i][1].x - segs[i][0].x, segs[i][1].y - segs[i][0].y); for (let j = 0; j < i; j++) if (cross(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) crossings++; }
  return `${Math.round(x1 - x0)}×${Math.round(y1 - y0)} · 상자 겹침 ${overlaps} · 선 교차 ${crossings} · 선 길이 ${Math.round(len)}`;
}

const g0 = normalizeGraph(JSON.parse(fs.readFileSync(file, 'utf8')));
const q = `선택한 요소: 전체 (${g0.groups.length + g0.nodes.length}개)\n${question}`;
console.log('원본:', metrics(g0), '· 노드', g0.nodes.length, '선', g0.edges.length);

let t0 = Date.now();
const askRaw = await claude(buildAskMessages(g0, catalog, q, lint(g0), []));
let ask; try { ask = parseJsonReply(askRaw); } catch { ask = { answer: askRaw }; }
const answer = String(ask.answer || ask.summary || '').trim();
console.log(`\n[물어보기] ${((Date.now() - t0) / 1000).toFixed(0)}s · 되묻기 ${(ask.questions || []).length}개`);
console.log(answer.slice(0, 1500) || '(답 없음: ' + JSON.stringify(ask.questions || []).slice(0, 300) + ')');
if (!answer) process.exit(2);

t0 = Date.now();
const drawRaw = await claude(buildDrawMessages(g0, catalog, fixFromAnswer(q, answer), lint(g0)));
const j = parseJsonReply(drawRaw);
const ops = Array.isArray(j.ops) ? j.ops : [];
const kinds2 = {}; for (const o of ops) kinds2[o.op] = (kinds2[o.op] || 0) + 1;
console.log(`\n[고치기] ${((Date.now() - t0) / 1000).toFixed(0)}s · ops ${ops.length}`, kinds2, '·', j.summary || '');
const r = applyPatch(g0, ops, catalog.check);
console.log('적용', r.applied, '· 오류', r.errors.length, r.errors.slice(0, 5).map((e) => e.message));
console.log('적용 직후:', metrics(r.graph), '· 노드', r.graph.nodes.length, '선', r.graph.edges.length);
autoArrange(r.graph, [...r.graph.groups.map((x) => x.id), ...r.graph.nodes.map((x) => x.id)], isOverlay);
console.log('자동 정렬 뒤:', metrics(r.graph));
const v = lint(r.graph);
console.log('규칙 위반', v.length, v.map((x) => `${x.severity}:${x.rule}`).slice(0, 8));
fs.writeFileSync(path.join(root, '_dev', 'fix_cli.json'), JSON.stringify({ ...r.graph, _ops: ops, _answer: answer }, null, 1));
