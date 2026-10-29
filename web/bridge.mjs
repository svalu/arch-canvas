#!/usr/bin/env node
// Arch Canvas 로컬 다리(브리지). 웹 버전이 내 PC 의 claude / codex 명령으로 AI 를 쓸 수 있게 이어 준다.
//
// 쓰는 법:  node bridge.mjs            (Node 18 이상, 의존성 없음)
//   1. 이 창에 뜬 6자리 연결 코드를 웹 버전 [AI 연결] 창에 넣는다.
//   2. 웹을 쓰는 동안 이 창을 켜 둔다. 끝나면 Ctrl+C.
//
// 안전장치
//   - 127.0.0.1 에서만 연다(다른 PC 는 못 들어온다).
//   - Arch Canvas 웹 주소에서 온 요청만 받는다(다른 사이트가 내 구독을 못 쓴다). 더 허용하려면 --origin https://주소
//   - 연결 코드로 짝을 맺은 화면만 실행할 수 있다. 코드를 5번 틀리면 새 코드가 나온다.
//   - CLI 는 매번 빈 임시 폴더에서, 도구 없이(claude) / 읽기 전용으로(codex) 답만 하고 끝난다. 폴더는 바로 지운다.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const VERSION = '1.0.0';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('--port', 47821));
const ORIGINS = new Set(['https://svalu.github.io', 'http://localhost:5178', 'http://127.0.0.1:5178', ...(process.argv.flatMap((v, i, a) => (v === '--origin' ? [a[i + 1]] : [])))]);
const WIN = process.platform === 'win32';
const SAFE_MODEL = /^[A-Za-z0-9._:[\]-]{0,64}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/;

let code = newCode(), tries = 0;
const tokens = new Set();
const running = new Map();

function newCode() { return String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }
function showCode() {
  console.log('');
  console.log('  ┌──────────────────────────────────────────┐');
  console.log(`  │  Arch Canvas 연결 코드:  ${code.slice(0, 3)} ${code.slice(3)}           │`);
  console.log('  └──────────────────────────────────────────┘');
  console.log('  웹 버전 [AI 연결] 창에 이 코드를 넣으세요. 이 창은 켜 둔 채로 쓰세요.\n');
}

// ---- CLI 찾기·확인 ------------------------------------------------------------------------
function which(name) {
  const exts = WIN ? ['.cmd', '.exe', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const e of exts) { const f = path.join(dir, name + e); try { if (fs.statSync(f).isFile()) return f; } catch { /* 없음 */ } }
  }
  if (WIN) { const f = path.join(process.env.APPDATA || '', 'npm', name + '.cmd'); if (fs.existsSync(f)) return f; }
  return null;
}
const q = (s) => (WIN ? `"${String(s).replace(/"/g, '')}"` : s);
function run1(exe, args) {
  const r = spawnSync(WIN ? `${q(exe)} ${args.join(' ')}` : exe, WIN ? [] : args, { shell: WIN, encoding: 'utf8', timeout: 15000, env: cleanEnv() });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}
function cleanEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^CLAUDE/i.test(k)) delete e[k]; return e; }
// 버전·로그인 확인은 몇 초 걸려서 30초 동안 기억해 둔다
let cache = null, cacheAt = 0;
function detect(fresh = false) {
  if (!fresh && cache && Date.now() - cacheAt < 30000) return cache;
  const out = {};
  for (const t of ['claude', 'codex']) {
    const exe = which(t);
    if (!exe) { out[t] = { found: false, reason: `PATH 에 ${t} 가 없습니다` }; continue; }
    const v = run1(exe, ['--version']);
    out[t] = { found: true, version: v.out.split('\n')[0] };
    if (t === 'codex') { const s = run1(exe, ['login', 'status']); out[t].loggedIn = s.code === 0; out[t].login = s.out.split('\n')[0]; }
  }
  cache = out; cacheAt = Date.now();
  return out;
}

// ---- 실행 --------------------------------------------------------------------------------
function runCli({ runId, tool, system = '', user = '', model = '', timeoutMs = 240000 }) {
  return new Promise((resolve, reject) => {
    const codex = tool === 'codex';
    const exe = which(codex ? 'codex' : 'claude');
    if (!exe) return reject(new Error(`${codex ? 'codex' : 'claude'} 명령을 찾지 못했습니다 (not found)`));
    if (!SAFE_MODEL.test(model)) return reject(new Error('모델 이름에 쓸 수 없는 글자가 있습니다'));
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-bridge-'));
    const last = path.join(work, 'last.txt');
    let args, input = user;
    if (codex) {
      args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', ...(model ? ['-m', model] : []), '-o', q(last), '-'];
      if (system) input = `<지시>\n${system}\n</지시>\n\n${user}`;
    } else {
      args = ['-p', '--output-format', 'json', '--tools', WIN ? '""' : '', '--strict-mcp-config', '--setting-sources', WIN ? '""' : '', '--disable-slash-commands', '--no-session-persistence', ...(model ? ['--model', model] : [])];
      if (system) { const f = path.join(work, 'system.txt'); fs.writeFileSync(f, system, 'utf8'); args.push('--system-prompt-file', q(f)); }
    }
    const child = spawn(WIN ? `${q(exe)} ${args.join(' ')}` : exe, WIN ? [] : args, { shell: WIN, cwd: work, env: cleanEnv(), windowsHide: true });
    let out = '', err = '', done = false;
    const finish = (fn) => { if (done) return; done = true; clearTimeout(timer); running.delete(runId); try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* */ } fn(); };
    const kill = () => { try { if (WIN) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']); else child.kill('SIGTERM'); } catch { /* */ } };
    const timer = setTimeout(() => { kill(); finish(() => reject(new Error(`응답이 너무 오래 걸려 중단했습니다 (${Math.round(timeoutMs / 1000)}초)`))); }, timeoutMs);
    running.set(runId, () => { kill(); finish(() => reject(new Error('취소했습니다 (cancel)'))); });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish(() => reject(new Error(`실행하지 못했습니다: ${e.message}`))));
    child.on('close', (status) => finish(() => {
      if (codex) {
        let text = ''; try { text = fs.readFileSync(last, 'utf8').trim(); } catch { /* */ }
        text = text || out.trim();
        if (!text) return reject(new Error(`codex 가 오류로 끝났습니다 (exit ${status}): ${err.trim().split('\n').pop()}`));
        return resolve({ text, stderr: err });
      }
      if (status !== 0 && !out.trim()) return reject(new Error(`claude 가 오류로 끝났습니다 (exit ${status}): ${err.trim().split('\n')[0]}`));
      try {
        const j = JSON.parse(out.trim());
        if (j.is_error) return reject(new Error(`claude 오류: ${String(j.result).split('\n')[0]}`));
        return resolve({ text: String(j.result ?? ''), stderr: err });
      } catch { return resolve({ text: out.trim(), stderr: err }); }
    }));
    child.stdin.end(input, 'utf8');
  });
}

// ---- HTTP -------------------------------------------------------------------------------
function send(res, status, body, origin) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const parts = [];
    req.on('data', (c) => { n += c.length; if (n > 4 * 1024 * 1024) { reject(new Error('너무 큽니다')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { reject(new Error('JSON 이 아닙니다')); } });
  });
}
const sameToken = (a) => { if (!a) return false; for (const t of tokens) if (t.length === a.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(a))) return true; return false; };

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const host = String(req.headers.host || '');
  // DNS 리바인딩 막기: 주소창 호스트가 127.0.0.1/localhost 일 때만
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(res, 403, { error: 'host' });
  if (!ORIGINS.has(origin)) return send(res, 403, { error: '허용되지 않은 주소에서 온 요청입니다', origin });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin, Vary: 'Origin',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Private-Network': 'true',
      'Access-Control-Max-Age': '600',
    });
    return res.end();
  }
  const url = new URL(req.url, `http://${host}`);
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { app: 'arch-canvas-bridge', version: VERSION, paired: sameToken(auth), ...(sameToken(auth) ? detect() : {}) }, origin);
    }
    if (req.method === 'POST' && url.pathname === '/pair') {
      const b = await readBody(req);
      if (String(b.code || '').replace(/\D/g, '') !== code) {
        if (++tries >= 5) { code = newCode(); tries = 0; console.log('  연결 코드를 5번 틀려서 새 코드를 만들었습니다.'); showCode(); }
        return send(res, 401, { error: '연결 코드가 맞지 않습니다' }, origin);
      }
      const t = crypto.randomBytes(24).toString('hex'); tokens.add(t); tries = 0;
      console.log(`  연결됨: ${origin}  (${new Date().toLocaleTimeString()})`);
      return send(res, 200, { token: t, ...detect(true) }, origin);
    }
    if (!sameToken(auth)) return send(res, 401, { error: '연결 코드로 먼저 연결하세요 (not paired)' }, origin);
    if (req.method === 'POST' && url.pathname === '/run') {
      const b = await readBody(req);
      if (!SAFE_ID.test(String(b.runId || ''))) return send(res, 400, { error: '잘못된 실행 id' }, origin);
      const t0 = Date.now();
      process.stdout.write(`  ${b.tool === 'codex' ? 'codex' : 'claude'} 실행 중…`);
      try { const r = await runCli(b); console.log(` ${((Date.now() - t0) / 1000).toFixed(1)}초`); return send(res, 200, r, origin); }
      catch (e) { console.log(` 실패: ${e.message}`); return send(res, 500, { error: e.message }, origin); }
    }
    if (req.method === 'POST' && url.pathname === '/cancel') {
      const b = await readBody(req); running.get(String(b.runId || ''))?.();
      return send(res, 200, { ok: true }, origin);
    }
    return send(res, 404, { error: 'not found' }, origin);
  } catch (e) { return send(res, 500, { error: e.message }, origin); }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n  ${PORT} 번 포트를 이미 쓰고 있습니다. 브리지가 이미 켜져 있거나, --port 47822 처럼 다른 번호로 여세요.\n`);
  else console.error(e);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  const d = detect();
  console.log(`\n  Arch Canvas 브리지 ${VERSION}  ·  http://127.0.0.1:${PORT}`);
  console.log(`  claude: ${d.claude.found ? d.claude.version : '없음 (npm i -g @anthropic-ai/claude-code 후 claude auth login)'}`);
  console.log(`  codex : ${d.codex.found ? d.codex.version + (d.codex.loggedIn ? ' · 로그인됨' : ' · 로그인 필요 (codex login)') : '없음 (npm i -g @openai/codex 후 codex login)'}`);
  showCode();
});
