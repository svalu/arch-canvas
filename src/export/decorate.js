// 내보낼 그림에 제목·범례·여백·16:9 를 덧붙인다. 원래 SVG 는 그대로 안쪽에 넣는다(중첩 svg).
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const EXPORT_DEFAULT = { scale: 2, background: 'transparent', padding: 24, title: false, titleText: '', legend: false, legendSolid: '데이터 흐름', legendDashed: '보조·관리 경로', aspect: 'fit' };

/** 이 그래프에 실제로 쓰인 선 종류 */
export function usedLineStyles(graph) {
  return { solid: graph.edges.some((e) => e.line !== 'dashed'), dashed: graph.edges.some((e) => e.line === 'dashed') };
}

/**
 * @param r   graphToSvg 결과 { svg, width, height }
 * @param opt EXPORT_DEFAULT 모양
 */
export function decorateSvg(r, graph, opt) {
  if (!r?.svg) return r;
  const dark = graph.theme === 'dark';
  const ink = dark ? '#e6f6f3' : '#232f3e', muted = dark ? '#8fb3ad' : '#5b6472', edge = dark ? '#7fe3d6' : '#232f3e';
  const font = "Pretendard, 'Malgun Gothic', 'Segoe UI', sans-serif";
  const titleH = opt.title && opt.titleText.trim() ? 40 : 0;
  const used = usedLineStyles(graph);
  const items = opt.legend ? [used.solid && ['solid', opt.legendSolid], used.dashed && ['dashed', opt.legendDashed]].filter(Boolean) : [];
  const legendH = items.length ? 30 : 0;
  let W = r.width, H = r.height + titleH + legendH;
  // 16:9 맞춤: 모자란 쪽에 여백을 더해 가운데 둔다
  let ox = 0, oy = titleH;
  if (opt.aspect === '16:9') {
    const want = 16 / 9;
    if (W / H < want) { const nw = Math.ceil(H * want); ox = Math.round((nw - W) / 2); W = nw; }
    else { const nh = Math.ceil(W / want); oy += Math.round((nh - H) / 2); H = nh; }
  }
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${font}">`);
  if (dark) out.push(`<rect width="${W}" height="${H}" fill="#0b1416"/>`);
  else if (opt.background === 'white') out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  if (titleH) out.push(`<text x="${ox + 24}" y="${oy - titleH + 26}" font-size="20" font-weight="700" fill="${ink}">${esc(opt.titleText.trim())}</text>`);
  out.push(r.svg.replace(/^<svg /, `<svg x="${ox}" y="${oy}" `));
  if (items.length) {
    let x = ox + 24; const y = oy + r.height + 14;
    for (const [kind, label] of items) {
      out.push(`<line x1="${x}" y1="${y}" x2="${x + 32}" y2="${y}" stroke="${edge}" stroke-width="1.5"${kind === 'dashed' ? ' stroke-dasharray="5 4"' : ''}/>`);
      out.push(`<path d="M${x + 32} ${y - 4} L${x + 39} ${y} L${x + 32} ${y + 4} z" fill="${edge}"/>`);
      out.push(`<text x="${x + 46}" y="${y}" dominant-baseline="central" font-size="12" fill="${muted}">${esc(label)}</text>`);
      x += 46 + Math.max(60, String(label).length * 12) + 24;
    }
  }
  out.push('</svg>');
  return { ...r, svg: out.join(''), width: W, height: H };
}
