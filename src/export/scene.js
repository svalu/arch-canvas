// 그래프 -> PowerPoint 장면(scene). 모든 값은 EMU, 순서가 곧 z-순서다.
// 호스트(EXE)의 PptClipboard.CopyScene 이 이 장면을 Art::GVML ClipFormat 패키지(DrawingML lockedCanvas)로 만든다.
//
// 크기 기준: 아이콘 48px = 1.5cm = 540000 EMU (Icon Shelf 단일 복사와 같은 크기) -> 1px = 11250 EMU.
//
// scene = { version, emuPerPx, width, height, media: { key: svgBase64 }, shapes: [...] }
//   rect { t:'rect', id, name, x, y, w, h, line:{color,w,dash}|null, fill:color|null, text }
//   pic  { t:'pic',  id, name, x, y, w, h, media }
//   text { t:'text', id, name, x, y, w, h, text }
//   cxn  { t:'cxn',  id, name, x, y, w, h, rot, flipH, flipV, prst, st:{id,idx}|null, end:{id,idx}|null, line, head, tail }
//   text = { value, sz(1/100pt), color, bold, align:'l'|'ctr', anchor:'t'|'ctr', wrap:'square'|'none', l, t, r, b(EMU) }

import { ICON_SIZE, GROUP_ICON_SIZE, LABEL_WIDTH, ICON_LABEL_GAP, ICON_LABEL_H, LABEL_DROP, sortGroups } from '../model/schema.js';
import { absoluteRects, descendants, edgeGeometry, SIDE_IDX } from '../model/geometry.js';
export { ICON_LABEL_GAP, ICON_LABEL_H };

export const EMU_PER_PX = 11250;
export const LABEL_PT = 10.5;                                   // 아이콘/그룹 라벨 글자 크기
export const LABEL_PX = (LABEL_PT * 12700) / EMU_PER_PX;        // 캔버스에서 같은 크기로 보이게 하는 px (약 11.85)
export const LINE_EMU = 12700;                                  // 1pt
export const LINE_PX = LINE_EMU / EMU_PER_PX;
export const INK = '#232F3E';                                   // AWS squid ink (라벨/연결선)
export const GROUP_LABEL_PAD = { iconL: GROUP_ICON_SIZE + 8, plainL: 10, iconT: 9, plainT: 6 };

const E = (px) => Math.round(px * EMU_PER_PX);

/** 두 #RRGGBB 색을 채널별로 섞는다: t*a + (1-t)*b (CSS color-mix(in srgb, a t, b) 와 같음). */
export function mixHex(a, b, t) {
  const rgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
  const A = rgb(a), B = rgb(b);
  if (!A || !B) return a;
  return '#' + A.map((v, i) => Math.round(t * v + (1 - t) * B[i]).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// 다크 테마 그룹: 화면(nodes.jsx)과 같은 섞음. 채움 있는 그룹 = 테두리색 14% + #101d20, 글자 = 테두리색 55% + #e6f6f3
export const DARK_BG = '#101D20', DARK_INK = '#E6F6F3';
export function groupPaint(kind, dark) {
  if (!dark) return { fill: kind.fill || null, text: kind.text };
  return { fill: kind.fill ? mixHex(kind.color, DARK_BG, 0.14) : null, text: mixHex(kind.color, DARK_INK, 0.55) };
}

/** 실제로 그려지는 항목 id (아이콘을 모르는 노드는 빠진다). 양 끝이 다 그려지는 연결선만 내보낸다. */
export function drawnIds(graph, catalog) {
  return new Set([...graph.groups.map((x) => x.id), ...graph.nodes.filter((n) => n.type === 'card' || n.type === 'text' || n.type === 'badge' || catalog.icons.has(n.icon)).map((n) => n.id)]);
}

/** 선택 복사용: 고른 항목 + 고른 그룹 안의 모든 것, 그리고 양 끝이 모두 들어간 엣지만 남긴 id 집합. */
export function selectionIds(graph, selected) {
  const keep = new Set();
  for (const id of selected) {
    keep.add(id);
    for (const d of descendants(graph, id)) keep.add(d);
    const e = graph.edges.find((x) => x.id === id);   // 엣지만 골랐으면 양 끝도 같이
    if (e) { keep.add(e.source); keep.add(e.target); }
  }
  for (const e of graph.edges) {
    if (keep.has(e.source) && keep.has(e.target)) keep.add(e.id);
  }
  return keep;
}

/**
 * @param graph   그래프
 * @param catalog { icons: Map<key,{src,name}>, kinds: Map<id,kind> }
 * @param include 내보낼 id 집합(없으면 전체)
 */
export function graphToScene(graph, catalog, include = null, { textScale = 1 } = {}) {
  const rects = absoluteRects(graph);
  const sz = (pt100) => Math.round(pt100 * textScale);   // 글자 크기(1/100pt)에 배율
  const has = (id) => !include || include.has(id);
  const shapes = [];
  const media = {};
  const useMedia = (key) => {
    const ic = catalog.icons.get(key);
    if (!ic) return null;
    if (!media[key]) media[key] = ic.src.slice(ic.src.indexOf(',') + 1);
    return key;
  };

  const dark = graph.theme === 'dark';
  const inkColor = dark ? '#E6F6F3' : INK, edgeColor = dark ? '#7FE3D6' : INK;
  // 1) 그룹: 배열 순서가 그리는 순서(부모 -> 자식, 뒤 형제가 위). 사각형 + 왼쪽 위 그룹 아이콘
  const groups = sortGroups(graph.groups).filter((x) => has(x.id));
  for (const grp of groups) {
    const base = catalog.kinds.get(grp.kind) || catalog.kinds.get('generic');
    const kind = { ...base, color: grp.color || base.color, text: grp.color || base.text, line: grp.line || base.line, fill: 'fill' in grp ? grp.fill : base.fill };
    const r = rects.get(grp.id);
    const withIcon = !!base.icon && catalog.icons.has(base.icon);
    const paint = groupPaint(kind, dark);
    shapes.push({
      t: 'rect', id: grp.id, name: `${kind.name}: ${grp.label || ''}`.trim(),
      x: E(r.x), y: E(r.y), w: E(r.w), h: E(r.h),
      line: kind.line === 'none' ? null : { color: kind.color, w: LINE_EMU, dash: kind.line === 'dashed' ? 'dash' : null },
      fill: paint.fill,
      text: {
        value: grp.label || '', sz: sz(LABEL_PT * 100), color: paint.text, bold: false, align: 'l', anchor: 't', wrap: 'square',
        l: E(withIcon ? GROUP_LABEL_PAD.iconL : GROUP_LABEL_PAD.plainL), t: E(withIcon ? GROUP_LABEL_PAD.iconT : GROUP_LABEL_PAD.plainT),
        r: E(8), b: E(6),
      },
    });
    if (withIcon) {
      shapes.push({ t: 'pic', id: grp.id + '#icon', name: kind.name, x: E(r.x), y: E(r.y), w: E(GROUP_ICON_SIZE), h: E(GROUP_ICON_SIZE), media: useMedia(base.icon) });
    }
  }

  // 1b) 카드: 둥근 사각형(제목 + 설명) + 아이콘
  for (const c of graph.nodes) {
    if (c.type !== 'card' || !has(c.id)) continue;
    const r = rects.get(c.id);
    const icon = c.icon && catalog.icons.has(c.icon) ? c.icon : null;
    shapes.push({
      t: 'rect', id: c.id, name: c.label || '카드', x: E(r.x), y: E(r.y), w: E(r.w), h: E(r.h), prst: 'roundRect',
      line: { color: c.accent || (dark ? '#1F3A3A' : '#CFD6DF'), w: LINE_EMU, dash: null },
      fill: dark ? '#101D20' : '#FFFFFF',
      text: { value: (c.label || '') + (c.body ? '\n' + c.body : ''), sz: sz(1050), color: inkColor, bold: true, boldFirstLineOnly: true, bodyColor: dark ? '#8FB3AD' : '#5B6472', bodySz: sz(900), align: 'l', anchor: 't', wrap: 'square',
        l: E(12 + (icon ? 42 : 0)), t: E(9), r: E(10), b: E(8) },
    });
    if (icon) shapes.push({ t: 'pic', id: c.id + '#icon', name: catalog.icons.get(icon).name, x: E(r.x + 12), y: E(r.y + 10), w: E(32), h: E(32), media: useMedia(icon) });
  }

  // 2) 연결선: 그룹 위, 아이콘 아래. 아이콘의 아래 면으로 나갈 때는 라벨 글상자 밑에 붙인다.
  const labeled = new Map(graph.nodes.filter((n) => n.type !== 'card' && n.label && catalog.icons.has(n.icon)).map((n) => [n.id, true]));
  const edgeLabels = [];
  const drawn = drawnIds(graph, catalog);
  for (const e of graph.edges) {
    if (!has(e.id) || !has(e.source) || !has(e.target) || !drawn.has(e.source) || !drawn.has(e.target)) continue;
    const a = rects.get(e.source), b = rects.get(e.target);
    if (!a || !b) continue;
    const geo = edgeGeometry(a, b, labeled.has(e.source) ? LABEL_DROP : 0, labeled.has(e.target) ? LABEL_DROP : 0);
    const anchor = (id, side) => ({ id: side === 'b' && labeled.has(id) ? id + '#label' : id, idx: SIDE_IDX[side] });
    shapes.push({
      t: 'cxn', id: e.id, name: e.label ? `연결: ${e.label}` : '연결선',
      ...connectorXfrm(geo, e.shape),
      st: anchor(e.source, geo.s),
      end: anchor(e.target, geo.t),
      line: { color: edgeColor, w: LINE_EMU, dash: e.line === 'dashed' ? 'dash' : null },
      head: e.arrow === 'both' ? 'triangle' : 'none',
      tail: e.arrow === 'none' ? 'none' : 'triangle',
    });
    if (e.label) {
      const mx = (geo.p1.x + geo.p2.x) / 2, my = (geo.p1.y + geo.p2.y) / 2;
      edgeLabels.push({
        t: 'text', id: e.id + '#label', name: e.label, x: E(mx - 50), y: E(my - 18), w: E(100), h: E(16),
        text: { value: e.label, sz: sz(900), color: inkColor, bold: false, align: 'ctr', anchor: 'ctr', wrap: 'square', l: 0, t: 0, r: 0, b: 0 },
      });
    }
  }

  // 3) 아이콘 + 아래 라벨
  for (const n of graph.nodes) {
    if (!has(n.id) || n.type === 'card') continue;
    const r = rects.get(n.id);
    const key = useMedia(n.icon);
    if (!key) continue;
    shapes.push({ t: 'pic', id: n.id, name: n.label || catalog.icons.get(n.icon).name, x: E(r.x), y: E(r.y), w: E(ICON_SIZE), h: E(ICON_SIZE), media: key });
    if (n.label) {
      shapes.push({
        t: 'text', id: n.id + '#label', name: n.label,
        x: E(r.x + ICON_SIZE / 2 - LABEL_WIDTH / 2), y: E(r.y + ICON_SIZE + ICON_LABEL_GAP), w: E(LABEL_WIDTH), h: E(ICON_LABEL_H),
        text: { value: n.label, sz: sz(LABEL_PT * 100), color: inkColor, bold: false, align: 'ctr', anchor: 't', wrap: 'square', l: 0, t: 0, r: 0, b: 0 },
      });
    }
  }
  // 3b) 글상자 · 번호 배지
  const TEXT_PT = { sm: 825, md: 975, lg: 1200, xl: 1650 };
  for (const n of graph.nodes) {
    if (!has(n.id) || (n.type !== 'text' && n.type !== 'badge')) continue;
    const r = rects.get(n.id);
    if (n.type === 'text') {
      shapes.push({ t: 'text', id: n.id, name: (n.label || '텍스트').slice(0, 40), x: E(r.x), y: E(r.y), w: E(r.w), h: E(r.h),
        text: { value: n.label || '', sz: sz(TEXT_PT[n.size] || 975), color: n.accent || inkColor, bold: !!n.bold, align: 'l', anchor: 't', wrap: 'square', l: 0, t: 0, r: 0, b: 0 } });
    } else {
      const fill = n.accent || (dark ? '#2DD4BF' : INK);
      shapes.push({ t: 'rect', id: n.id, name: '번호 ' + (n.label || '1'), x: E(r.x), y: E(r.y), w: E(r.w), h: E(r.h), prst: 'ellipse',
        line: null, fill,
        text: { value: String(n.label || '1'), sz: sz(Math.round(r.h * 0.5 * 75)), color: dark && !n.accent ? '#06201D' : '#FFFFFF', bold: true, align: 'ctr', anchor: 'ctr', wrap: 'none', l: 0, t: 0, r: 0, b: 0 } });
    }
  }
  shapes.push(...edgeLabels);

  // 왼쪽 위를 0,0 으로
  if (!shapes.length) return { version: 1, emuPerPx: EMU_PER_PX, width: 0, height: 0, media, shapes };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    const [x0, y0, x1, y1] = bbox(s);
    minX = Math.min(minX, x0); minY = Math.min(minY, y0); maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1);
  }
  for (const s of shapes) { s.x -= minX; s.y -= minY; }
  return { version: 1, emuPerPx: EMU_PER_PX, width: maxX - minX, height: maxY - minY, media, shapes };
}

// 회전된 연결선은 화면상 상자가 가로세로 바뀐다.
function bbox(s) {
  if (s.rot) {
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    return [cx - s.h / 2, cy - s.w / 2, cx + s.h / 2, cy + s.w / 2];
  }
  return [s.x, s.y, s.x + s.w, s.y + s.h];
}

/**
 * 연결선 xfrm. PowerPoint 가 직접 만든 GVML 과 같은 방식:
 * - 직선: straightConnector1, 상자 = 두 끝점을 감싸는 사각형, 끝점이 왼쪽/위면 flipH/flipV.
 * - 꺾은선(가로 시작): bentConnector3 그대로.
 * - 꺾은선(세로 시작): bentConnector3 를 90도 돌린다(rot=5400000). 이때 상자의 가로세로가 바뀌고
 *   시작점이 왼쪽 위로 오려면 flipV = (dx>0), flipH = (dy<0).
 */
export function connectorXfrm(geo, shape) {
  const { p1, p2, horizontal } = geo;
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const bent = (shape === 'elbow' || shape === 'curve') && Math.abs(dx) >= 1 && Math.abs(dy) >= 1;
  const prst = shape === 'curve' ? 'curvedConnector3' : 'bentConnector3';
  const box = { x: E(Math.min(p1.x, p2.x)), y: E(Math.min(p1.y, p2.y)), w: E(Math.abs(dx)), h: E(Math.abs(dy)) };
  if (!bent) return { ...box, rot: 0, flipH: dx < 0, flipV: dy < 0, prst: 'straightConnector1' };
  if (horizontal) return { ...box, rot: 0, flipH: dx < 0, flipV: dy < 0, prst };
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  return {
    x: Math.round(cx - box.h / 2), y: Math.round(cy - box.w / 2), w: box.h, h: box.w,
    rot: 5400000, flipH: dy < 0, flipV: dx > 0, prst,
  };
}

/** 장면 요약(검증용): 종류별 개수. */
export function sceneStats(scene) {
  const c = { rect: 0, pic: 0, text: 0, cxn: 0 };
  for (const s of scene.shapes) c[s.t]++;
  return c;
}
