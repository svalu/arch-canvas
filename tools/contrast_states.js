// 개발 서버에서: await window.__auditAll()  → 라이트/다크 × 여러 화면 상태에서 __audit 실행 결과를 모은다.
// 저장 데이터는 시작 때 백업하고 끝나면 되돌린다.
(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const esc = () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); };
  const clickText = (sel, t) => qa(sel).find((b) => b.textContent.trim().startsWith(t))?.click();
  window.__auditAll = async function () {
    const A = window.__arch;
    const bk = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('arch-canvas:')) bk[k] = localStorage.getItem(k); }
    const all = [];
    const run = async (label, setup, teardown) => { try { await setup?.(); await sleep(450); all.push(...window.__audit(label)); } catch (e) { all.push({ label, kind: 'error', text: String(e.message || e) }); } try { await teardown?.(); } catch { /* */ } await sleep(200); };
    try {
      q('.tour') && esc(); await sleep(200);
      q('.doctab-add').click(); await sleep(300);
      for (const theme of ['light', 'dark']) {
        A.loadTemplate('three-tier-web'); await sleep(500);
        { const g = A.graph(); g.theme = theme; A.load(g); } await sleep(1200);   // 테마 전환 페이드(0.55s)가 끝난 뒤 검사
        const T = (s) => `${theme}:${s}`;
        await run(T('default'));
        await run(T('settings'), () => q('details.settings > summary').click(), () => window.__closeMenus?.());
        await run(T('template-menu'), () => q('details.menu > summary').click(), () => window.__closeMenus?.());
        await run(T('export-menu'), () => q('details.split-more > summary').click(), () => window.__closeMenus?.());
        await run(T('export-dialog'), async () => { q('details.split-more > summary').click(); await sleep(150); clickText('.split-more .menu-list button', '내보내기 설정'); }, esc);
        await run(T('ai-panel'), () => q('.tour-ai')?.click(), () => q('.tour-ai')?.click());
        await run(T('rules-panel'), () => q('.tour-rules').click(), () => q('.tour-rules').click());
        await run(T('help-panel'), () => clickText('.top button', '') || qa('.top .tb.ic-only').find((b) => b.getAttribute('aria-label')?.includes('도움'))?.click(), esc);
        await run(T('guide-panel'), () => q('.tour-guide').click(), () => q('.tour-guide').click());
        await run(T('connect-modal'), () => q('.ai-chip')?.click(), esc);
        await run(T('find-bar'), () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true })), () => q('.findbar input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        await run(T('node-selected+askbar'), () => A.select(['alb']), null);
        await run(T('askbar-open'), () => q('button.askbar')?.click(), () => qa('.askbar.open button').find((b) => b.textContent.trim() === '닫기')?.click());
        await run(T('multi-select'), () => A.select(['web-a', 'web-b', 'alb']), null);
        await run(T('node-ctx'), () => { const el = q('.react-flow__node-awsIcon'); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 })); }, esc);
        await run(T('pane-ctx'), () => q('.react-flow__pane').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 500, clientY: 500 })), esc);
        await run(T('rule-toast'), () => A.patch([{ op: 'add_node', id: 'dbx', icon: 'Res_Amazon-Aurora_Amazon-RDS-Instance', label: 'DB', parent: 'pub-a', x: 200, y: 40 }]), () => { qa('.toast button').find((b) => b.textContent.trim() === '닫기')?.click(); });
        await run(T('card-mode'), async () => { A.loadTemplate('connect-cv'); await sleep(400); const g = A.graph(); g.theme = theme; A.load(g); await sleep(900); }, null);
        await run(T('tab-context'), () => { const t = q('.doctab.on'); const r = t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 })); }, esc);
      }
    } finally {
      for (const k of Object.keys(localStorage)) if (k.startsWith('arch-canvas:')) localStorage.removeItem(k);
      for (const [k, v] of Object.entries(bk)) localStorage.setItem(k, v);
    }
    return all;
  };
})();
