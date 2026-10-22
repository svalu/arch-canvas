// 템플릿 JSON 이 스키마/아이콘/그룹 종류와 맞는지 확인하고, 장면 변환이 돌아가는지 본다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeGraph } from '../src/model/schema.js';
import { applyPatch } from '../src/model/patch.js';
import { graphToScene, sceneStats, selectionIds } from '../src/export/scene.js';
import { lint, RULES } from '../src/model/rules.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/icons.json'), 'utf8'));
const catalog = {
  icons: new Map(data.icons.map((i) => [i.key, i])),
  kinds: new Map(data.groupKinds.map((k) => [k.id, k])),
};
const checkCat = { iconKeys: new Set(catalog.icons.keys()), groupKinds: new Set([...catalog.kinds.keys(), 'section']) };   // section 은 앱이 카탈로그에 덧붙이는 카드 모드용 종류

let bad = 0;
for (const f of fs.readdirSync(path.join(root, 'templates')).filter((x) => x.endsWith('.json')).sort()) {
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'templates', f), 'utf8'));
  const g = normalizeGraph(raw);
  const problems = [];
  if (g.groups.length !== (raw.groups || []).length) problems.push('그룹이 정리 중에 빠짐');
  if (g.edges.length !== (raw.edges || []).length) problems.push('엣지 참조가 깨짐');
  // 카드·글상자·번호는 아이콘이 없어도 된다(카드는 아이콘이 있으면 그 키만 확인)
  for (const n of g.nodes) { if (['card', 'text', 'badge'].includes(n.type) && !n.icon) continue; if (!checkCat.iconKeys.has(n.icon)) problems.push('아이콘 없음: ' + n.icon); }
  for (const x of g.groups) if (!checkCat.groupKinds.has(x.kind)) problems.push('그룹 종류 없음: ' + x.kind);
  const scene = graphToScene(g, catalog);
  const st = sceneStats(scene);
  const v = lint(g);
  if (v.length) problems.push('규칙 위반: ' + v.map((x) => `${x.rule}@${x.target}`).join(', '));
  console.log(`${f}: 그룹 ${g.groups.length} 노드 ${g.nodes.length} 엣지 ${g.edges.length} -> 장면 ${JSON.stringify(st)} ${(scene.width / 360000).toFixed(1)}x${(scene.height / 360000).toFixed(1)}cm ${problems.join('; ')}`);
  if (problems.length) bad++;
}

// 규칙 자체 테스트: 일부러 틀린 그래프
const wrong = JSON.parse(fs.readFileSync(path.join(root, 'templates/02_three_tier_web.json'), 'utf8'));
wrong.nodes.find((n) => n.id === 'rds-primary').parent = 'pub-a';                              // DB 를 Public subnet 에
wrong.nodes.push({ id: 'igw2', icon: 'Res_Amazon-VPC_Internet-Gateway', label: 'IGW 2', parent: 'vpc', x: 600, y: 30 }); // IGW 두 개
wrong.nodes.push({ id: 'fn', icon: 'Arch_AWS-Lambda', label: 'Lambda', parent: null, x: 40, y: 400 });
wrong.edges.push({ id: 'bad1', source: 'fn', target: 'rds-standby' });                           // Lambda → RDS 직접
wrong.edges.push({ id: 'bad2', source: 'users', target: 'web-a' });                              // 사용자 → Private 자원
wrong.edges.push({ id: 'bad3', source: 'vpc', target: 'alb' });                                  // 그룹 → 자기 안
const found = lint(normalizeGraph(wrong));
console.log(`rules: ${RULES.length}개 규칙, 일부러 틀린 그래프에서 ${found.length}건 ->`, found.map((x) => `${x.severity}:${x.rule}@${x.target}`).join(' '));
const need = ['db-in-public-subnet@rds-primary', 'igw-one-per-vpc@igw2', 'lambda-to-rds-direct@bad1', 'users-direct-to-private@bad2', 'edge-group-to-self-child@bad3'];
const missing = need.filter((k) => !found.some((x) => x.rule + '@' + x.target === k));
if (missing.length) { console.error('기대한 위반이 안 잡힘:', missing); bad++; }

// applyPatch 한 바퀴
const base = JSON.parse(fs.readFileSync(path.join(root, 'templates/02_three_tier_web.json'), 'utf8'));
const r = applyPatch(base, [
  { op: 'add_node', id: 'cache', icon: 'Arch_Amazon-ElastiCache', label: 'ElastiCache', parent: 'app-a' },
  { op: 'connect', source: 'web-a', target: 'cache' },
  { op: 'move_into', id: 'cache', parent: 'app-b' },
  { op: 'annotate', target: 'alb', level: 'warn', message: 'WAF 없음' },
  { op: 'add_node', icon: '없는-아이콘' },
  { op: 'remove', id: 'az-b' },
], checkCat);
console.log('patch:', r.applied, '적용,', r.errors.length, '실패', r.errors.map((e) => e.message));
const after = r.graph;
console.log('  cache parent =', after.nodes.find((n) => n.id === 'cache')?.parent, '/ az-b 삭제 후 그룹', after.groups.length, '엣지', after.edges.length, '핀', after.annotations.length);
const sel = selectionIds(after, new Set(['az-a']));
console.log('  az-a 선택 복사 ->', sel.size, '개 id, 장면', JSON.stringify(sceneStats(graphToScene(after, catalog, sel))));
if (bad) process.exit(1);
