// 그래프 JSON(템플릿/저장 파일) -> PowerPoint 장면 JSON. 호스트 EXE 의 --scene 모드로 COM 검증할 때 쓴다.
// 사용: node tools/graph_to_scene.mjs <graph.json> <scene.json> [id,id,...(선택 복사)]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeGraph } from '../src/model/schema.js';
import { graphToScene, sceneStats, selectionIds } from '../src/export/scene.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , inFile, outFile, sel] = process.argv;
if (!inFile || !outFile) { console.error('사용: node tools/graph_to_scene.mjs <graph.json> <scene.json> [id,id]'); process.exit(2); }
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/icons.json'), 'utf8'));
const catalog = { icons: new Map(data.icons.map((i) => [i.key, i])), kinds: new Map(data.groupKinds.map((k) => [k.id, k])) };
const g = normalizeGraph(JSON.parse(fs.readFileSync(inFile, 'utf8')));
const include = sel ? selectionIds(g, new Set(sel.split(','))) : null;
const scene = graphToScene(g, catalog, include);
fs.writeFileSync(outFile, JSON.stringify(scene));
console.log(JSON.stringify({ ...sceneStats(scene), media: Object.keys(scene.media).length, cm: [(scene.width / 360000).toFixed(2), (scene.height / 360000).toFixed(2)] }));
