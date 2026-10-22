// 프롬프트 한 줄로 빈 캔버스에 그리기가 되는지 실제 claude CLI 로 본다 (EXE 없이, 앱과 같은 프롬프트/패치 경로).
// 사용: node tools/draw_cli.mjs "요청 문장" [out.json]   → _dev/draw_cli.json 에 그래프, 콘솔에 ops/lint
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyGraph } from '../src/model/schema.js';
import { applyPatch } from '../src/model/patch.js';
import { lint } from '../src/model/rules.js';
import { buildDrawMessages, parseJsonReply } from '../src/ai/prompts.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const replay = process.argv[2] === '--replay' ? JSON.parse(fs.readFileSync(path.join(root, '_dev', 'draw_cli.json'), 'utf8'))._ops : null;
const request = (replay ? null : process.argv[2]) || '서울 리전에 VPC 하나, AZ 두 개. 각 AZ 에 퍼블릭/프라이빗 서브넷. ALB 뒤에 EC2 2대(오토스케일링), RDS 는 멀티 AZ. 정적 파일은 S3 + CloudFront, 앞에 WAF, DNS 는 Route 53.';
const out = process.argv[3] || path.join(root, '_dev', 'draw_cli.json');

const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'icons.json'), 'utf8'));
const SECTION = { id: 'section', name: '섹션', icon: null, color: '#2DD4BF', line: 'solid', fill: null, text: '#2DD4BF', colorSource: 'theme' };
data.groupKinds = [...data.groupKinds, SECTION];
const icons = new Map(data.icons.map((i) => [i.key, i]));
const kinds = new Map(data.groupKinds.map((k) => [k.id, k]));
const catalog = { icons, kinds, list: data.icons, groupKinds: data.groupKinds, check: { iconKeys: new Set(icons.keys()), groupKinds: new Set(kinds.keys()) } };

const graph = emptyGraph('프롬프트 테스트');
graph.context = { title: '중견 커머스 웹 플랫폼 AWS 이전', requirements: '- 동시 접속 5천, 피크 2배\n- 서울 리전, 가용성 99.9%\n- 개인정보는 프라이빗 서브넷에서만', constraints: '예산 상한 월 500만원' };
const { system, user } = buildDrawMessages(graph, catalog, request, lint(graph));
const prompt = `<system>\n${system}\n</system>\n\n${user}`;

console.log('요청:', request);
console.log('프롬프트 길이:', prompt.length, '자');
const t0 = Date.now();
let j, ms = 0;
if (replay) { j = { ops: replay, summary: '(재적용)' }; } else {
const env = { ...process.env }; for (const k of Object.keys(env)) if (/^CLAUDE/.test(k)) delete env[k];
const bin = process.platform === 'win32' ? 'claude.cmd' : 'claude';
const p = spawn(bin, ['-p', '--output-format', 'json'], { env, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
let outBuf = '', errBuf = '';
p.stdout.on('data', (d) => (outBuf += d));
p.stderr.on('data', (d) => (errBuf += d));
p.stdin.end(Buffer.from(prompt, 'utf8'));
const code = await new Promise((r) => p.on('close', r));
ms = Date.now() - t0;
if (code !== 0) { console.error('claude 종료 코드', code, errBuf.slice(0, 500)); process.exit(1); }
let text = outBuf;
try { const j = JSON.parse(outBuf); text = j.result ?? j.content ?? outBuf; } catch { /* 그대로 */ }
j = parseJsonReply(text);
}
const ops = Array.isArray(j.ops) ? j.ops : [];
console.log(`응답 ${ms}ms · ops ${ops.length}개 · 요약: ${j.summary || '(없음)'}`);
for (const op of ops) console.log('  ', JSON.stringify(op));
const r = applyPatch(graph, ops, catalog.check);
console.log('적용:', r.applied, '오류:', r.errors.map((e) => e.message));
const v = lint(r.graph);
console.log(`결과: 그룹 ${r.graph.groups.length}, 노드 ${r.graph.nodes.length}, 선 ${r.graph.edges.length} · 규칙 위반 ${v.length}건`, v.map((x) => `${x.severity}:${x.rule}@${x.target}`));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ ...r.graph, _ops: ops, _summary: j.summary, _ms: ms }, null, 2));
console.log('저장:', out);
