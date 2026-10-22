// 다이어그램 원본 = JSON 그래프. 캔버스(React Flow)와 PowerPoint 내보내기, 템플릿, (나중에) 모델 패치가 모두 이 형태만 주고받는다.
//
// {
//   "schema": "arch-canvas/graph@1",
//   "title": "3티어 웹",
//   "groups": [ { "id": "vpc", "kind": "vpc", "label": "VPC", "parent": "region", "x": 40, "y": 60, "w": 900, "h": 500 } ],
//   "nodes":  [ { "id": "alb", "icon": "Res_Elastic-Load-Balancing_Application-Load-Balancer", "label": "ALB", "parent": "pub-a", "x": 60, "y": 60 } ],
//   "edges":  [ { "id": "e1", "source": "alb", "target": "web-a", "label": "", "line": "solid", "shape": "straight", "arrow": "end" } ],
//   "annotations": [ { "id": "a1", "target": "alb", "level": "warn", "message": "WAF가 없습니다" } ]
// }
//
// - 좌표 단위는 캔버스 px. x/y 는 부모 그룹 왼쪽 위 기준(부모가 없으면 캔버스 기준), 그룹은 w/h 를 가진다.
// - 아이콘 노드는 ICON_SIZE 정사각형이고 라벨은 그 아래에 붙는다. icon 은 data/icons.json 의 key.
// - group.kind 는 data/icons.json 의 groupKinds[].id (vpc, region, az, public-subnet ...).
// - 그룹 배열은 부모가 자식보다 먼저 오게 정렬해서 저장한다(React Flow 요구사항과 같음).
// - annotations 는 검수 결과 자리. target 노드/그룹/엣지에 핀으로 표시된다.

export const SCHEMA = 'arch-canvas/graph@1';
export const ICON_SIZE = 48;
export const GROUP_ICON_SIZE = 32;
export const LABEL_WIDTH = 120;
export const ICON_LABEL_GAP = 4;    // 아이콘 아래 라벨까지 간격(px)
export const ICON_LABEL_H = 30;     // 라벨 상자 높이(px, 두 줄)
export const LABEL_DROP = ICON_LABEL_GAP + ICON_LABEL_H;   // 아래로 나가는 연결선은 라벨 밑에서 시작

// 새 연결선 기본값. 설정(⚙)에서 바꾸면 setEdgeDefaults 로 갱신되고, 손으로 잇기·추천·AI 그리기(shape 생략 시) 모두 이걸 쓴다.
export const EDGE_DEFAULTS = { label: '', line: 'solid', shape: 'elbow', arrow: 'end' };
export function setEdgeDefaults(p) { Object.assign(EDGE_DEFAULTS, p); }
export const LINES = ['solid', 'dashed'];
export const SHAPES = ['straight', 'elbow', 'curve'];
export const ARROWS = ['end', 'both', 'none'];
export const LEVELS = ['error', 'warn', 'info'];

// 제안서 컨텍스트: AI 검수/그리기 때 같이 보내는 배경. 다이어그램 JSON 에 함께 저장된다.
export const emptyContext = () => ({ title: '', requirements: '', constraints: '' });

// mode: infra(인프라 다이어그램, 규칙 검사) | card(솔루션 구성도: 카드·섹션, 규칙 검사 없음). theme: light | dark
export const MODES = ['infra', 'card'];
export const THEMES = ['light', 'dark'];
export const CARD_DEFAULT = { w: 200, h: 84 };
// 글상자(자유 텍스트)와 번호 배지(①②③). 카드처럼 크기를 가진다
export const TEXT_DEFAULT = { w: 180, h: 40 };
export const BADGE_SIZE = 28;
export const TEXT_SIZES = { sm: 11, md: 13, lg: 16, xl: 22 };
export const BOXED = new Set(['card', 'text', 'badge']);

export function emptyGraph(title = '새 다이어그램') {
  return { schema: SCHEMA, title, mode: 'infra', theme: 'light', context: emptyContext(), groups: [], nodes: [], edges: [], annotations: [] };
}

const num = (v, d) => (v !== '' && v != null && Number.isFinite(+v) ? Math.round(+v * 10) / 10 : d);

/** 라벨/설명 같은 글자 필드를 문자열로. null/undefined -> '', 객체 -> JSON 글자(앱이 죽지 않게). */
export function toText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(toText).filter(Boolean).join(' ');
  if (typeof v === 'object') {
    // {"ko":"…","en":"…"} 처럼 오면 한국어, 없으면 첫 글자 값을 쓴다
    const pick = v.ko ?? v.text ?? v.label ?? Object.values(v).find((x) => typeof x === 'string');
    if (typeof pick === 'string') return pick;
    try { return JSON.stringify(v) ?? ''; } catch { return String(v); }
  }
  return String(v);
}

// 외부 id 값 -> 문자열 id (없거나 객체면 null)
const rawId = (v) => (v == null || v === '' || typeof v === 'object' ? null : String(v));
const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

/** 외부에서 들어온 그래프(파일, 템플릿, 모델 출력)를 기본값 채우고 깨진 참조를 정리한 사본으로 만든다. */
export function normalizeGraph(input) {
  const g = input && typeof input === 'object' ? input : {};
  const out = emptyGraph(toText(g.title) || '새 다이어그램');
  const c = g.context && typeof g.context === 'object' ? g.context : {};
  out.context = { title: toText(c.title), requirements: toText(c.requirements), constraints: toText(c.constraints) };
  out.mode = MODES.includes(g.mode) ? g.mode : 'infra';
  out.theme = THEMES.includes(g.theme) ? g.theme : 'light';
  const hex = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : undefined);
  const raw = { groups: list(g.groups), nodes: list(g.nodes), edges: list(g.edges), annotations: list(g.annotations) };

  // id 정리: 그룹·노드·엣지·핀 전체에서 처음 나온 명시 id 를 먼저 예약하고, 중복/없는 id 는 새로 만든다
  const taken = new Set(), owner = new Map();
  for (const k of ['groups', 'nodes', 'edges', 'annotations']) {
    for (const x of raw[k]) { const id = rawId(x.id); if (id != null && !taken.has(id)) { taken.add(id); owner.set(x, id); } }
  }
  const idOf = (x, prefix) => {
    if (owner.has(x)) return owner.get(x);
    const id = uid(prefix, taken); taken.add(id); return id;
  };

  const gIds = raw.groups.map((x) => idOf(x, 'group'));
  const groupIds = new Set(gIds);
  const ref = (v) => rawId(v);
  out.groups = raw.groups.map((x, i) => {
    const id = gIds[i], p = ref(x.parent);
    return {
      id,
      kind: typeof x.kind === 'string' && x.kind ? x.kind : 'generic',
      ...(x.overlay === true ? { overlay: true } : x.overlay === false ? { overlay: false } : {}),
      ...(x.locked ? { locked: true } : {}),
      ...(setOf(x) ? { set: setOf(x) } : {}),
      label: toText(x.label),
      parent: p != null && groupIds.has(p) && p !== id ? p : null,
      x: num(x.x, p != null ? 40 : 0),
      y: num(x.y, p != null ? 40 : 0),
      w: Math.max(80, num(x.w, 320)),
      h: Math.max(60, num(x.h, 200)),
      // 섹션(자유 스타일) 덮어쓰기: 있으면 kind 의 기본 스타일 대신 쓴다
      ...(hex(x.color) ? { color: hex(x.color) } : {}),
      ...(x.fill === null || hex(x.fill) ? { fill: x.fill === null ? null : hex(x.fill) } : {}),
      ...(LINES.includes(x.line) || x.line === 'none' ? { line: x.line } : {}),
    };
  });
  breakCycles(out.groups);
  out.groups = sortGroups(out.groups);
  out.nodes = raw.nodes.map((x) => {
    const id = idOf(x, 'n'), p = ref(x.parent);
    return {
      id,
      ...(x.locked ? { locked: true } : {}),
      ...(setOf(x) ? { set: setOf(x) } : {}),
      ...(x.type === 'card' ? { type: 'card', body: toText(x.body), w: Math.max(120, num(x.w, CARD_DEFAULT.w)), h: Math.max(48, num(x.h, CARD_DEFAULT.h)), ...(hex(x.accent) ? { accent: hex(x.accent) } : {}) } : {}),
      ...(x.type === 'text' ? { type: 'text', w: Math.max(40, num(x.w, TEXT_DEFAULT.w)), h: Math.max(20, num(x.h, TEXT_DEFAULT.h)), size: TEXT_SIZES[x.size] ? x.size : 'md', bold: !!x.bold, ...(hex(x.accent) ? { accent: hex(x.accent) } : {}) } : {}),
      ...(x.type === 'badge' ? { type: 'badge', w: Math.min(64, Math.max(20, num(x.w, BADGE_SIZE))), h: Math.min(64, Math.max(20, num(x.w, BADGE_SIZE))), ...(hex(x.accent) ? { accent: hex(x.accent) } : {}) } : {}),
      icon: typeof x.icon === 'string' && x.icon ? x.icon : null,
      label: toText(x.label),
      parent: p != null && groupIds.has(p) ? p : null,
      x: num(x.x, p != null ? 40 : 0),
      y: num(x.y, p != null ? 40 : 0),
    };
  });
  // 묶음(Ctrl+G): 둘 이상 남은 묶음만 유지
  const setCount = new Map();
  for (const x of [...out.groups, ...out.nodes]) if (x.set) setCount.set(x.set, (setCount.get(x.set) || 0) + 1);
  for (const x of [...out.groups, ...out.nodes]) if (x.set && setCount.get(x.set) < 2) delete x.set;
  const ids = new Set([...out.groups.map((x) => x.id), ...out.nodes.map((x) => x.id)]);
  out.edges = [];
  for (const e of raw.edges) {
    const source = ref(e.source), target = ref(e.target);
    const id = idOf(e, 'e');   // 버려지는 엣지도 id 는 예약해 둔다(뒤 핀과 안 겹치게)
    if (!ids.has(source) || !ids.has(target) || source === target) continue;
    out.edges.push({
      id, source, target,
      label: toText(e.label),
      line: LINES.includes(e.line) ? e.line : EDGE_DEFAULTS.line,
      shape: SHAPES.includes(e.shape) ? e.shape : EDGE_DEFAULTS.shape,
      arrow: ARROWS.includes(e.arrow) ? e.arrow : EDGE_DEFAULTS.arrow,
    });
  }
  const all = new Set([...ids, ...out.edges.map((e) => e.id)]);
  out.annotations = [];
  for (const a of raw.annotations) {
    const id = idOf(a, 'a'), target = ref(a.target);
    if (!all.has(target)) continue;
    out.annotations.push({
      id, target,
      level: LEVELS.includes(a.level) ? a.level : 'info',
      message: toText(a.message),
      ...(a.explain ? { explain: toText(a.explain) } : {}),   // 왜 안 되는지 한두 문장
      ...(a.rule ? { rule: toText(a.rule) } : {}),            // 규칙이 만든 핀이면 규칙 id
    });
  }
  return out;
}

// 묶음 id: 짧은 문자열만
const setOf = (x) => (typeof x.set === 'string' && /^[\w-]{1,40}$/.test(x.set) ? x.set : null);

function breakCycles(groups) {
  const byId = new Map(groups.map((x) => [x.id, x]));
  for (const g of groups) {
    const seen = new Set([g.id]);
    let p = g.parent;
    while (p) {
      if (seen.has(p)) { g.parent = null; break; }
      seen.add(p);
      p = byId.get(p)?.parent;
    }
  }
}

/**
 * 그룹 순서 = 그리는 순서(z). 배열 순서를 최대한 그대로 두되, 부모가 자식보다 앞(뒤에 그려짐)에 오게만 고친다.
 * 자식이 부모보다 먼저 나오면 부모 바로 다음으로 미룬다. 그래서 "맨 앞으로"는 상자 전체에서 맨 앞,
 * "맨 뒤로"는 자기 부모 바로 위(부모 채움에 가려지지 않는 가장 뒤)가 된다.
 */
export function sortGroups(groups) {
  const ids = new Set(groups.map((g) => g.id));
  for (const g of groups) if (g.parent && !ids.has(g.parent)) g.parent = null;   // 없는 부모 -> 최상위
  const byId = new Map(groups.map((g) => [g.id, g]));
  // 순환은 끊는다(최상위로)
  for (const g of groups) {
    const path = new Set([g.id]);
    for (let p = g.parent; p; p = byId.get(p)?.parent) { if (path.has(p)) { g.parent = null; break; } path.add(p); }
  }
  const out = [], done = new Set(), waiting = new Map();
  const emit = (g) => {
    const stack = [g];
    while (stack.length) {
      const x = stack.pop();
      if (done.has(x.id)) continue;
      done.add(x.id); out.push(x);
      const w = waiting.get(x.id) || [];
      for (let i = w.length - 1; i >= 0; i--) stack.push(w[i]);
    }
  };
  for (const g of groups) {
    if (done.has(g.id)) continue;
    if (!g.parent || done.has(g.parent)) emit(g);
    else (waiting.get(g.parent) || waiting.set(g.parent, []).get(g.parent)).push(g);
  }
  for (const g of groups) if (!done.has(g.id)) { g.parent = null; emit(g); }   // (id 중복 같은 이상한 경우)
  return out;
}

export function uid(prefix, taken) {
  for (let i = 1; ; i++) {
    const id = prefix + '-' + i;
    if (!taken.has(id)) return id;
  }
}

export function allIds(g) {
  return new Set([...g.groups, ...g.nodes, ...g.edges, ...(g.annotations || [])].map((x) => x.id));
}
