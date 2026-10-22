// 아키텍처 규칙 검사. 규칙은 data/rules.json(데이터)이고, 여기는 평가기만 있다.
//
// lint(graph, catalog)         -> [{ rule, severity, target, message, explain }]  전체 검사
// diffViolations(before, after) -> after 에만 새로 생긴 위반 (액션 막기/경고에 씀)
// toAnnotations(violations)     -> 검수 핀(annotations)으로 변환. rule 필드가 있는 핀은 규칙이 만든 것.
//
// 규칙 종류
//   placement: subject(icon/kind 정규식) 가 inside(그룹 종류 정규식) 안에 있으면 / notInside 안에 없으면 위반
//              "안에 있다" = 부모 사슬에 있거나, 화면상 중심점이 그 그룹 사각형 안에 있음(겹쳐 그린 Auto Scaling 같은 경우 때문)
//   edge:      source/target(icon 정규식), sourceInside/targetInside(그룹 종류 정규식),
//              sourceContainsTarget(부모 사슬로만 판단: 경계에 걸쳐 그린 IGW 같은 것은 "안"이 아니다)
//   count:     scope(그룹 종류) 하나 안에 subject 가 max 개를 넘으면 위반 (넘친 것들에 표시)
import rulesData from '../../data/rules.json' with { type: 'json' };
import { absoluteRects } from './geometry.js';

export const RULES = rulesData.rules;
export const SEVERITY_ORDER = { block: 0, warn: 1, info: 2 };

const re = (s) => (s ? new RegExp(s) : null);
const compiled = RULES.map((r) => ({
  ...r,
  _subjectIcon: re(r.subject?.icon), _subjectKind: re(r.subject?.kind),
  _inside: re(r.inside), _notInside: re(r.notInside), _scope: re(r.scope),
  _srcIcon: re(r.source?.icon), _tgtIcon: re(r.target?.icon),
  _srcInside: re(r.sourceInside), _tgtInside: re(r.targetInside),
}));

/** 각 항목(그룹/노드)이 "속한" 그룹 id 집합: 부모 사슬 ∪ 중심점을 포함하는 그룹. */
function containment(graph) {
  const rects = absoluteRects(graph);
  const byId = new Map(graph.groups.map((g) => [g.id, g]));
  const out = new Map(), chain = new Map();
  for (const item of [...graph.groups, ...graph.nodes]) {
    const set = new Set();
    let p = item.parent, guard = 0;
    while (p && byId.has(p) && guard++ < 512) { set.add(p); p = byId.get(p).parent; }
    chain.set(item.id, new Set(set));
    const r = rects.get(item.id);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    for (const g of graph.groups) {
      if (g.id === item.id || set.has(g.id)) continue;
      const gr = rects.get(g.id);
      // 그룹은 자기보다 큰 그룹 안에만 "들어 있다"고 본다(겹친 형제 그룹끼리 서로 포함으로 안 잡히게)
      if ('w' in item && !(gr.w * gr.h > r.w * r.h)) continue;
      if (cx >= gr.x && cx <= gr.x + gr.w && cy >= gr.y && cy <= gr.y + gr.h) set.add(g.id);
    }
    out.set(item.id, set);
  }
  return { rects, sets: out, chain, byId };
}

export function lint(graph) {
  if (graph.mode === 'card') return [];   // 솔루션 구성도는 인프라 규칙 대상이 아니다
  const { sets, chain, byId } = containment(graph);
  const kindsOf = (id) => [...(sets.get(id) || [])].map((gid) => byId.get(gid)?.kind).filter(Boolean);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const subjectMatch = (rule, item) => {
    if (item.type === 'card' || item.type === 'text' || item.type === 'badge') return false;
    if (rule._subjectIcon && !(item.icon && rule._subjectIcon.test(item.icon))) return false;
    if (rule._subjectKind && !(item.kind && rule._subjectKind.test(item.kind))) return false;
    return !!(rule._subjectIcon || rule._subjectKind);
  };
  const out = [];
  const push = (rule, target) => out.push({ rule: rule.id, severity: rule.severity, target, message: rule.message, explain: rule.explain });

  for (const rule of compiled) {
    if (rule.type === 'placement') {
      for (const item of [...graph.groups, ...graph.nodes]) {
        if (!subjectMatch(rule, item)) continue;
        const kinds = kindsOf(item.id);
        if (rule._inside && kinds.some((k) => rule._inside.test(k))) push(rule, item.id);
        if (rule._notInside && !kinds.some((k) => rule._notInside.test(k))) push(rule, item.id);
      }
    } else if (rule.type === 'count') {
      const buckets = new Map();
      for (const item of graph.nodes) {
        if (!subjectMatch(rule, item)) continue;
        for (const gid of sets.get(item.id) || []) {
          if (rule._scope.test(byId.get(gid)?.kind || '')) (buckets.get(gid) || buckets.set(gid, []).get(gid)).push(item.id);
        }
      }
      for (const list of buckets.values()) if (list.length > rule.max) list.slice(rule.max).forEach((id) => push(rule, id));
    } else if (rule.type === 'edge') {
      for (const e of graph.edges) {
        const s = nodeById.get(e.source), t = nodeById.get(e.target);
        if (rule._srcIcon && !(s && rule._srcIcon.test(s.icon))) continue;
        if (rule._tgtIcon && !(t && rule._tgtIcon.test(t.icon))) continue;
        if (rule._srcInside && !kindsOf(e.source).some((k) => rule._srcInside.test(k))) continue;
        if (rule._tgtInside && !kindsOf(e.target).some((k) => rule._tgtInside.test(k))) continue;
        if (rule.sourceContainsTarget && !(chain.get(e.target)?.has(e.source) || chain.get(e.source)?.has(e.target))) continue;
        push(rule, e.id);
      }
    }
  }
  out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return out;
}

const key = (v) => v.rule + '@' + v.target;

export function diffViolations(before, after) {
  const seen = new Set(before.map(key));
  return after.filter((v) => !seen.has(key(v)));
}

/** 규칙 위반 → 검수 핀. 손으로 넣은 핀(rule 없음)은 그대로 두고 규칙 핀만 갈아 끼운다. */
export function mergeRuleAnnotations(existing, violations) {
  const manual = (existing || []).filter((a) => !a.rule);
  const auto = violations.map((v, i) => ({ id: 'rule-' + (i + 1), target: v.target, level: v.severity === 'block' ? 'error' : v.severity, message: v.message, explain: v.explain, rule: v.rule }));
  return [...manual, ...auto];
}

export const ruleById = (id) => RULES.find((r) => r.id === id);
