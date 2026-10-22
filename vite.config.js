import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'node:fs';
import path from 'node:path';

// 개발 서버 전용: POST /__dev/save?name=x.png 로 보낸 내용을 _dev/ 에 저장 (브라우저 자동화 테스트에서 내보내기 결과를 꺼내 보려고)
const devSave = {
  name: 'dev-save',
  configureServer(server) {
    server.middlewares.use('/__dev/save', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
      const name = path.basename(new URL(req.url, 'http://x').searchParams.get('name') || 'out.bin');
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const dir = path.resolve('_dev');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks));
        res.end('saved ' + name);
      });
    });
  },
};

// 빌드 결과는 dist/index.html 한 파일. 아이콘 데이터는 tools/inject_data.mjs 가 빌드 뒤에 <script id="icons"> 로 넣는다.
export default defineConfig({
  plugins: [react(), viteSingleFile(), devSave],
  base: './',
  build: { outDir: 'dist', target: 'es2020', chunkSizeWarningLimit: 4000 },
  server: { port: 5178, strictPort: true },
});
