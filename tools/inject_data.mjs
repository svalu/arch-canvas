// vite build 뒤에 dist/index.html 에 아이콘 데이터를 <script id="icons" type="application/json"> 로 심는다.
// (개발 서버에서는 src/catalog.js 가 data/icons.json 을 fetch 한다.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = path.join(root, 'dist', 'index.html');
let t = fs.readFileSync(html, 'utf8');
if (t.includes('id="icons"')) throw new Error('이미 데이터가 들어 있어: ' + html);
const json = fs.readFileSync(path.join(root, 'data', 'icons.json'), 'utf8').replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');
t = t.replace('</body>', `<script id="icons" type="application/json">${json}</script></body>`);
fs.writeFileSync(html, t);
console.log('dist/index.html', (fs.statSync(html).size / 1024 / 1024).toFixed(2), 'MB');
