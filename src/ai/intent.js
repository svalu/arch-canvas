// 채팅 한 칸에 적은 말이 무슨 부탁인지 정한다: 정렬(arrange) · 검수(review) · 질문(ask) · 그리기·고치기(draw).
// 모델을 부르지 않고 말투로 정한다(한 번 더 기다리지 않게). 앞에 "정렬:", "질문:", "그려:", "검수:" 를 붙이면 그대로 따른다.
const PREFIX = [
  [/^(정렬|배치)\s*[:：]\s*/, 'arrange'],
  [/^(질문|물어|물어보기)\s*[:：]\s*/, 'ask'],
  [/^(그려|그리기|그림|고쳐|고치기)\s*[:：]\s*/, 'draw'],
  [/^(검수|점검)\s*[:：]?\s*/, 'review'],
];
const DRAW_VERB = /추가|넣어|넣고|이어|연결|끊어|지워|삭제|빼\s*줘|빼고|바꿔|바꾸|옮겨|옮기|묶어|묶고|나눠|나누|만들어|그려|그리|합쳐|붙여|줄여|늘려|바꿈|추가해|교체|대체|넣자|두자|놓아|놓자/;
const ARRANGE = /정렬|배치|정리\s*해|정리\s*좀|줄\s*(좀\s*)?맞|깔끔|보기\s*좋게|장표에\s*맞|다시\s*잡아|레이아웃|간격\s*(좀\s*)?맞|가지런/;
// "AI 계층은 Connect 위에 한 줄로 놔 줘" 처럼 자리를 말하는 문장은 정렬에 대한 요청
const PLACE = /(위에|아래에|옆에|왼쪽에|오른쪽에|가운데에|한\s*줄로|한\s*열로|세로로|가로로|나란히)\s*(놔|둬|두|놓|배치|정렬|쌓|모아|세워|늘어)/;
const REVIEW = /검수|점검|리뷰|빠진\s*(게|것|거)|문제\s*(없|있)|이상\s*(없|있)|확인해\s*줘|봐\s*줘|체크해|검토/;
const ASK = /\?$|왜|뭐야|뭔가요|무엇|어떻게|괜찮|차이|설명|알려\s*줘|맞아|되나|될까|할까|필요해|가능해|얼마|몇\s*개|어디|언제|무슨|어느/;

export function classifyIntent(text) {
  const t = String(text || '').trim();
  if (!t) return { intent: 'review', text: '', forced: false };
  for (const [re, intent] of PREFIX) { const m = t.match(re); if (m) return { intent, text: t.slice(m[0].length).trim(), forced: true }; }
  const draw = DRAW_VERB.test(t), arrange = ARRANGE.test(t), review = REVIEW.test(t), ask = ASK.test(t);
  if (PLACE.test(t) && !/추가|연결|삭제|지워|만들어/.test(t)) return { intent: 'arrange', text: t, forced: false };
  if (review && !draw && !arrange) return { intent: 'review', text: t, forced: false };
  if (arrange && !draw) return { intent: 'arrange', text: t, forced: false };
  if (arrange && draw && /정렬|배치/.test(t) && !/추가|연결|삭제|지워|만들어/.test(t)) return { intent: 'arrange', text: t, forced: false };   // "채널은 상자에서 묶어서 정렬해" 같은 말은 정렬 쪽
  if (draw) return { intent: 'draw', text: t, forced: false };
  if (ask) return { intent: 'ask', text: t, forced: false };
  return { intent: t.length <= 24 && !/[.!]$/.test(t) ? 'ask' : 'draw', text: t, forced: false };
}

export const INTENT_LABEL = { arrange: '정렬', review: '검수', ask: '질문', draw: '그리기·고치기' };
