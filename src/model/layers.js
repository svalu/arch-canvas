// 레이어(그리는 순서). 규칙:
//  - 상자(그룹)는 같은 부모 안의 형제끼리 순서가 있고, 뒤에 있는 형제(와 그 안의 것)가 앞에 그려진다.
//  - 아이콘·카드·글상자는 항상 상자보다 위. 아이콘끼리는 nodes 배열 순서(뒤가 앞).
//  - 상자 안에 든 것은 상자를 따라 움직인다(부모-자식). 상자만 옮기려면 Alt+끌기.
import { sortGroups } from './schema.js';
import { freeSlot } from './geometry.js';

const isGroup = (g, id) => g.groups.some((x) => x.id === id);

/** how: 'front' | 'forward' | 'backward' | 'back'. 같은 부모 안에서만 순서를 바꾼다. */
export function reorder(graph, ids, how) {
  const g = structuredClone(graph);
  const want = new Set(ids);
  for (const key of ['groups', 'nodes']) {
    const arr = g[key];
    // 상자는 같은 부모 안 형제끼리, 아이콘은 부모와 상관없이 전체에서 (아이콘은 서로 다른 상자에 있어도 겹칠 수 있으므로)
    const scopeOf = (x) => (key === 'nodes' ? '*' : (x.parent ?? null));
    const parents = [...new Set(arr.filter((x) => want.has(x.id)).map(scopeOf))];
    for (const p of parents) {
      // 형제 목록(배열 안 위치 포함)
      const sib = arr.map((x, i) => ({ x, i })).filter((o) => scopeOf(o.x) === p);
      const order = sib.map((o) => o.x);
      const picked = order.filter((x) => want.has(x.id));
      let rest = order.filter((x) => !want.has(x.id));
      let next;
      if (how === 'front') next = [...rest, ...picked];
      else if (how === 'back') next = [...picked, ...rest];
      else {
        next = [...order];
        const step = how === 'forward' ? 1 : -1;
        const idxs = next.map((x, i) => (want.has(x.id) ? i : -1)).filter((i) => i >= 0);
        if (step > 0) idxs.reverse();
        for (const i of idxs) {
          const j = i + step;
          if (j < 0 || j >= next.length || want.has(next[j].id)) continue;
          [next[i], next[j]] = [next[j], next[i]];
        }
      }
      // 형제 자리(배열 인덱스)에 새 순서로 다시 넣는다
      sib.forEach((o, k) => { arr[o.i] = next[k]; });
    }
  }
  g.groups = sortGroups(g.groups);
  return g;
}

/** 레이어 목록(위가 앞). 상자 안의 것은 children 으로. */
export function layerTree(g) {
  const kids = (pid) => {
    const nodes = g.nodes.filter((n) => (n.parent ?? null) === pid).map((n) => ({ id: n.id, kind: 'node', item: n, children: [] }));
    const groups = g.groups.filter((x) => (x.parent ?? null) === pid).map((x) => ({ id: x.id, kind: 'group', item: x, children: kids(x.id) }));
    // 앞에 그려지는 것이 위로: 아이콘(뒤가 앞) → 상자(뒤가 앞)
    return [...nodes.reverse(), ...groups.reverse()];
  };
  return kids(null);
}

/** 레이어 패널에서 끌어 놓기: target 이 상자면 그 안으로, 아니면 target 바로 앞(위)에 같은 부모로. 화면 위치는 유지. */
export function moveInLayers(graph, id, targetId, rects) {
  const g = structuredClone(graph);
  const item = g.groups.find((x) => x.id === id) || g.nodes.find((x) => x.id === id);
  const target = g.groups.find((x) => x.id === targetId) || g.nodes.find((x) => x.id === targetId);
  if (!item || !target || id === targetId) return g;
  // 자기 안(자기 자신, 또는 자기 안에 든 것의 자리)으로는 못 넣는다
  const parentOf = (pid) => g.groups.find((x) => x.id === pid)?.parent;
  for (let p = isGroup(g, targetId) ? targetId : target.parent; p; p = parentOf(p)) if (p === id) return g;
  const newParent = isGroup(g, targetId) ? targetId : (target.parent ?? null);
  const abs = rects.get(id), pr = newParent ? rects.get(newParent) : { x: 0, y: 0 };
  item.parent = newParent;
  item.x = Math.round(abs.x - pr.x); item.y = Math.round(abs.y - pr.y);
  // 화면에서 그 상자 밖에 있으면 상자 안 빈자리로 옮긴다 (목록과 화면이 어긋나지 않게)
  if (newParent) {
    const P = rects.get(newParent), w = abs.w || 48, h = abs.h || 48;
    const inside = abs.x >= P.x && abs.y >= P.y && abs.x + w <= P.x + P.w && abs.y + h <= P.y + P.h;
    if (!inside) { const s = freeSlot(g, newParent); item.x = s.x; item.y = s.y; }
  }
  // 순서: 같은 종류 배열에서 target 뒤(=앞에 그려짐)로
  const key = isGroup(g, id) ? 'groups' : 'nodes';
  const arr = g[key];
  const from = arr.indexOf(item); arr.splice(from, 1);
  const ti = arr.findIndex((x) => x.id === targetId);
  if (ti >= 0 && !isGroup(g, targetId)) arr.splice(ti + 1, 0, item); else arr.push(item);
  g.groups = sortGroups(g.groups);
  return g;
}
