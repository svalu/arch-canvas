// 연결 설정 저장 + "진짜 쓸 수 있는지" 확인. 가이드 원칙: 로그인/키 저장만으로 성공 처리하지 않고 고정 문장으로 실제 응답을 받아야 준비 완료.
import { ask, providerById, AiError } from './providers.js';
import { TEST_PROMPT } from './prompts.js';

const LS_SETTINGS = 'arch-canvas:ai';
const LS_KEY = 'arch-canvas:ai-key:';

export function loadSettings() {
  try { return { provider: '', model: '', verified: {}, ...JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}') }; } catch { return { provider: '', model: '', verified: {} }; }
}
export function saveSettings(s) {
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify({ provider: s.provider, model: s.model, verified: s.verified || {} })); } catch { /* */ }
}

// API 키: EXE 는 Windows 계정 암호화(DPAPI) 파일, 브라우저는 localStorage (이 브라우저 프로필에만 남음)
export async function getKey(provider) {
  if (window.desktop?.call) { try { return (await window.desktop.call('secret.get', { name: 'ai-key-' + provider }))?.value || ''; } catch { return ''; } }
  try { return localStorage.getItem(LS_KEY + provider) || ''; } catch { return ''; }
}
export async function setKey(provider, value) {
  if (window.desktop?.call) { await window.desktop.call('secret.set', { name: 'ai-key-' + provider, value: value || '' }); return; }
  try { if (value) localStorage.setItem(LS_KEY + provider, value); else localStorage.removeItem(LS_KEY + provider); } catch { /* */ }
}

export const verifyKey = (s) => `${s.provider}|${s.model || ''}`;
export const isVerified = (s) => !!(s.provider && s.verified?.[verifyKey(s)]);

/** 실제 응답을 받아 본다. 빈 응답은 실패. 사용자 문서는 섞지 않는다. */
export async function verifyConnection(settings, { signal } = {}) {
  const p = settings.provider === 'mock' ? { needsKey: false } : providerById(settings.provider);
  if (!p) throw new AiError('연결 방식을 골라 주세요', { kind: 'config' });
  const key = p.needsKey ? await getKey(settings.provider) : '';
  if (p.needsKey && !key) throw new AiError('API 키를 입력하십시오', { kind: 'auth' });
  const t0 = Date.now();
  const reply = await ask({ ...settings, key }, { system: '짧게 답한다.', user: TEST_PROMPT, maxTokens: 200, signal });
  if (!reply || !reply.trim()) throw new AiError('빈 응답이 왔습니다', { kind: 'empty' });
  return { reply: reply.trim().slice(0, 200), ms: Date.now() - t0 };
}

/** 검수/그리기 호출. 키를 붙여서 ask. */
export async function run(settings, req) {
  const p = settings.provider === 'mock' ? null : providerById(settings.provider);
  const key = p?.needsKey ? await getKey(settings.provider) : '';
  return ask({ ...settings, key }, req);
}
