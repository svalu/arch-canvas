// 모든 템플릿에 개요도 만들기를 돌려 무엇이 얼마나 줄었는지 본다. 사용: node tools/compact_cli.mjs [템플릿 id]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeGraph } from '../src/model/schema.js';
import { compactGraph } from '../src/model/compact.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'templates');
const only = process.argv[2];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  if (only && !f.includes(only)) continue;
  const g = normalizeGraph(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const { graph, notes, before, after } = compactGraph(g);
  normalizeGraph(graph);   // 깨진 참조가 없는지
  const W = Math.max(...graph.groups.filter((x) => !x.parent).map((x) => x.x + x.w), 0);
  const H = Math.max(...graph.groups.filter((x) => !x.parent).map((x) => x.y + x.h), 0);
  console.log(`${f.padEnd(36)} 그룹 ${before.groups}→${after.groups}  아이콘 ${before.nodes}→${after.nodes}  선 ${before.edges}→${after.edges}  ${Math.round(W)}×${Math.round(H)}  | ${notes.join(' · ')}`);
  if (only) fs.writeFileSync(path.join(root, '_dev', 'compact_cli.json'), JSON.stringify(graph, null, 2));
}
