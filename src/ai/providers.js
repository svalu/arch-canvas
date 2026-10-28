// AI 어댑터. 어느 경로든 ask({ system, user }) -> 답 문자열 하나.
//   claude-cli : EXE 전용. 호스트가 `claude -p` 를 띄운다(사용자 구독, 키 없음).
//   claude-api : Anthropic 공식 SDK(브라우저 모드) + API 키.
//   openai-api : OpenAI Chat Completions + API 키.
import Anthropic from '@anthropic-ai/sdk';

export const PROVIDERS = [
  {
    id: 'claude-cli', name: 'Claude CLI', desc: '이 PC의 claude 명령으로 실행. 현재 Claude 구독을 그대로 써서 추가 비용 없음.',
    needsKey: false, desktopOnly: true,
    models: [{ id: '', name: 'CLI 기본 모델' }, { id: 'opus', name: 'Opus' }, { id: 'sonnet', name: 'Sonnet' }],
  },
  {
    id: 'claude-api', name: 'Claude API 키', desc: 'Anthropic API 키로 직접 호출. 브라우저에서도 됨. 토큰 비용이 별도로 나감.',
    needsKey: true, keyHint: 'sk-ant-api…', keyUrl: 'https://console.anthropic.com/settings/keys',
    models: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5 (기본)' }, { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }, { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5 (저렴)' }],
  },
  {
    id: 'openai-api', name: 'OpenAI API 키', desc: 'ChatGPT 계정이 아니라 OpenAI API 키가 필요. 토큰 비용 별도.',
    needsKey: true, keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys',
    models: [{ id: 'gpt-5', name: 'gpt-5' }, { id: 'gpt-4.1', name: 'gpt-4.1' }, { id: 'gpt-4o', name: 'gpt-4o' }],
  },
];
export const providerById = (id) => PROVIDERS.find((p) => p.id === id);

export class AiError extends Error {
  constructor(message, { detail, kind = 'unknown' } = {}) { super(message); this.detail = detail; this.kind = kind; }
}

/**
 * @param settings { provider, model, key }
 * @param req      { system, user, maxTokens?, signal? }
 */
export async function ask(settings, req) {
  if (settings.provider === 'mock') return askMock(req);
  const p = providerById(settings.provider);
  if (!p) throw new AiError('연결 방식이 정해지지 않았습니다', { kind: 'config' });
  if (p.id === 'claude-cli') return askClaudeCli(settings, req);
  if (p.id === 'claude-api') return askClaudeApi(settings, req);
  if (p.id === 'openai-api') return askOpenAi(settings, req);
  throw new AiError('모르는 연결 방식: ' + p.id, { kind: 'config' });
}

async function askClaudeApi({ key, model }, { system, user, maxTokens = 16000, signal }) {
  if (!key) throw new AiError('API 키가 없습니다', { kind: 'auth' });
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const base = { model: model || 'claude-opus-5-5', max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] };
  let res;
  try {
    try {
      // 안전 분류기 거부 시 서버가 다른 모델로 이어서 답하게(server-side fallback)
      res = await client.beta.messages.create({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal });
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError && /fallback|beta/i.test(e.message || '')) res = await client.messages.create(base, { signal });
      else throw e;
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new AiError('API 키가 맞지 않습니다. 키를 다시 확인하십시오.', { kind: 'auth', detail: e.message });
    if (e instanceof Anthropic.PermissionDeniedError) throw new AiError('이 키로는 이 모델을 쓸 수 없습니다.', { kind: 'permission', detail: e.message });
    if (e instanceof Anthropic.RateLimitError) throw new AiError('요청이 너무 많아 잠시 제한되었습니다. 조금 뒤에 다시 시도하십시오.', { kind: 'rate', detail: e.message });
    if (e instanceof Anthropic.APIConnectionError) throw new AiError('서버에 접속하지 못했습니다. 네트워크를 확인하십시오.', { kind: 'network', detail: e.message });
    if (e instanceof Anthropic.APIError) throw new AiError(`API 오류 (${e.status})`, { kind: 'api', detail: e.message });
    if (e?.name === 'AbortError') throw new AiError('취소했습니다', { kind: 'cancel' });
    throw new AiError('호출에 실패했습니다', { detail: String(e?.message || e) });
  }
  if (res.stop_reason === 'refusal') throw new AiError('모델이 이 요청에 답하지 않았습니다 (안전 정책)', { kind: 'refusal', detail: res.stop_details?.explanation });
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text.trim()) throw new AiError('빈 응답이 왔습니다', { kind: 'empty' });
  return text;
}

async function askOpenAi({ key, model }, { system, user, maxTokens = 8000, signal }) {
  if (!key) throw new AiError('API 키가 없습니다', { kind: 'auth' });
  let r;
  try {
    r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: model || 'gpt-5', max_completion_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw new AiError('취소했습니다', { kind: 'cancel' });
    throw new AiError('서버에 접속하지 못했습니다. 네트워크를 확인하십시오.', { kind: 'network', detail: String(e?.message || e) });
  }
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    if (r.status === 401) throw new AiError('API 키가 맞지 않습니다. 키를 다시 확인하십시오.', { kind: 'auth', detail: body });
    if (r.status === 429) throw new AiError('요청이 너무 많거나 크레딧이 없습니다.', { kind: 'rate', detail: body });
    throw new AiError(`API 오류 (${r.status})`, { kind: 'api', detail: body });
  }
  const j = await r.json();
  const text = j.choices?.[0]?.message?.content || '';
  if (!text.trim()) throw new AiError('빈 응답이 왔습니다', { kind: 'empty' });
  return text;
}

async function askClaudeCli({ model }, { system, user, signal, timeoutMs = 240000 }) {
  if (!window.desktop?.call) throw new AiError('Claude CLI 는 EXE 에서만 사용할 수 있습니다', { kind: 'config' });
  const id = Math.random().toString(36).slice(2);
  const onAbort = () => window.desktop.call('ai.cancel', { runId: id }).catch(() => {});
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const r = await window.desktop.call('ai.run', { runId: id, system, user, model: model || '', timeoutMs });
    if (!r?.text?.trim()) throw new AiError('빈 응답이 왔습니다', { kind: 'empty', detail: r?.stderr });
    return r.text;
  } catch (e) {
    if (e instanceof AiError) throw e;
    const msg = String(e?.message || e);
    if (/취소|cancel/i.test(msg)) throw new AiError('취소했습니다', { kind: 'cancel' });
    if (/not logged in|login|auth/i.test(msg)) throw new AiError('claude CLI 에 로그인되어 있지 않습니다. 터미널에서 claude auth login 을 실행해 로그인하십시오.', { kind: 'auth', detail: msg });
    if (/not found|없음/i.test(msg)) throw new AiError('claude 명령을 찾지 못했습니다. Claude Code 를 설치하십시오 (npm i -g @anthropic-ai/claude-code).', { kind: 'config', detail: msg });
    throw new AiError('CLI 실행에 실패했습니다', { detail: msg });
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

// 테스트용 가짜 모델(네트워크 없음). localStorage 'arch-canvas:ai-mock'='1' 이면 연결 모달에도 나온다.
export const MOCK_PROVIDER = { id: 'mock', name: 'Mock (테스트)', desc: '모델을 부르지 않고 정해진 답을 돌려줍니다. 화면 확인용입니다.', needsKey: false, models: [{ id: '', name: '-' }] };
export const mockEnabled = () => { try { return localStorage.getItem('arch-canvas:ai-mock') === '1'; } catch { return false; } };
async function askMock({ user }) {
  await new Promise((r) => setTimeout(r, 400));
  if (/연결 확인용/.test(user)) return '연결 확인';
  if (/# 질문/.test(user)) return ['(mock) 이 경고는 보안 경계와 관련됩니다. 현재 다이어그램에서는 RDS Primary를 Private subnet (DB)으로 옮기고, 앱 서버 보안 그룹에서만 3306 포트를 허용하면 해결됩니다.', '제안서 근거: "DB 계층은 인터넷에서 직접 접근할 수 없는 프라이빗 서브넷에 배치합니다."'].join('\n');
  if (/# 정리 요청/.test(user)) {
    return JSON.stringify({ understood: '(mock) 내 PC 에서 도는 AI 를 밖에서도 쓰고 싶으신 거군요.', title: '(mock) 개인 AI 를 AWS 에', requirements: ['밖에서도 접속', '기억 공유'], constraints: ['비용 최소'],
      questions: [
        { id: 'q1', question: '하루 종일 켜 둬야 하나요, 쓸 때만 켜도 되나요?', why: '가장 큰 비용 차이가 여기서 납니다.', options: ['하루 종일', '쓸 때만', '잘 모르겠어요 (알아서 정해 주세요)'], multi: false },
        { id: 'q2', question: '어디서 들어오나요?', why: '입구(웹·앱)에 따라 앞단이 달라집니다.', options: ['휴대폰', '회사 PC', '집 PC', '잘 모르겠어요 (알아서 정해 주세요)'], multi: true },
      ],
      drawRequest: '(mock) CloudFront 와 S3 를 추가하고 사용자와 연결' });
  }
  if (/요청을 ops 로/.test(user)) {
    return JSON.stringify({ summary: '(mock) 사용자와 ALB 사이에 CloudFront 와 WAF 를 넣고 S3 를 연결했습니다.', ops: [
      { op: 'add_node', id: 'cf', icon: 'Arch_Amazon-CloudFront', label: 'Amazon CloudFront', parent: null, x: 40, y: 300 },
      { op: 'add_node', id: 'waf', icon: 'Arch_AWS-WAF', label: 'AWS WAF', parent: null, x: 40, y: 440 },
      { op: 'add_node', id: 's3', icon: 'Arch_Amazon-Simple-Storage-Service', label: 'S3 (정적)', parent: 'region', x: 850, y: 40 },
      { op: 'connect', source: 'users', target: 'cf' }, { op: 'connect', source: 'cf', target: 'waf' }, { op: 'connect', source: 'waf', target: 'alb', shape: 'elbow' }, { op: 'connect', source: 'cf', target: 's3', line: 'dashed' },
    ] });
  }
  return JSON.stringify({ summary: '(mock) 요건서의 DR 와 WAF 항목이 다이어그램에 없습니다. 나머지는 3티어 기본 구성으로 무난합니다.', findings: [
    { target: 'alb', level: 'warn', message: 'WAF 가 없습니다', explain: '요건서에 WAF 적용이 필수라고 돼 있습니다. ALB 앞에 AWS WAF 를 두는 것을 권장합니다.' },
    { target: 'region', level: 'info', message: 'DR 리전이 없습니다', explain: '30분 현재 복구 요건이면 다른 리전에 최소 구성을 두고 Route 53 장애 조치를 그려주는 게 좋습니다.' },
    { target: 'no-such-id', level: 'info', message: '없는 id', explain: '걸러져야 함' },
  ] });
}

/** EXE 에서 claude CLI 가 있는지. 브라우저면 { found:false }. */
export async function detectCli() {
  if (!window.desktop?.call) return { found: false, reason: 'browser' };
  try { return await window.desktop.call('cli.detect', {}); } catch (e) { return { found: false, reason: String(e?.message || e) }; }
}
