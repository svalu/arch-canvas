// 모델에게 보내는 글 만들기 + 답 파싱. 검수(review)와 그리기(draw) 두 모드.
// 두 모드 다 "제안서 컨텍스트 + 그래프 요약 + 규칙 검사 결과"를 같이 보내고, 답은 JSON 하나로 받는다.
import { PATCH_OPS } from '../model/patch.js';

export const TEST_PROMPT = '연결 확인용입니다. 연결 확인이라고만 짧게 답해주세요.';

/** 그래프를 사람이 읽는 형태로. 그룹은 들여쓰기 트리, 노드는 id/아이콘/라벨, 연결은 a -> b. */
export function summarizeGraph(graph, catalog) {
  const lines = [];
  const kids = new Map();
  for (const g of graph.groups) (kids.get(g.parent || '') || kids.set(g.parent || '', []).get(g.parent || '')).push(g);
  const nodesIn = new Map();
  for (const n of graph.nodes) (nodesIn.get(n.parent || '') || nodesIn.set(n.parent || '', []).get(n.parent || '')).push(n);
  const nodeLine = (n) => n.type === 'card'
    ? `- card ${n.id}: "${n.label}"${n.body ? ` — ${n.body.replace(/\n/g, ' / ')}` : ''}${n.icon ? ` [icon=${n.icon}]` : ''}`
    : `- node ${n.id}: ${catalog.icons.get(n.icon)?.name || n.icon}${n.label && n.label !== catalog.icons.get(n.icon)?.name ? ` "${n.label}"` : ''} [icon=${n.icon}]`;
  const walk = (pid, depth) => {
    const pad = '  '.repeat(depth);
    for (const g of kids.get(pid) || []) {
      const kind = catalog.kinds.get(g.kind);
      lines.push(`${pad}- group ${g.id}: ${kind?.name || g.kind}${g.label ? ` "${g.label}"` : ''} [kind=${g.kind}, ${g.w}x${g.h}]`);
      for (const n of nodesIn.get(g.id) || []) lines.push(pad + '  ' + nodeLine(n));
      walk(g.id, depth + 1);
    }
  };
  lines.push('## 그룹과 노드 (들여쓰기 = 포함 관계)');
  for (const n of nodesIn.get('') || []) lines.push(nodeLine(n) + ' (최상위)');
  walk('', 0);
  lines.push('', '## 연결선');
  if (!graph.edges.length) lines.push('(없음)');
  for (const e of graph.edges) lines.push(`- ${e.id}: ${e.source ?? '(빈 곳)'} -> ${e.target ?? '(빈 곳)'}${e.label ? ` "${e.label}"` : ''}${e.arrow === 'both' ? ' (양방향)' : ''}${e.line === 'dashed' ? ' (점선)' : ''}`);
  return lines.join('\n');
}

export function contextText(ctx) {
  if (!ctx || (!ctx.title && !ctx.requirements && !ctx.constraints)) return '(제안서 컨텍스트 없음)';
  return [ctx.title && `제목: ${ctx.title}`, ctx.requirements && `요건서/RFP 요약:\n${ctx.requirements}`, ctx.constraints && `제약·전제:\n${ctx.constraints}`].filter(Boolean).join('\n\n');
}

export function violationsText(violations) {
  if (!violations?.length) return '(자동 규칙 위반 없음)';
  return violations.map((v) => `- [${v.severity}] ${v.target}: ${v.message}`).join('\n');
}

// 그리기 모드에 넘기는 아이콘 목록: 서비스 아이콘 전부 + 자주 쓰는 리소스 아이콘. (전체 858개는 너무 길다)
const COMMON_RES = /^Res_(Users|User|Client|Mobile-client|Internet|Servers|Server)_Light$|^Res_Amazon-VPC_(Internet-Gateway|NAT-Gateway|Customer-Gateway|VPN-Gateway|Endpoints|Router)$|^Res_Elastic-Load-Balancing_|^Res_Amazon-EC2_Instance$|^Res_Amazon-Aurora_Amazon-RDS-Instance$|^Res_Amazon-RDS_Multi-AZ$|^Res_AWS-Lambda_Lambda-Function$|^Res_Amazon-Simple-Storage-Service_Bucket$|^Res_Amazon-DynamoDB_Table$|^Res_Amazon-Elastic-Container-Service_(Service|Task|Container)/;
export function catalogText(catalog) {
  const icons = catalog.list.filter((i) => i.kind === 'service' || COMMON_RES.test(i.key)).map((i) => `${i.key} = ${i.name}`);
  const kinds = catalog.groupKinds.map((k) => `${k.id} = ${k.name}`);
  return `## 쓸 수 있는 그룹 종류 (kind)\n${kinds.join('\n')}\n\n## 쓸 수 있는 아이콘 (icon key = 이름)\n${icons.join('\n')}`;
}

const COMMON_SYSTEM = `너는 AWS 솔루션 아키텍트다. 사용자는 고객 제안서에 들어갈 아키텍처 다이어그램을 그리고 있다.
답은 반드시 JSON 객체 하나만, 코드 펜스 없이, 앞뒤 설명 없이 출력한다. 한국어 문어체(존댓말 "~합니다")로 쓴다. 제안서 검토 의견처럼 간결하고 분명하게.`;

export const REVIEW_SYSTEM = `${COMMON_SYSTEM}

역할: 다이어그램을 제안서 요건과 AWS 모범 사례에 비춰 검수한다. 자동 규칙(문법 수준)이 이미 잡은 건 반복하지 말고, 그 위의 것을 본다:
요건서에 있는데 빠진 것, 요건에 비해 과한 것, 가용성/보안/비용/운영 관점의 빈틈, 라벨이 모호한 것.
각 지적은 그래프의 실제 id(노드/그룹/연결선)에 붙인다. 특정 요소에 붙일 수 없는 전체 의견은 summary 에 쓴다.

출력 형식:
{
  "summary": "총평 2~4문장",
  "findings": [
    { "target": "<그래프 id>", "level": "error|warn|info", "message": "한 줄 요약", "explain": "왜 문제인지와 어떻게 고치면 되는지 1~3문장" }
  ]
}
findings 는 중요한 순서로 최대 8개. 문제가 없으면 빈 배열.`;

export const DRAW_SYSTEM = `${COMMON_SYSTEM}

역할: 사용자의 말을 다이어그램 수정 명령(ops)으로 바꾼다. 기존 그래프를 최대한 살리고 필요한 것만 더하거나 고친다.
명령 하나는 객체이고 종류는 반드시 "op" 키에 쓴다(예: {"op":"add_node", ...}). op 값: ${PATCH_OPS.join(', ')}
- {"op":"add_group", "id"?, "kind", "label"?, "parent"?, "x"?, "y"?, "w"?, "h"?}  좌표를 모르면 x/y 는 생략(자동 배치). w/h 는 대략(서브넷 380x150, AZ 420x500, VPC 900x650, Region 1000x740).
- {"op":"add_node", "id"?, "icon", "label"?, "parent"?, "x"?, "y"?}  icon 은 아래 목록의 key 그대로. 좌표 생략 가능. parent 는 들어갈 그룹 id(최상위면 생략).
- {"op":"connect", "source", "target", "label"?, "line"?: "solid"|"dashed", "shape"?: "straight"|"elbow"|"curve", "arrow"?: "end"|"both"|"none"}
- {"op":"move_into", "id", "parent"}, {"op":"update", "id", "set": {"label"?, "kind"?, "icon"?}}, {"op":"remove", "id"}, {"op":"disconnect", "source", "target"}
새 id 는 짧은 영문 소문자+하이픈(예: "alb", "web-a", "pub-a"). 기존 id 와 겹치지 않게.
AWS 관례: 서브넷은 AZ 안, AZ 는 VPC 안, VPC 는 Region 안. DB 는 Private subnet. 사용자/인터넷은 Region 밖. IGW 는 VPC 에 하나.
겹치는 상자: 오토 스케일링 그룹(auto-scaling), 보안 그룹(security-group), ECS 클러스터·EKS 노드 그룹 같은 묶음은 아무것도 품지 않는다. 이런 상자는 add_group 에 "members": [그 안에 보일 노드 id] 를 주고 parent·좌표는 쓰지 않는다(앱이 멤버를 감싸게 그린다). 멤버 EC2·태스크의 parent 는 각자의 서브넷이다. 클러스터처럼 kind 가 generic 이면 "overlay": true 를 준다.
배치: 좌표(x/y)는 쓰지 않는다. 앱이 연결 관계를 보고 자리를 정한다. 대신 VPC·서브넷 안에 들어갈 노드는 add_node 에 parent(들어갈 그룹 id)를 반드시 쓴다(예: EC2·RDS·ElastiCache → 해당 서브넷, ALB·NAT → 퍼블릭 서브넷).
CloudFront·WAF·Route 53·S3·DynamoDB·API Gateway 같은 리전/글로벌 서비스는 parent 를 쓰지 않는다(VPC 밖). 새 노드는 반드시 connect 로 기존 노드와 이어서 흐름 위치가 드러나게 한다.

출력 형식:
{
  "summary": "무엇을 어떻게 바꿨는지 1~3문장",
  "ops": [ {"op":"add_node","id":"cf","icon":"Arch_Amazon-CloudFront","label":"CloudFront"}, {"op":"connect","source":"users","target":"cf"} ]
}`;

const CARD_NOTE = `\n\n이 다이어그램은 "솔루션 구성도"(카드 모드)다: 인프라 배치가 아니라 기능 블록(card: 제목 + 설명)과 섹션(group kind=section)으로 "무엇을 제공하고 어떻게 연동되는지"를 보여준다.
검수 관점은 요건 커버리지다 — 요건서 항목 중 카드로 표현되지 않은 것, 설명이 모호한 카드, 연동 흐름이 끊긴 곳, 제안서에서 강조해야 할 차별점이 빠진 곳. 서브넷/AZ 같은 인프라 규칙은 보지 않는다.`;
const CARD_DRAW_NOTE = `\n\n카드 모드다: 기능 블록은 {"op":"add_card","id"?,"icon"?,"label":"제목","body":"설명 1~2줄","parent"?,"w"?,"h"?} 로, 묶음은 {"op":"add_group","kind":"section","label":"섹션 이름","color"?:"#RRGGBB"} 로 만든다. 아이콘 노드(add_node)보다 카드를 우선 쓴다.`;

export function buildReviewMessages(graph, catalog, violations) {
  const card = graph.mode === 'card';
  const user = `# 제안서 컨텍스트\n${contextText(graph.context)}\n\n# 현재 다이어그램: ${graph.title}${card ? ' (솔루션 구성도)' : ''}\n${summarizeGraph(graph, catalog)}\n\n# 자동 규칙 검사 결과\n${card ? '(카드 모드: 인프라 규칙 검사 없음)' : violationsText(violations)}\n\n위 다이어그램을 검수해서 JSON 으로 답해줘.`;
  return { system: REVIEW_SYSTEM + (card ? CARD_NOTE : ''), user };
}

export function buildDrawMessages(graph, catalog, request, violations) {
  const card = graph.mode === 'card';
  const user = `# 제안서 컨텍스트\n${contextText(graph.context)}\n\n# 현재 다이어그램: ${graph.title}${card ? ' (솔루션 구성도)' : ''}\n${summarizeGraph(graph, catalog)}\n\n# 자동 규칙 검사 결과\n${card ? '(카드 모드: 인프라 규칙 검사 없음)' : violationsText(violations)}\n\n${catalogText(catalog)}\n\n# 요청\n${request}\n\n요청을 ops 로 바꿔 JSON 으로 답해줘.`;
  return { system: DRAW_SYSTEM + (card ? CARD_DRAW_NOTE : ''), user };
}

// 자유 질문: 경고/핀/궁금한 점을 다이어그램 맥락과 함께 묻는다. 답은 JSON 이 아니라 글.
export const ASK_SYSTEM = `너는 AWS 솔루션 아키텍트다. 사용자는 고객 제안서용 아키텍처 다이어그램을 그리는 중이고, 지금 뜬 경고나 궁금한 점을 묻는다.
한국어 문어체(존댓말 "~합니다")로, 결론부터 3~8문장. 왜 그런지 → 이 다이어그램에서 구체적으로 어떻게 고치면 되는지(노드 이름으로) → 제안서에 적을 한 줄 근거 순서로. 코드 펜스·JSON 없이 그냥 글. 필요하면 짧은 목록은 괜찮다.`;

export function buildAskMessages(graph, catalog, question, violations, history = []) {
  const user = `# 제안서 컨텍스트\n${contextText(graph.context)}\n\n# 현재 다이어그램: ${graph.title}${graph.mode === 'card' ? ' (솔루션 구성도)' : ''}\n${summarizeGraph(graph, catalog)}\n\n# 자동 규칙 검사 결과\n${graph.mode === 'card' ? '(카드 모드: 없음)' : violationsText(violations)}\n\n${history.length ? '# 앞선 대화\n' + history.map((h) => `${h.role === 'user' ? '사용자' : 'AI'}: ${h.text}`).join('\n\n') + '\n\n' : ''}# 질문\n${question}`;
  return { system: ASK_SYSTEM, user };
}

/** 모델 답에서 JSON 객체 하나를 꺼낸다. 코드 펜스/앞뒤 잡담이 섞여도 첫 { 부터 마지막 } 까지를 시도. */
export function parseJsonReply(text) {
  if (!text) throw new Error('빈 응답');
  let t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { /* 아래에서 다시 */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch { /* */ }
  }
  const err = new Error('JSON 으로 읽을 수 없는 응답');
  err.detail = t.slice(0, 2000);
  throw err;
}

const LEVELS = new Set(['error', 'warn', 'info']);
/** 검수 결과 → 검수 핀 목록(ids 는 그래프에 있는 것만). */
export function findingsToAnnotations(findings, graph) {
  const ids = new Set([...graph.groups, ...graph.nodes, ...graph.edges].map((x) => x.id));
  const out = [], dropped = [];
  for (const f of Array.isArray(findings) ? findings : []) {
    if (!f || !ids.has(f.target)) { dropped.push(f?.target); continue; }
    out.push({ id: 'ai-' + (out.length + 1), target: f.target, level: LEVELS.has(f.level) ? f.level : 'info', message: String(f.message || '').slice(0, 200), explain: String(f.explain || '').slice(0, 600) });
  }
  return { annotations: out, dropped: dropped.filter(Boolean) };
}
