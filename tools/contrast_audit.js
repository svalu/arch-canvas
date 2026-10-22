// 브라우저 콘솔(개발 서버)에서 실행하는 글자 대비 검사. window.__audit(label) → 문제 목록
// 1) 보이는 글자: 글자색 vs 실제 배경(투명이면 부모로, 그라데이션은 첫 색) 대비 < 4.5 (큰 글자 3)
// 2) :hover 규칙: 규칙이 바꾸는 배경/글자색으로 계산한 대비 (지금 화면에 있는 요소에 대해)
(function () {
  const parse = (c) => { if (!c) return null; const m = c.match(/rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; } const h = c.match(/#([0-9a-f]{6})/i); if (h) { const v = h[1]; return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16), a: 1 }; } const cm = c.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/); if (cm) return { r: cm[1] * 255, g: cm[2] * 255, b: cm[3] * 255, a: cm[4] != null ? +cm[4] : 1 }; return null; };
  const lum = ({ r, g, b }) => [r, g, b].map((v) => v / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
  const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const bgOf = (el, override) => {
    const layers = [];
    for (let e = el, first = true; e; e = e.parentElement, first = false) {
      const cs = getComputedStyle(e);
      let c = first && override ? override : (cs.backgroundImage !== 'none' && /gradient/.test(cs.backgroundImage) ? parse(cs.backgroundImage) : parse(cs.backgroundColor));
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let out = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) out = blend(layers[i], out);
    return out;
  };
  const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false; for (let e = el; e; e = e.parentElement) if (+getComputedStyle(e).opacity < 0.2) return false; return true; };
  const desc = (el) => (el.className && typeof el.className === 'string' ? el.tagName.toLowerCase() + '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : el.tagName.toLowerCase());
  window.__audit = function (label) {
    const issues = [];
    const seen = new Set();
    // 1) 정적 글자
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.react-flow__minimap, svg, #pngview')) continue;
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const isInput = el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]), textarea');
      if ((!hasText && !isInput) || !visible(el)) continue;
      const cs = getComputedStyle(el);
      if (el.matches(':disabled') || el.closest(':disabled')) continue;
      const fg = parse(cs.color); if (!fg) continue;
      const bg = bgOf(el);
      const big = parseFloat(cs.fontSize) >= 18.66 || (parseFloat(cs.fontSize) >= 14 && +cs.fontWeight >= 600);
      const need = big ? 3 : 4.5;
      const r = ratio(blend(fg, bg), bg);
      const text = (isInput ? el.value || el.placeholder : el.textContent).trim().slice(0, 30);
      if (r < need) { const k = desc(el) + text; if (!seen.has(k)) { seen.add(k); issues.push({ label, kind: 'text', el: desc(el), text, ratio: +r.toFixed(2), need }); } }
      if (isInput && el.placeholder && !el.value) {
        const pc = parse(getComputedStyle(el, '::placeholder').color);
        if (pc) { const pr = ratio(blend(pc, bg), bg); if (pr < 3) issues.push({ label, kind: 'placeholder', el: desc(el), text: el.placeholder.slice(0, 30), ratio: +pr.toFixed(2), need: 3 }); }
      }
    }
    // 2) :hover 규칙
    const dark = !!document.querySelector('.app.theme-dark');
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      const walk = (list) => { for (const rule of list) {
        if (rule.cssRules && !rule.selectorText) { walk(rule.cssRules); continue; }
        if (!rule.selectorText || !rule.selectorText.includes(':hover')) continue;
        const st = rule.style; const bgDecl = st.backgroundColor || st.background || ''; const colDecl = st.color || '';
        if (!bgDecl && !colDecl) continue;
        for (const sel of rule.selectorText.split(',')) {
          if (!sel.includes(':hover')) continue;
          if (/theme-dark/.test(sel) !== dark && /theme-dark/.test(sel)) continue;
          const base = sel.replace(/:hover/g, '').trim();
          let els; try { els = document.querySelectorAll(base); } catch { continue; }
          for (const el of els) {
            if (!visible(el) || el.matches(':disabled')) continue;
            const hasText = [...el.querySelectorAll('*'), el].some((x) => [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
            if (!hasText) continue;
            const ov = bgDecl ? parse(bgDecl) : null;
            const bg = bgOf(el, ov && ov.a > 0 ? ov : null);
            const textEl = [el, ...el.querySelectorAll('*')].find((x) => [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) || el;
            const fg = parse(colDecl) || parse(getComputedStyle(textEl).color);
            if (!fg) continue;
            const r = ratio(blend(fg, bg), bg);
            if (r < 4.5) { const k = 'hover' + sel + desc(el); if (!seen.has(k)) { seen.add(k); issues.push({ label, kind: 'hover', sel: sel.trim(), el: desc(el), text: el.textContent.trim().slice(0, 24), ratio: +r.toFixed(2), need: 4.5 }); } }
            break;
          }
        }
      } };
      walk(rules);
    }
    return issues;
  };
})();
