// 레이어(그리는 순서). 규칙:
//  - 상자(그룹)는 같은 부모 안의 형제끼리 순서가 있고, 뒤에 있는 형제(와 그 안의 것)가 앞에 그려진다.
//  - 아이콘·카드·글상자는 항상 상자보다 위. 아이콘끼리는 nodes 배열 순서(뒤가 앞).
//  - 상자 안에 든 것은 상자를 따라 움직인다(부모-자식). 상자만 옮기려면 Alt+끌기.
import { sortGroups } from './schema.js';
import { isOverlay } from './contain.js';

const isGroup = (g, id) => g.groups.some((x) => x.id === id);

/** how: 'front' | 'forward' | 'backward' | 'back'. 화면 전체에서 하나의 순서. 상자는 상자끼리(담는/겹치는 띠 안에서), 아이콘은 아이콘끼리. */
export function reorder(graph, ids, how) {
  const g = structuredClone(graph);
  const want = new Set(ids);
  g.nodes = reorderList(g.nodes, want, how, (x) => (x.type === 'badge' ? 1 : 0), () => false);
  const byId = new Map(g.groups.map((x) => [x.id, x]));
  const under = (x, root) => { for (let p = x.parent; p; p = byId.get(p)?.parent) if (p === root) return true; return false; };
  g.groups = sortGroups(reorderList(g.groups, want, how, (x) => (isOverlay(x) ? 1 : 0), under));
  return g;
}

// arr: 그리는 순서(뒤가 앞). 고른 것은 자기 안의 것(under)과 함께 옮긴다. 같은 띠(band)의 다른 것만 건너뛴다.
function reorderList(arr, want, how, band, under) {
  const roots = arr.filter((x) => want.has(x.id) && !arr.some((y) => want.has(y.id) && y !== x && under(x, y.id)));
  if (!roots.length) return arr;
  let list = [...arr];
  const moveOne = (root, how) => {
    const block = list.filter((x) => x === root || under(x, root.id));
    const at = list.indexOf(root);
    const rest = list.filter((x) => !block.includes(x));
    let k = rest.filter((x) => list.indexOf(x) < at).length;   // rest 안에서 root 가 있던 자리
    const same = (x) => band(x) === band(root) && !roots.some((r) => r === x || under(x, r.id));
    if (how === 'front') k = rest.length;
    else if (how === 'back') k = 0;
    else if (how === 'forward') {
      let j = k; while (j < rest.length && !same(rest[j])) j++;
      if (j >= rest.length) return;
      const step = rest[j]; j++;
      while (j < rest.length && under(rest[j], step.id)) j++;   // 그 상자 안의 것도 넘는다
      k = j;
    } else {
      let j = k - 1; while (j >= 0 && !same(rest[j])) j--;
      if (j < 0) return;
      k = j;
    }
    list = [...rest.slice(0, k), ...block, ...rest.slice(k)];
  };
  // 앞으로 보낼 때는 앞쪽 것부터, 뒤로는 뒤쪽 것부터 옮겨야 서로 순서가 유지된다
  const order = [...roots].sort((a, b) => arr.indexOf(a) - arr.indexOf(b));
  if (how === 'front' || how === 'forward') order.reverse();
  if (how === 'front') order.reverse();   // 맨 앞: 원래 순서대로 끝에 붙인다
  if (how === 'back') order.reverse();    // 맨 뒤: 뒤쪽 것부터 0 에 넣는다
  for (const r of order) moveOne(r, how);
  return list;
}

/** 레이어 목록: 실제 그리는 순서 그대로 한 줄 목록(위가 앞). 번호 → 아이콘·글 → 겹치는 상자 → 담는 상자 */
export function layerList(g) {
  const row = (x, kind) => ({ id: x.id, kind, item: x });
  const nodes = [...g.nodes].reverse();
  const groups = [...g.groups].reverse();
  return [
    ...nodes.filter((n) => n.type === 'badge').map((n) => row(n, 'node')),
    ...nodes.filter((n) => n.type !== 'badge').map((n) => row(n, 'node')),
    ...groups.filter((x) => isOverlay(x)).map((x) => row(x, 'group')),
    ...groups.filter((x) => !isOverlay(x)).map((x) => row(x, 'group')),
  ];
}

/** 레이어 목록에서 끌어 놓기: id 를 target 바로 앞(위)에. 같은 띠끼리만, 아니면 그대로(같은 객체) 돌려준다. */
export function placeFront(graph, id, targetId) {
  const isG = (x) => graph.groups.some((y) => y.id === x);
  const band = (x) => (isG(x) ? (isOverlay(graph.groups.find((y) => y.id === x)) ? 'o' : 'c') : (graph.nodes.find((y) => y.id === x)?.type === 'badge' ? 'b' : 'n'));
  if (id === targetId || band(id) !== band(targetId)) return graph;
  const g = structuredClone(graph);
  const key = isG(id) ? 'groups' : 'nodes';
  let arr = g[key];
  const byId = new Map(g.groups.map((x) => [x.id, x]));
  const under = (x, root) => { if (key !== 'groups') return false; for (let p = x.parent; p; p = byId.get(p)?.parent) if (p === root) return true; return false; };
  const item = arr.find((x) => x.id === id), target = arr.find((x) => x.id === targetId);
  if (under(target, id)) return graph;   // 자기 안의 것 앞으로는 못 간다(이미 그 위)
  const block = arr.filter((x) => x === item || under(x, id));
  arr = arr.filter((x) => !block.includes(x));
  let k = arr.indexOf(target) + 1;
  while (k < arr.length && under(arr[k], targetId)) k++;
  arr.splice(k, 0, ...block);
  g[key] = key === 'groups' ? sortGroups(arr) : arr;
  return g;
}
