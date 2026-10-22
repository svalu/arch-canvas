// 그래프 -> SVG 문자열 -> PNG. 캔버스 DOM 을 캡처하지 않고 그래프에서 직접 그리므로 선택 영역/투명 배경/2배 해상도가 정확하다.
// 아이콘은 SVG 원본(data URI)을 <image> 로 넣어서 래스터화해도 선명하다. 좌표 계산은 캔버스/PPT 와 같은 geometry.js.
import { ICON_SIZE, GROUP_ICON_SIZE, LABEL_WIDTH, ICON_LABEL_GAP, LABEL_DROP, sortGroups } from '../model/schema.js';
import { absoluteRects, edgeGeometry, edgePath } from '../model/geometry.js';
import { LABEL_PX, INK, GROUP_LABEL_PAD, groupPaint, drawnIds } from './scene.js';

export const FONT_FAMILY = 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", -apple-system, system-ui, sans-serif';
const LINE_W = 1.5;
const LABEL_LINE_H = LABEL_PX * 1.25;
const EDGE_LABEL_PX = 10.5;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let _ctx = null;
function measure(text, px) {
  if (!_ctx) _ctx = document.createElement('canvas').getContext('2d');
  _ctx.font = `${px}px ${FONT_FAMILY}`;
  return _ctx.measureText(text).width;
}

/** 라벨을 폭에 맞게 최대 maxLines 줄로 나눈다(공백 기준, 긴 단어는 글자로). */
export function wrapText(text, width, px, maxLines = 2) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  const pushWord = (w) => {
    const t = cur ? cur + ' ' + w : w;
    if (measure(t, px) <= width) { cur = t; return; }
    if (cur) { lines.push(cur); cur = ''; }
    if (measure(w, px) <= width) { cur = w; return; }
    let piece = '';
    for (const ch of w) { if (measure(piece + ch, px) > width && piece) { lines.push(piece); piece = ''; } piece += ch; }
    cur = piece;
  };
  for (const w of words) pushWord(w);
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    // 줄임: 마지막 두 글자를 … 로. 코드 포인트 단위라 이모지(서로게이트 쌍)를 반으로 자르지 않는다
    const keep = lines.slice(0, maxLines), chars = Array.from(keep[maxLines - 1]);
    keep[maxLines - 1] = chars.slice(0, Math.max(0, chars.length - 2)).join('') + '…';
    return keep;
  }
  return lines;
}

/**
 * @param include  내보낼 id 집합(null = 전체)
 * @param background 'transparent' | 'white'
 */
export const THEME = {
  light: { bg: '#ffffff', ink: INK, cardBg: '#ffffff', cardBorder: '#cfd6df', cardBody: '#5b6472', edge: INK, labelBg: '#fafbfc' },
  dark: { bg: '#0b1416', ink: '#e6f6f3', cardBg: '#101d20', cardBorder: '#1f3a3a', cardBody: '#8fb3ad', edge: '#7fe3d6', labelBg: '#101d20' },
};

export function graphToSvg(graph, catalog, include = null, { background = 'transparent', padding = 24, textScale = 1 } = {}) {
  const T = THEME[graph.theme] || THEME.light;
  const S = textScale;
  const LABEL_PX_S = LABEL_PX * S, LABEL_LINE_H_S = LABEL_LINE_H * S, EDGE_LABEL_PX_S = EDGE_LABEL_PX * S;
  const rects = absoluteRects(graph);
  const has = (id) => !include || include.has(id);
  const labeled = new Set(graph.nodes.filter((n) => n.type !== 'card' && n.label && catalog.icons.has(n.icon)).map((n) => n.id));
  const groups = sortGroups(graph.groups).filter((g) => has(g.id));
  const cards = graph.nodes.filter((n) => has(n.id) && n.type === 'card');
  const nodes = graph.nodes.filter((n) => has(n.id) && n.type !== 'card' && catalog.icons.has(n.icon));
  const drawn = drawnIds(graph, catalog);   // 아이콘을 모르는 노드로 가는 선은 빼서 끊긴 선이 남지 않게
  const edges = graph.edges.filter((e) => has(e.id) && has(e.source) && has(e.target) && drawn.has(e.source) && drawn.has(e.target) && rects.has(e.source) && rects.has(e.target));

  // 범위
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y, w, h) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); };
  for (const g of groups) { const r = rects.get(g.id); grow(r.x, r.y, r.w, r.h); }
  for (const n of nodes) { const r = rects.get(n.id); grow(r.x - (LABEL_WIDTH - ICON_SIZE) / 2, r.y, LABEL_WIDTH, ICON_SIZE + (n.label ? LABEL_DROP : 0)); }
  for (const c of cards) { const r = rects.get(c.id); grow(r.x, r.y, r.w, r.h); }
  const texts = graph.nodes.filter((n) => has(n.id) && (n.type === 'text' || n.type === 'badge'));
  for (const c of texts) { const r = rects.get(c.id); grow(r.x, r.y, r.w, r.h); }
  const edgeGeos = edges.map((e) => {
    const geo = edgeGeometry(rects.get(e.source), rects.get(e.target), labeled.has(e.source) ? LABEL_DROP : 0, labeled.has(e.target) ? LABEL_DROP : 0);
    const path = edgePath(geo, e.shape);
    grow(Math.min(geo.p1.x, geo.p2.x), Math.min(geo.p1.y, geo.p2.y), Math.abs(geo.p1.x - geo.p2.x), Math.abs(geo.p1.y - geo.p2.y));
    return { e, geo, path };
  });
  if (!Number.isFinite(x0)) return { svg: '', width: 0, height: 0 };
  x0 -= padding; y0 -= padding; x1 += padding; y1 += padding;
  const width = Math.ceil(x1 - x0), height = Math.ceil(y1 - y0);
  const X = (v) => +(v - x0).toFixed(1), Y = (v) => +(v - y0).toFixed(1);

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family='${FONT_FAMILY.replace(/'/g, '')}'>`);
  out.push(`<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${T.edge}"/></marker></defs>`);
  // 다크 테마는 반투명 섹션이 배경에 기대므로 항상 다크 배경을 깐다. 라이트는 선택(투명/흰색).
  if (graph.theme === 'dark') out.push(`<rect width="${width}" height="${height}" fill="${T.bg}"/>`);
  else if (background === 'white') out.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);

  // 그룹 (섹션 덮어쓰기 반영)
  for (const g of groups) {
    const base = catalog.kinds.get(g.kind) || catalog.kinds.get('generic');
    const kind = { ...base, color: g.color || base.color, text: g.color || base.text, line: g.line || base.line, fill: 'fill' in g ? g.fill : base.fill };
    const r = rects.get(g.id);
    const icon = base.icon ? catalog.icons.get(base.icon) : null;
    const paint = groupPaint(kind, graph.theme === 'dark', g.kind === 'section');
    const stroke = kind.line === 'none' ? 'none' : paint.stroke;   // 다크는 화면과 같은 섞은 색, 채움 없는 그룹은 투명
    const fill = paint.fill || 'none';
    out.push(`<rect x="${X(r.x)}" y="${Y(r.y)}" width="${r.w}" height="${r.h}" rx="${g.kind === 'section' ? 8 : 0}" fill="${fill}" stroke="${stroke}" stroke-width="${LINE_W}"${kind.line === 'dashed' ? ' stroke-dasharray="6 4"' : ''}/>`);
    if (icon) out.push(`<image x="${X(r.x)}" y="${Y(r.y)}" width="${GROUP_ICON_SIZE}" height="${GROUP_ICON_SIZE}" href="${icon.src}"/>`);
    if (g.label) {
      const lx = r.x + (icon ? GROUP_LABEL_PAD.iconL : GROUP_LABEL_PAD.plainL), ly = r.y + (icon ? GROUP_LABEL_PAD.iconT : GROUP_LABEL_PAD.plainT);
      out.push(`<text x="${X(lx)}" y="${Y(ly)}" dominant-baseline="hanging" font-size="${LABEL_PX_S}" font-weight="500" fill="${paint.text}">${esc(g.label)}</text>`);
    }
  }
  // 연결선
  for (const { e, path } of edgeGeos) {
    const markers = (e.arrow !== 'none' ? ' marker-end="url(#arr)"' : '') + (e.arrow === 'both' ? ' marker-start="url(#arr)"' : '');
    const shifted = shiftPath(path.d, -x0, -y0);
    out.push(`<path d="${shifted}" fill="none" stroke="${T.edge}" stroke-width="${LINE_W}"${e.line === 'dashed' ? ' stroke-dasharray="6 4"' : ''}${markers}/>`);
  }
  // 카드: 둥근 사각형 + (아이콘) + 제목 + 설명
  for (const c of cards) {
    const r = rects.get(c.id);
    const icon = c.icon ? catalog.icons.get(c.icon) : null;
    out.push(`<rect x="${X(r.x)}" y="${Y(r.y)}" width="${r.w}" height="${r.h}" rx="10" fill="${T.cardBg}" stroke="${c.accent || T.cardBorder}" stroke-width="${LINE_W}"/>`);
    const padL = 12, padT = 10, iconW = icon ? 42 : 0;
    if (icon) out.push(`<image x="${X(r.x + padL)}" y="${Y(r.y + padT)}" width="32" height="32" href="${icon.src}"/>`);
    const tx = X(r.x + padL + iconW), tw = r.w - padL * 2 - iconW;
    const titleLines = wrapText(c.label || '', tw, 12.5 * S, 2);
    titleLines.forEach((ln, i) => out.push(`<text x="${tx}" y="${Y(r.y + padT + i * 15.5 * S)}" dominant-baseline="hanging" font-size="${12.5 * S}" font-weight="600" fill="${T.ink}">${esc(ln)}</text>`));
    if (c.body) {
      const maxLines = Math.max(0, Math.floor((r.h - padT * 2 - titleLines.length * 15.5 * S - 3) / (14.5 * S)));
      const bodyLines = c.body.split('\n').flatMap((p) => wrapText(p, tw, 10.5 * S, 99)).slice(0, maxLines);
      bodyLines.forEach((ln, i) => out.push(`<text x="${tx}" y="${Y(r.y + padT + titleLines.length * 15.5 * S + 3 + i * 14.5 * S)}" dominant-baseline="hanging" font-size="${10.5 * S}" fill="${T.cardBody}">${esc(ln)}</text>`));
    }
  }
  // 글상자 · 번호 배지 (아이콘 위에 그린다: 아래 아이콘 라벨 블록 뒤로 옮기지 않아도 번호가 가려지지 않게 맨 끝에 다시 그림)
  const TEXT_PX = { sm: 11, md: 13, lg: 16, xl: 22 };
  const drawTexts = () => {
    for (const c of texts) {
      const r = rects.get(c.id);
      if (c.type === 'text') {
        const px = (TEXT_PX[c.size] || 13) * S, lh = px * 1.35;
        const lines = String(c.label || '').split('\n').flatMap((p) => wrapText(p, r.w - 4, px, 99)).slice(0, Math.max(1, Math.floor(r.h / lh)));
        lines.forEach((ln, i) => out.push(`<text x="${X(r.x + 2)}" y="${Y(r.y + 2 + i * lh)}" dominant-baseline="hanging" font-size="${px}"${c.bold ? ' font-weight="700"' : ''} fill="${c.accent || T.ink}">${esc(ln)}</text>`));
      } else {
        const rad = Math.min(r.w, r.h) / 2, cx = X(r.x + r.w / 2), cy = Y(r.y + r.h / 2);
        out.push(`<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${c.accent || (graph.theme === 'dark' ? '#2DD4BF' : INK)}"/>`);
        out.push(`<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${(rad * 1.0).toFixed(1)}" font-weight="700" fill="${graph.theme === 'dark' && !c.accent ? '#06201D' : '#ffffff'}">${esc(String(c.label || '1'))}</text>`);
      }
    }
  };
  // 아이콘 + 라벨
  for (const n of nodes) {
    const r = rects.get(n.id);
    out.push(`<image x="${X(r.x)}" y="${Y(r.y)}" width="${ICON_SIZE}" height="${ICON_SIZE}" href="${catalog.icons.get(n.icon).src}"/>`);
    if (n.label) {
      const lines = wrapText(n.label, LABEL_WIDTH, LABEL_PX_S);
      const cx = X(r.x + ICON_SIZE / 2), top = Y(r.y + ICON_SIZE + ICON_LABEL_GAP);
      lines.forEach((ln, i) => out.push(`<text x="${cx}" y="${+(top + i * LABEL_LINE_H_S).toFixed(1)}" text-anchor="middle" dominant-baseline="hanging" font-size="${LABEL_PX_S}" fill="${T.ink}">${esc(ln)}</text>`));
    }
  }
  // 연결선 라벨 (맨 위)
  for (const { e, path } of edgeGeos) {
    if (!e.label) continue;
    const w = measure(e.label, EDGE_LABEL_PX_S) + 10, h = EDGE_LABEL_PX_S + 6;
    const mx = X(path.mid.x), my = Y(path.mid.y);
    out.push(`<rect x="${+(mx - w / 2).toFixed(1)}" y="${+(my - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="3" fill="${graph.theme === 'dark' ? T.labelBg : background === 'white' ? '#ffffff' : '#fafbfc'}" stroke="${T.cardBorder}" stroke-width="1"/>`);
    out.push(`<text x="${mx}" y="${my}" text-anchor="middle" dominant-baseline="central" font-size="${EDGE_LABEL_PX_S}" fill="${T.ink}">${esc(e.label)}</text>`);
  }
  drawTexts();
  out.push('</svg>');
  return { svg: out.join('\n'), width, height };
}

// "M x y L x y C x y x y x y" 형태의 경로를 평행이동
function shiftPath(d, dx, dy) {
  const t = d.trim().split(/\s+/);
  const out = [];
  let i = 0;
  while (i < t.length) {
    if (/^[A-Za-z]$/.test(t[i])) { out.push(t[i]); i++; continue; }
    out.push(+(parseFloat(t[i]) + dx).toFixed(1), +(parseFloat(t[i + 1]) + dy).toFixed(1));
    i += 2;
  }
  return out.join(' ');
}

export function svgToBlob(svg) { return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }); }

/** SVG 문자열을 PNG Blob 으로. scale=2 면 2배 해상도. */
export function svgToPng(svg, width, height, scale = 2) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(svgToBlob(svg));
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = Math.round(width * scale); c.height = Math.round(height * scale);
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 변환 실패'))), 'image/png');
      } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG 를 그리지 못했습니다')); };
    img.src = url;
  });
}

// blobOrPromise: 사파리는 클릭 직후에 ClipboardItem 을 만들어야 해서, 아직 만드는 중인 PNG(Promise)를 그대로 넘긴다
export async function copyPngToClipboard(blobOrPromise) {
  if (!navigator.clipboard || !window.ClipboardItem) throw new Error('이 브라우저는 이미지 클립보드 복사를 지원하지 않습니다');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': Promise.resolve(blobOrPromise) })]);
}

export async function saveBlob(blob, file) {
  if (window.desktop?.save) { await window.desktop.save(new Uint8Array(await blob.arrayBuffer()), file); return 'downloads'; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  return 'browser';
}
