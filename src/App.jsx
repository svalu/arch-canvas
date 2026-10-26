import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, ConnectionMode, SelectionMode,
  useNodesState, useEdgesState, useReactFlow, ViewportPortal,
} from '@xyflow/react';
import { alignItems, distributeItems, sameSize, canResizeCount, snapGuides } from './canvas/align.js';
import { extractSubgraph, insertSubgraph, subgraphSize, CLIP_MARK, renewSets, newSetId } from './model/clip.js';
import { reorder, placeFront } from './model/layers.js';
import { settleContainment, isOverlay, dropPreview } from './model/contain.js';
import { LayersPanel } from './canvas/LayersPanel.jsx';

// 캔버스 격자 보기 설정 (localStorage 에 저장)
const LS_VIEW = 'arch-canvas:view';
// 격자 색: 라이트는 잉크, 다크는 민트. 진하기 0 이면 완전히 사라진다
const GRID_RGB = { light: '35, 47, 62', dark: '127, 227, 214' };
const VIEW_DEFAULT = { dots: true, lines: false, strength: 35, gap: 16, major: true, depth: true, textScale: 1, edgeShape: 'elbow', edgeArrow: 'end', pins: true, guides: true, aiOff: false };
function loadView() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_VIEW) || '{}');
    if (s.grid) { s.dots = s.grid === 'dots' || s.grid === 'cross'; s.lines = s.grid === 'lines'; delete s.grid; }   // 이전 저장 형식
    const v = { ...VIEW_DEFAULT, ...s };
    setEdgeDefaults({ shape: v.edgeShape, arrow: v.edgeArrow });
    return v;
  } catch { return VIEW_DEFAULT; }
}

// 패널 폭 조절 손잡이. side 는 왼쪽 가장자리, pal(팔레트)은 오른쪽 가장자리를 끈다.
const LS_LAYOUT = 'arch-canvas:layout';
const LAYOUT_DEFAULT = { pal: 270, side: 272 };
function loadLayout() { try { return { ...LAYOUT_DEFAULT, ...JSON.parse(localStorage.getItem(LS_LAYOUT) || '{}') }; } catch { return LAYOUT_DEFAULT; } }
function Resizer({ which, onResize }) {
  const [active, setActive] = useState(false);
  const onDown = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = which === 'side' ? document.querySelector('.side').getBoundingClientRect().width : document.querySelector('.palette').getBoundingClientRect().width;
    setActive(true);
    document.querySelector('.app')?.classList.add('resizing');
    const move = (ev) => onResize(which, Math.round(startW + (which === 'side' ? startX - ev.clientX : ev.clientX - startX)));
    const up = () => { setActive(false); document.querySelector('.app')?.classList.remove('resizing'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); onResize(which, null, true); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return <div className={'resizer' + (active ? ' active' : '')} onPointerDown={onDown} title="끌어서 폭 조절" />;
}
import { useCatalog, searchIcons, BUILTIN_TEMPLATES, loadUserTemplates, saveUserTemplate, deleteUserTemplate } from './catalog.js';
import { nodeTypes, PinTip } from './canvas/nodes.jsx';
import { ContextMenu } from './canvas/ContextMenu.jsx';
import { AskBar } from './canvas/AskBar.jsx';
import { edgeTypes } from './canvas/edges.jsx';
import { graphToFlow, flowToGraph } from './model/convert.js';
import { normalizeGraph, emptyGraph, uid, allIds, ICON_SIZE, LINES, SHAPES, ARROWS, EDGE_DEFAULTS, setEdgeDefaults, sortGroups, CARD_DEFAULT, LABEL_DROP } from './model/schema.js';
import { absoluteRects, innermostGroupAt, descendants } from './model/geometry.js';
import { applyPatch, PATCH_OPS } from './model/patch.js';
import { graphToScene, selectionIds, sceneStats } from './export/scene.js';
import { lint, diffViolations, mergeRuleAnnotations, RULES } from './model/rules.js';
import { graphToSvg, svgToPng, svgToBlob, copyPngToClipboard, saveBlob } from './export/image.js';
import { decorateSvg, EXPORT_DEFAULT, usedLineStyles } from './export/decorate.js';
import { useExit as useExit2 } from './useExit.js';
import { ConnectModal, AiPanel, AiChip, Busy } from './ai/ui.jsx';
import { useExit } from './useExit.js';
import { loadSettings, saveSettings, isVerified, run as aiRun } from './ai/connection.js';
import { buildReviewMessages, buildDrawMessages, buildAskMessages, parseJsonReply, findingsToAnnotations } from './ai/prompts.js';
import { providerById } from './ai/providers.js';
import { GuidePanel, loadGuide, saveGuide, emptyGuide, visibleSteps, opsFor } from './guide/GuidePanel.jsx';
import suggestData from '../data/suggest.json' with { type: 'json' };
import { Tour, tourDone } from './Tour.jsx';
import { Icon } from './Icons.jsx';
import { loadDocs, saveList, saveActive, loadDoc, saveDoc, removeDoc, newDocId, readList, docExists, LIST_KEY, trashDoc, closedDocs, untrashDoc } from './docs.js';
import { hidePinTip } from './canvas/nodes.jsx';
import { DocTabs } from './DocTabs.jsx';
import { freeSlot } from './model/geometry.js';

const NEXT_TO = suggestData.nextTo.map((r) => ({ re: new RegExp(r.match), items: r.items }));
/** 지금 선택에 맞는 추천 목록. { title, items:[{type:'icon',key}|{type:'group',kind}], target:{mode:'into'|'next', id} } */
function suggestFor(selNodes, catalog, mode = 'infra') {
  const toItem = (s) => (s.startsWith('group:') ? { type: 'group', kind: s.slice(6) } : { type: 'icon', key: s });
  const valid = (it) => (it.type === 'group' ? catalog.kinds.has(it.kind) : catalog.icons.has(it.key));
  if (mode === 'card') {
    const target = selNodes.length === 1 ? (selNodes[0].type === 'awsGroup' ? { mode: 'into', id: selNodes[0].id } : { mode: 'next', id: selNodes[0].id }) : null;
    const title = !target ? '카드 모드' : target.mode === 'into' ? `${selNodes[0].data.label || '섹션'} 안에 넣기` : `${selNodes[0].data.label || '카드'} 옆에 붙여 연결`;
    return { title, items: [{ type: 'card' }, { type: 'group', kind: 'section' }, ...suggestData.default.filter((s) => !s.startsWith('group:')).slice(0, 12).map(toItem).filter(valid)], target };
  }
  if (selNodes.length === 1) {
    const n = selNodes[0];
    if (n.type === 'awsGroup') {
      const list = suggestData.inside[n.data.kind] || suggestData.inside.generic;
      return { title: `${n.data.label || catalog.kinds.get(n.data.kind)?.name} 안에 넣기`, items: list.map(toItem).filter(valid), target: { mode: 'into', id: n.id } };
    }
    const rule = NEXT_TO.find((r) => r.re.test(n.data.icon));
    if (rule) return { title: `${n.data.label || catalog.icons.get(n.data.icon)?.name} 옆에 붙여 연결`, items: rule.items.map(toItem).filter(valid), target: { mode: 'next', id: n.id } };
  }
  return { title: '자주 쓰는 것', items: suggestData.default.map(toItem).filter(valid), target: null };
}

// 플랫폼: 맥이면 단축키 표기를 ⌘·⌥ 로 바꾸고, 사파리는 클립보드 읽기를 하지 않는다
export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const IS_SAFARI = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
export const APP_VERSION = '0.8.3';
const LS_CURRENT = 'arch-canvas:current';
const GROUP_DEFAULT = { w: 320, h: 200 };

export default function App() {
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}

// ---------------------------------------------------------------------------------------------
function Editor() {
  const catalog = useCatalog();
  const rf = useReactFlow();
  const [nodes, setNodes, onNodesChangeBase] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [title, setTitle] = useState('새 다이어그램');
  const titleRef = useRef(title);
  titleRef.current = title;
  const annotationsRef = useRef([]);
  const contextRef = useRef({ title: '', requirements: '', constraints: '' });
  const [context, setContext] = useState(contextRef.current);
  const modeRef = useRef('infra'); const themeRef = useRef('light');
  const [docMode, setDocMode] = useState('infra');
  const [theme, setTheme] = useState('light');
  // <details> 메뉴: 닫힐 때도 모션. 바깥 클릭/Esc 로 닫히고, 하나 열면 다른 건 닫힌다
  useEffect(() => {
    const closeOne = (d) => { if (!d.open || d.classList.contains('closing')) return; d.classList.add('closing'); setTimeout(() => { d.open = false; d.classList.remove('closing'); }, 150); };
    const closeAll = (except) => document.querySelectorAll('details.menu[open]').forEach((d) => { if (d !== except) closeOne(d); });
    window.__closeMenus = closeAll;
    const onClick = (e) => { const sum = e.target.closest?.('summary'); const d = sum?.parentElement; if (d?.matches?.('details.menu')) { if (d.open) { e.preventDefault(); closeOne(d); } else closeAll(d); } };
    const onDown = (e) => { if (!e.target.closest?.('details.menu')) closeAll(); };
    const onKey = (e) => { if (e.key === 'Escape') closeAll(); };
    document.addEventListener('click', onClick, true); document.addEventListener('pointerdown', onDown, true); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onClick, true); document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey); delete window.__closeMenus; };
  }, []);
  // EXE 면 윈도우 제목줄도 같은 톤으로 (브라우저에선 무시)
  useEffect(() => { window.desktop?.call?.('win.dark', { dark: theme === 'dark' }).catch(() => {}); }, [theme]);
  const gridColor = (a) => `rgba(${GRID_RGB[theme] || GRID_RGB.light}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  // 테마가 바뀌는 동안만 .theming 을 붙여 색이 교차 페이드되게 한다
  const [theming, setTheming] = useState(false); const themeFirst = useRef(true);
  useEffect(() => { if (themeFirst.current) { themeFirst.current = false; return; } setTheming(true); const t = setTimeout(() => setTheming(false), 600); return () => clearTimeout(t); }, [theme]);
  // AI
  const [aiSettings, setAiSettingsState] = useState(() => loadSettings());
  const setAiSettings = useCallback((s) => { setAiSettingsState(s); saveSettings(s); }, []);
  const [connect, setConnect] = useState({ open: false, pending: null });   // pending: 'review' | 'draw' | null
  const [ai, setAi] = useState({ busy: null, result: null, error: null });
  const aiAbort = useRef(null);
  const pendingDraw = useRef('');
  // 패널 폭
  const [layout, setLayout] = useState(loadLayout);
  const onResize = useCallback((which, w, done) => {
    setLayout((l) => {
      const n = w == null ? l : { ...l, [which]: Math.max(which === 'side' ? 240 : 200, Math.min(640, w)) };
      if (done) { try { localStorage.setItem(LS_LAYOUT, JSON.stringify(n)); } catch { /* */ } }
      return n;
    });
  }, []);
  // 보기(격자)
  const [view, setViewState] = useState(loadView);
  const viewRef = useRef(null);
  viewRef.current = view;
  const setView = useCallback((patch) => setViewState((v) => {
    const n = { ...v, ...patch };
    setEdgeDefaults({ shape: n.edgeShape, arrow: n.edgeArrow });
    try { localStorage.setItem(LS_VIEW, JSON.stringify(n)); } catch { /* */ }
    return n;
  }), []);
  // 이미 있는 연결선 모양을 한 번에
  const reshapeAll = useCallback((shape) => { const g = currentGraphRef.current(); g.edges.forEach((e) => { e.shape = shape; }); commitRef.current(g); }, []);
  const currentGraphRef = useRef(null); const commitRef = useRef(null);
  // 오른쪽 클릭 메뉴
  const [ctx, setCtx] = useState(null);
  const closeCtx = useCallback(() => setCtx(null), []);

  // 둘러보기: 처음 켰을 때 한 번
  const [tour, setTour] = useState(false);
  useEffect(() => { if (!tourDone()) { const t = setTimeout(() => setTour(true), 600); return () => clearTimeout(t); } }, []);
  // 가이드(단계별 진행)
  const [guide, setGuideState] = useState(() => loadGuide());
  const setGuide = useCallback((s) => { setGuideState(s); saveGuide(s); }, []);
  const hist = useRef({ past: [], future: [], coalesce: null });
  const [histVer, setHistVer] = useState(0);
  const [toast, setToastState] = useState(null);
  const toastEx = useExit(toast, 220); const toastV = toast || toastEx.v; const toastOut = !toast && toastEx.closing;   // 문자열 또는 { kind:'block'|'warn', title, explain }
  const [userTemplates, setUserTemplates] = useState([]);
  const [panel, setPanel] = useState(null); // 'patch' | 'help' | 'rules' | null
  // 내보내기 설정 (배율·배경·여백·제목·범례·16:9). PNG 복사(Ctrl+C)도 이 설정을 쓴다
  const [exp, setExpState] = useState(() => { try { return { ...EXPORT_DEFAULT, ...JSON.parse(localStorage.getItem('arch-canvas:export') || '{}') }; } catch { return EXPORT_DEFAULT; } });
  const setExp = useCallback((patch) => setExpState((v) => { const n = { ...v, ...patch }; try { localStorage.setItem('arch-canvas:export', JSON.stringify(n)); } catch { /* */ } return n; }), []);
  const exportBg = exp.background;
  const setExportBg = (b) => setExp({ background: b });
  const [expOpen, setExpOpen] = useState(false);
  const [violations, setViolations] = useState([]);
  const lintRef = useRef([]);
  const dragSnapshot = useRef(null);
  const resizeSnapshot = useRef(null);
  const wrapRef = useRef(null);
  const isDesktop = !!window.desktop;

  const toastMsg = useCallback((text, ms = 2600) => {
    setToastState(text);
    clearTimeout(toastMsg.t);
    toastMsg.t = setTimeout(() => setToastState(null), ms);
  }, []);

  // ----- 업데이트 (EXE 전용): 하루 한 번 자동 확인, 도움말에서 수동 확인 -----
  const [upd, setUpd] = useState({ info: null, open: false, busy: false });
  const updRef = useRef(upd); updRef.current = upd;
  const checkUpdate = useCallback(async (manual = false) => {
    if (!window.desktop?.call) { if (manual) toastMsg('업데이트 확인은 EXE 에서만 할 수 있습니다.'); return null; }
    setUpd((u) => ({ ...u, busy: true }));
    try {
      const r = await window.desktop.call('update.check', {});
      try { localStorage.setItem('arch-canvas:upd-check', String(Date.now())); } catch { /* */ }
      setUpd((u) => ({ ...u, info: r, busy: false, open: manual && r?.newer ? true : u.open }));
      if (manual && !r?.newer) toastMsg(`최신 버전입니다 (${r?.current || APP_VERSION}).`);
      return r;
    } catch (e) {
      setUpd((u) => ({ ...u, busy: false }));
      if (manual) toastMsg('업데이트를 확인하지 못했습니다: ' + (e.message || e), 6000);
      return null;
    }
  }, [toastMsg]);
  const applyUpdate = useCallback(async () => {
    const info = updRef.current.info; const a = info?.asset;
    if (!a) throw new Error('먼저 업데이트를 확인하십시오');
    setUpd((u) => ({ ...u, busy: true }));
    toastMsg('업데이트를 내려받습니다. 끝나면 자동으로 다시 시작합니다.', 20000);
    try { return await window.desktop.call('update.apply', { url: a.url, apiUrl: a.apiUrl, name: a.name, version: info.version }); }
    catch (e) { setUpd((u) => ({ ...u, busy: false })); toastMsg({ kind: 'block', title: '업데이트하지 못했습니다', explain: String(e.message || e) }, 12000); throw e; }
  }, [toastMsg]);
  useEffect(() => {
    if (!window.desktop?.call) return;
    let last = 0; try { last = +localStorage.getItem('arch-canvas:upd-check') || 0; } catch { /* */ }
    if (Date.now() - last < 24 * 3600 * 1000) return;
    const t = setTimeout(() => checkUpdate(false), 4000);
    return () => clearTimeout(t);
  }, [checkUpdate]);
  // 규칙 위반을 설명과 함께 보여준다. 막은 건 빨강, 경고는 주황. 토스트에서 바로 AI에게 물어볼 수 있다.
  const showRule = useCallback((v, blocked, more = 0) => {
    toastMsg({ kind: blocked ? 'block' : 'warn', title: (blocked ? '차단: ' : '경고: ') + v.message + (more > 1 ? ` (외 ${more - 1}건)` : ''), explain: v.explain, ask: askAboutText(v) }, blocked ? 9000 : 8000);
  }, [toastMsg]);

  // "AI에게 물어보기" 질문 문장 만들기 (경고/핀 공통)
  const askAboutText = (v) => `"${v.message}" 라는 ${v.severity === 'block' ? '차단' : v.level === 'error' ? '심각' : v.level === 'info' ? '참고' : '경고'} 항목이 표시되었습니다${v.target ? ` (대상 id: ${v.target})` : ''}. 설명: ${v.explain || ''}\n이 항목이 왜 중요한지, 현재 다이어그램에서 구체적으로 어떻게 고치면 되는지 알려 주십시오. 제안서에 적을 근거도 한 줄 부탁합니다.`;

  const currentGraph = useCallback(
    () => flowToGraph(rf.getNodes(), rf.getEdges(), { title: titleRef.current, annotations: annotationsRef.current, context: contextRef.current, mode: modeRef.current, theme: themeRef.current }),
    [rf],
  );

  /**
   * 그래프를 캔버스에 반영한다. before: 되돌리기 스택에 넣을 이전 상태(undefined = 지금 상태, null = 넣지 않음).
   * coalesce: 같은 키로 1초 안에 연속 호출되면 되돌리기 항목을 하나로 합친다(라벨 타이핑).
   */
  const commit = useCallback((graph, before, { coalesce = null, fit = false } = {}) => {
    // 소속은 화면 위치로만 정한다: 반영할 때마다 다시 계산 (숨은 부모 관계가 화면과 어긋나지 않게)
    const g = settleContainment(normalizeGraph(graph));
    hidePinTip();
    const h = hist.current;
    if (before !== null) {
      const prev = before === undefined ? currentGraph() : before;
      const now = Date.now();
      if (!(coalesce && h.coalesce && h.coalesce.key === coalesce && now - h.coalesce.time < 1000)) {
        h.past.push(prev);
        if (h.past.length > 100) h.past.shift();
      }
      h.coalesce = coalesce ? { key: coalesce, time: now } : null;
      h.future = [];
    }
    // 규칙 검사 → 규칙 핀 갱신 (손으로 넣은 핀은 유지)
    const found = lint(g);
    lintRef.current = found;
    setViolations(found);
    g.annotations = mergeRuleAnnotations(g.annotations, found);
    const sel = new Set(rf.getNodes().filter((n) => n.selected).map((n) => n.id));
    const selE = new Set(rf.getEdges().filter((e) => e.selected).map((e) => e.id));
    const f = graphToFlow(g);
    f.nodes.forEach((n) => { if (sel.has(n.id)) n.selected = true; });
    f.edges.forEach((e) => { if (selE.has(e.id)) e.selected = true; });
    setNodes(f.nodes);
    setEdges(f.edges);
    setTitle(g.title);
    annotationsRef.current = g.annotations;
    contextRef.current = g.context;
    setContext(g.context);
    modeRef.current = g.mode; themeRef.current = g.theme;
    setDocMode(g.mode); setTheme(g.theme);
    setHistVer((v) => v + 1);
    if (fit) setTimeout(() => rf.fitView({ padding: 0.08, duration: 300 }), 30);
  }, [rf, currentGraph, setNodes, setEdges]);

  /**
   * 사용자 액션용 커밋: 바뀐 그래프를 규칙에 통과시켜서 새로 생긴 block 위반이 있으면 막고(false), warn 이면 설명을 띄우고 반영한다.
   * 템플릿 불러오기/되돌리기처럼 "검사만 하고 막지 않는" 경우는 commit 을 직접 쓴다.
   */
  const tryCommit = useCallback((graph, before, opts = {}) => {
    const g = settleContainment(normalizeGraph(graph));
    const fresh = diffViolations(lintRef.current, lint(g));
    const blocks = fresh.filter((v) => v.severity === 'block');
    if (blocks.length) { showRule(blocks[0], true, blocks.length); return false; }
    const warns = fresh.filter((v) => v.severity !== 'block');
    if (warns.length) showRule(warns[0], false, warns.length);
    commit(g, before, opts);
    return true;
  }, [commit, showRule]);

  currentGraphRef.current = currentGraph; commitRef.current = commit;

  const undo = useCallback(() => {
    const h = hist.current;
    if (!h.past.length) return;
    h.future.push(currentGraph());
    h.coalesce = null;
    commit(h.past.pop(), null);
  }, [commit, currentGraph]);

  const redo = useCallback(() => {
    const h = hist.current;
    if (!h.future.length) return;
    h.past.push(currentGraph());
    commit(h.future.pop(), null);
  }, [commit, currentGraph]);

  // ----- 문서 탭: 여러 다이어그램을 동시에. 되돌리기 기록은 탭마다 따로 -----
  const [docs, setDocsState] = useState(() => loadDocs());
  const docsRef = useRef(docs); docsRef.current = docs;
  const histByDoc = useRef(new Map());
  const setDocs = useCallback((next) => { setDocsState(next); saveList(next.list); saveActive(next.active); }, []);
  const tabAi = useRef(new Map());   // 탭마다 AI 대화 기록

  // 처음: 활성 탭 복원
  useEffect(() => {
    const g = loadDoc(docsRef.current.active);
    commit(g || emptyGraph(), null, { fit: !!g });
    loadUserTemplates().then(setUserTemplates);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 웹 버전 첫 안내: 작업은 이 브라우저에 저장된다
  const [webNote, setWebNote] = useState(() => { try { return !window.desktop && localStorage.getItem('arch-canvas:web-note') !== '1'; } catch { return false; } });
  const closeWebNote = () => { setWebNote(false); try { localStorage.setItem('arch-canvas:web-note', '1'); } catch { /* */ } };
  // 맥: 화면의 단축키 표기를 ⌘/⌥ 로 (Ctrl+Tab 은 맥에서도 Ctrl)
  useEffect(() => {
    if (!IS_MAC) return undefined;
    const fix = (t) => t.replace(/Ctrl\s*\+\s*Shift\s*\+\s*/g, '⌘⇧').replace(/Ctrl\s*\+\s*(?!Tab)/g, '⌘').replace(/Alt\s*\+\s*/g, '⌥').replace(/Alt 를/g, 'Option(⌥) 키를').replace(/Alt 를/g, 'Option(⌥) 키를').replace(/\bAlt\b/g, 'Option(⌥)');
    const walk = (root) => {
      const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const userText = (el) => !!el?.closest?.('.react-flow__nodes, .react-flow__edges, .react-flow__edgelabel-renderer, .ask-a, .ask-q, .summary, .lyr-name, .doctab-title, .ctx-title');
      for (let n = it.nextNode(); n; n = it.nextNode()) { if (/Ctrl|Alt/.test(n.nodeValue) && !userText(n.parentElement)) { const v = fix(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; } }
      if (root.querySelectorAll) for (const el of root.querySelectorAll('[title],[placeholder],[aria-label]')) for (const at of ['title', 'placeholder', 'aria-label']) { const v = el.getAttribute(at); if (v && /Ctrl|Alt/.test(v)) el.setAttribute(at, fix(v)); }
    };
    walk(document.body);
    const mo = new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'characterData' && /Ctrl|Alt/.test(m.target.nodeValue) && !m.target.parentElement?.closest?.('.react-flow__nodes, .react-flow__edges, .react-flow__edgelabel-renderer, .ask-a, .ask-q, .summary, .lyr-name, .doctab-title, .ctx-title')) m.target.nodeValue = fix(m.target.nodeValue); for (const n of m.addedNodes) if (n.nodeType === 1) walk(n); else if (n.nodeType === 3 && /Ctrl|Alt/.test(n.nodeValue) && !n.parentElement?.closest?.('.react-flow__nodes, .react-flow__edges, .react-flow__edgelabel-renderer, .ask-a, .ask-q, .summary, .lyr-name, .doctab-title, .ctx-title')) n.nodeValue = fix(n.nodeValue); if (m.type === 'attributes' && m.target.getAttribute) { const v = m.target.getAttribute(m.attributeName); if (v && /Ctrl|Alt/.test(v)) m.target.setAttribute(m.attributeName, fix(v)); } } });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label'] });
    return () => mo.disconnect();
  }, []);

  // 창을 닫거나 숨길 때 0.4초 자동 저장을 기다리지 않고 바로 저장
  useEffect(() => {
    const flush = () => { try { saveDoc(docsRef.current.active, currentGraphRef.current()); } catch { /* */ } };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('pagehide', flush); window.removeEventListener('beforeunload', flush); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  // 저장 실패(저장 공간 부족 등)는 조용히 넘기지 않고 알린다
  useEffect(() => {
    let last = 0;
    const on = () => { if (Date.now() - last < 15000) return; last = Date.now(); toastMsg({ kind: 'block', title: '저장하지 못했습니다', explain: '브라우저 저장 공간이 부족합니다. [저장]으로 파일을 남기고, 쓰지 않는 탭을 닫으십시오.' }, 12000); };
    window.addEventListener('arch-save-failed', on);
    return () => window.removeEventListener('arch-save-failed', on);
  }, [toastMsg]);
  // 다른 창에서 탭을 만들거나 닫으면 이 창의 목록에도 반영한다 (서로 덮어쓰지 않게)
  useEffect(() => {
    const on = (e) => {
      if (e.key !== LIST_KEY) return;
      const theirs = readList();
      const d = docsRef.current;
      const mine = d.list.filter((x) => x.id === d.active || docExists(x.id));
      const extra = theirs.filter((x) => !mine.some((m) => m.id === x.id));
      if (extra.length || mine.length !== d.list.length) setDocsState({ ...d, list: [...mine, ...extra] });
    };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);

  // 자동 저장 (활성 탭) + 탭 이름은 다이어그램 제목을 따른다
  useEffect(() => {
    const t = setTimeout(() => {
      const g = currentGraph();
      const d = docsRef.current;
      saveDoc(d.active, g);
      const cur = d.list.find((x) => x.id === d.active);
      if (cur && cur.title !== g.title) setDocs({ ...d, list: d.list.map((x) => (x.id === d.active ? { ...x, title: g.title } : x)) });
    }, 400);
    return () => clearTimeout(t);
  }, [nodes, edges, title, currentGraph, setDocs]);

  const switchDoc = useCallback((id) => {
    const d = docsRef.current;
    if (id === d.active) return;
    saveDoc(d.active, currentGraph());
    histByDoc.current.set(d.active, hist.current);
    hist.current = histByDoc.current.get(id) || { past: [], future: [], coalesce: null };
    tabAi.current.set(d.active, askHistory.current);
    askHistory.current = tabAi.current.get(id) || [];
    setDocs({ ...d, active: id });
    setPanel((p) => (p === 'ai' || p === 'rules' || p === 'help' ? p : null));
    commit(loadDoc(id) || emptyGraph(), null, { fit: true });
  }, [commit, currentGraph, setDocs]);

  const addDoc = useCallback((graph = null) => {
    const d = docsRef.current;
    saveDoc(d.active, currentGraph());
    histByDoc.current.set(d.active, hist.current);
    const id = newDocId();
    const g = graph || emptyGraph(`다이어그램 ${d.list.length + 1}`);
    saveDoc(id, g);
    hist.current = { past: [], future: [], coalesce: null };
    setDocs({ list: [...d.list, { id, title: g.title }], active: id });
    commit(g, null, { fit: !!graph });
  }, [commit, currentGraph, setDocs]);

  const closeDoc = useCallback((id) => {
    const d = docsRef.current;
    const g = id === d.active ? currentGraph() : loadDoc(id);
    const name = d.list.find((x) => x.id === id)?.title || '다이어그램';
    // 확인 없이 닫는다: 닫은 탭은 Ctrl+Shift+T 로 다시 열 수 있다
    if (id === d.active && g) saveDoc(id, g);
    trashDoc(id, name, g);
    if (g && (g.nodes?.length || g.groups?.length)) toastMsg(`"${name}" 탭을 닫았습니다. Ctrl+Shift+T 로 다시 열 수 있습니다.`, 3500);
    histByDoc.current.delete(id);
    const list = d.list.filter((x) => x.id !== id);
    if (!list.length) { const nid = newDocId(); const eg = emptyGraph(); saveDoc(nid, eg); setDocs({ list: [{ id: nid, title: eg.title }], active: nid }); hist.current = { past: [], future: [], coalesce: null }; commit(eg, null); return; }
    if (id !== d.active) { setDocs({ ...d, list }); return; }
    const idx = d.list.findIndex((x) => x.id === id);
    const next = list[Math.min(idx, list.length - 1)].id;
    hist.current = histByDoc.current.get(next) || { past: [], future: [], coalesce: null };
    setDocs({ list, active: next });
    commit(loadDoc(next) || emptyGraph(), null, { fit: true });
  }, [commit, currentGraph, setDocs, toastMsg]);

  // 한 번에 닫기: 목록을 한 번만 바꿔서 탭 목록이 꼬이지 않게
  const closeOthers = useCallback((keep) => {
    const d = docsRef.current;
    const others = d.list.filter((x) => x.id !== keep);
    if (!others.length) return;
    if (d.active !== keep) saveDoc(d.active, currentGraph());
    for (const x of others) { trashDoc(x.id, x.title, loadDoc(x.id)); histByDoc.current.delete(x.id); tabAi.current.delete(x.id); }
    toastMsg(`탭 ${others.length}개를 닫았습니다. Ctrl+Shift+T 로 하나씩 다시 열 수 있습니다.`, 3500);
    const list = d.list.filter((x) => x.id === keep);
    if (d.active !== keep) {
      hist.current = histByDoc.current.get(keep) || { past: [], future: [], coalesce: null };
      setDocs({ list, active: keep });
      commit(loadDoc(keep) || emptyGraph(), null, { fit: true });
    } else setDocs({ ...d, list });
  }, [commit, currentGraph, setDocs, toastMsg]);

  const reopenDoc = useCallback((id = closedDocs()[0]?.id) => {
    if (!id) { toastMsg('다시 열 탭이 없습니다.'); return; }
    const meta = closedDocs().find((x) => x.id === id);
    const g = loadDoc(id);
    untrashDoc(id);
    if (!g) { toastMsg('닫은 탭의 내용을 찾지 못했습니다.'); return; }
    const d = docsRef.current;
    saveDoc(d.active, currentGraph());
    histByDoc.current.set(d.active, hist.current);
    hist.current = { past: [], future: [], coalesce: null };
    setDocs({ list: [...d.list, { id, title: meta?.title || g.title, file: g.__file }], active: id });
    commit(g, null, { fit: true });
  }, [commit, currentGraph, setDocs, toastMsg]);

  const duplicateDoc = useCallback((id) => {
    const d = docsRef.current;
    const g = id === d.active ? currentGraph() : loadDoc(id);
    if (g) addDoc({ ...g, title: g.title + ' (복사본)' });
  }, [addDoc, currentGraph]);

  const renameDoc = useCallback((id, name) => {
    const d = docsRef.current;
    if (id === d.active) { const g = currentGraph(); g.title = name; commit(g, undefined, { coalesce: 'title' }); }
    else { const g = loadDoc(id); if (g) saveDoc(id, { ...g, title: name }); }
    setDocs({ ...d, list: d.list.map((x) => (x.id === id ? { ...x, title: name } : x)) });
  }, [commit, currentGraph, setDocs]);

  const onTabContext = useCallback((e, doc) => {
    const d = docsRef.current;
    setCtx({ x: e.clientX, y: e.clientY, title: doc.title, items: [
      { label: '이름 바꾸기…', hint: '더블클릭', action: () => { const v = window.prompt('다이어그램 이름', doc.title); if (v?.trim()) renameDoc(doc.id, v.trim()); } },
      { label: '복제', action: () => duplicateDoc(doc.id) },
      { label: '새 탭', hint: 'Ctrl+T', action: () => addDoc() },
      { label: '닫은 탭 다시 열기', hint: 'Ctrl+Shift+T', disabled: !closedDocs().length, action: () => reopenDoc() },
      'sep',
      { label: '다른 탭 모두 닫기', disabled: d.list.length < 2, action: () => closeOthers(doc.id) },
      { label: '닫기', hint: '가운데 클릭', danger: true, action: () => closeDoc(doc.id) },
    ] });
  }, [renameDoc, duplicateDoc, addDoc, closeDoc, closeOthers, reopenDoc]);

  const moveDoc = useCallback((from, to) => {
    const d = docsRef.current;
    const list = [...d.list];
    const [m] = list.splice(from, 1);
    list.splice(to, 0, m);
    setDocs({ ...d, list });
  }, [setDocs]);

  // ----- 노드 변경: 크기 조절 끝나면 커밋 -----
  const [guideLines, setGuideLines] = useState([]);
  const [find, setFind] = useState({ open: false, q: '', i: 0, n: 0 });
  const onNodesChange = useCallback((changes) => {
    // 묶음(Ctrl+G): 하나를 고르면 묶음 전체가 골라진다 (그래서 함께 끌린다)
    if (changes.some((c) => c.type === 'select' && c.selected)) {
      const all = rf.getNodes();
      const setOfId = new Map(all.filter((n) => n.data?.set).map((n) => [n.id, n.data.set]));
      const sets = new Set(changes.filter((c) => c.type === 'select' && c.selected && setOfId.has(c.id)).map((c) => setOfId.get(c.id)));
      if (sets.size) {
        const mem = new Set(all.filter((n) => sets.has(n.data?.set)).map((n) => n.id));
        changes = [...changes.filter((c) => !(c.type === 'select' && mem.has(c.id))), ...[...mem].map((id) => ({ type: 'select', id, selected: true }))];
      }
    }
    // 끄는 동안: 놓으면 들어갈 상자를 테두리로 켜고 이름을 안내에 띄운다
    if (dragCtx.current) {
      const c = changes.find((x) => x.type === 'position' && x.dragging && x.id === dragCtx.current.id && x.position);
      if (c) {
        const me = rf.getInternalNode(c.id);
        if (me) {
          const w = me.measured?.width ?? me.width ?? 48, h = me.measured?.height ?? me.height ?? 48;
          const pAbs = { x: me.internals.positionAbsolute.x - me.position.x, y: me.internals.positionAbsolute.y - me.position.y };
          const rect = { x: pAbs.x + c.position.x, y: pAbs.y + c.position.y, w, h };
          const ctx = dragCtx.current;
          const pv = dropPreview(dragSnapshot.current, ctx.rects, rect, ctx.kind, ctx.skip);
          const overKey = pv.over.join(',');
          if (pv.into !== ctx.into || overKey !== ctx.overKey) {
            document.querySelectorAll('.react-flow__node.drop-target').forEach((el) => el.classList.remove('drop-target'));
            if (pv.into) document.querySelector(`.react-flow__node[data-id="${CSS.escape(pv.into)}"]`)?.classList.add('drop-target');
            ctx.into = pv.into; ctx.overKey = overKey;
            const name = (id) => labelOfRef.current?.(id) || id;
            setDragHint((h) => ({ ...(h || {}), into: pv.into ? name(pv.into) : null, over: pv.over.map(name), live: true }));
          }
        }
      }
    }
    // Alt+끌기: 상자가 움직인 만큼 바로 안의 것들을 반대로 옮겨 제자리에 둔다
    if (altDrag.current) {
      const c = changes.find((x) => x.type === 'position' && x.id === altDrag.current.id && x.position);
      if (c) {
        const d = { x: c.position.x - altDrag.current.last.x, y: c.position.y - altDrag.current.last.y };
        altDrag.current.last = { ...c.position };
        if (d.x || d.y) for (const k of altDrag.current.kids) { const kn = rf.getNode(k); if (kn) changes.push({ type: 'position', id: k, position: { x: kn.position.x - d.x, y: kn.position.y - d.y }, dragging: false }); }
      }
    }
    // 정렬 안내선: 하나만 끌 때, 다른 요소의 가장자리·가운데에 6px(화면 기준) 안으로 오면 붙이고 선을 보여준다
    const drags = changes.filter((c) => c.type === 'position' && c.dragging && c.position);
    if (drags.length === 1 && viewRef.current.guides !== false) {
      const c = drags[0];
      const me = rf.getInternalNode(c.id);
      if (me) {
        const w = me.measured?.width ?? me.width ?? 48, h = me.measured?.height ?? me.height ?? 48;
        const pAbs = { x: me.internals.positionAbsolute.x - me.position.x, y: me.internals.positionAbsolute.y - me.position.y };
        const r = { x: pAbs.x + c.position.x, y: pAbs.y + c.position.y, w, h };
        const skip = new Set([c.id]);
        for (let p = me.parentId; p; p = rf.getInternalNode(p)?.parentId) skip.add(p);   // 자기 부모 그룹 테두리엔 붙지 않게
        const others = [];
        for (const n of rf.getNodes()) {
          if (skip.has(n.id) || n.selected) continue;
          let inside = false; for (let p = n.parentId; p; p = rf.getInternalNode(p)?.parentId) if (p === c.id) { inside = true; break; }
          if (inside) continue;
          const inn = rf.getInternalNode(n.id); if (!inn) continue;
          others.push({ x: inn.internals.positionAbsolute.x, y: inn.internals.positionAbsolute.y, w: inn.measured?.width ?? 48, h: inn.measured?.height ?? 48 });
        }
        const s = snapGuides(r, others, 6 / (rf.getZoom() || 1));
        c.position = { x: c.position.x + s.dx, y: c.position.y + s.dy };
        setGuideLines(s.lines);
      }
    } else if (changes.some((c) => c.type === 'position' && c.dragging === false)) setGuideLines([]);
    // 상자 크기 조절: 안에 든 것보다 작게 줄일 수 없다. 왼쪽·위를 끌어도 안의 것은 제자리
    const rs = changes.filter((c) => c.type === 'dimensions' && c.resizing && c.dimensions && rf.getNode(c.id)?.type === 'awsGroup');
    if (rs.length) {
      const g0 = resizeSnapshot.current || currentGraph();
      const rects = absoluteRects(g0);
      for (const c of rs) {
        const grp = g0.groups.find((x) => x.id === c.id); if (!grp) continue;
        const self = rects.get(c.id), pAbs = { x: self.x - grp.x, y: self.y - grp.y };
        const kids = [...g0.groups, ...g0.nodes].filter((x) => x.parent === c.id);
        const pc = changes.find((x) => x.type === 'position' && x.id === c.id && x.position);
        const cur = rf.getNode(c.id).position;
        let L = pAbs.x + (pc ? pc.position.x : cur.x), T = pAbs.y + (pc ? pc.position.y : cur.y);
        let R = L + c.dimensions.width, B = T + c.dimensions.height;
        if (kids.length) {
          const M = 8;
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (const k of kids) {
            const r = rects.get(k.id); if (!r) continue;
            const lab = !('w' in k) && k.label ? LABEL_DROP : 0;   // 아이콘 아래 이름까지
            x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h + lab);
          }
          L = Math.min(L, x0 - M); T = Math.min(T, y0 - 30); R = Math.max(R, x1 + M); B = Math.max(B, y1 + M);   // 위는 상자 이름 자리
        }
        c.dimensions = { width: R - L, height: B - T };
        if (pc) pc.position = { x: L - pAbs.x, y: T - pAbs.y };
        // 안의 것은 화면 위치 그대로 (새 왼쪽 위 기준으로 다시 계산)
        const kidIds = new Set(kids.map((k) => k.id));
        changes = changes.filter((x) => !(x.type === 'position' && kidIds.has(x.id)));
        if (pc) for (const k of kids) { const r = rects.get(k.id); if (r) changes.push({ type: 'position', id: k.id, position: { x: r.x - L, y: r.y - T } }); }
      }
    }
    onNodesChangeBase(changes);
    for (const c of changes) {
      if (c.type === 'dimensions' && c.resizing === true && !resizeSnapshot.current) resizeSnapshot.current = currentGraph();
      if (c.type === 'dimensions' && c.resizing === false && resizeSnapshot.current) {
        const before = resizeSnapshot.current;
        resizeSnapshot.current = null;
        setTimeout(() => { if (!tryCommit(currentGraph(), before)) commit(before, null); }, 0);   // 규칙에 막히면 크기 조절 전으로
      }
    }
  }, [onNodesChangeBase, commit, tryCommit, currentGraph, rf]);

  // Delete 키: React Flow 가 직접 지우게 두지 않고, 같은 결과를 규칙 검사·되돌리기를 거쳐 반영한다
  const onBeforeDelete = useCallback(async ({ nodes: dn = [], edges: de = [] }) => {
    const ops = [...dn.map((n) => ({ op: 'remove', id: n.id })), ...de.map((x) => ({ op: 'disconnect', id: x.id }))];
    if (!ops.length) return false;
    const r = applyPatch(currentGraph(), ops, catalog.check);
    tryCommit(r.graph);
    return false;
  }, [catalog, currentGraph, tryCommit]);

  const onConnect = useCallback((c) => {
    if (!c.source || !c.target || c.source === c.target) return;
    const g = currentGraph();
    if (g.edges.some((e) => e.source === c.source && e.target === c.target)) return;
    g.edges.push({ ...EDGE_DEFAULTS, id: uid('e', allIds(g)), source: c.source, target: c.target });
    tryCommit(g);
  }, [tryCommit, currentGraph]);

  // ----- 드래그: 끝나면 어느 그룹 안에 놓였는지 다시 계산 -----
  // 상자를 끌 때: 안에 든 것이 함께 움직인다는 걸 보여 주고(강조 + 안내), Alt 를 누르고 끌면 상자만 옮긴다
  const altDrag = useRef(null);    // { id, last:{x,y}, kids:[id] }
  const altPressed = useRef(false); // 누르는 순간 Alt 상태 (React Flow 끌기 이벤트에는 안 실려 올 때가 있다)
  const altHeld = useRef(false);    // 키보드로 Alt 를 누르고 있는지
  useEffect(() => {
    const dn = (e) => { if (e.key === 'Alt') { altHeld.current = true; if (dragHintRef.current?.alone === false) e.preventDefault(); } };
    const up = (e) => { if (e.key === 'Alt') altHeld.current = false; };
    const blur = () => { altHeld.current = false; };
    window.addEventListener('keydown', dn); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);
  const [dragHint, setDragHint] = useState(null);
  const labelOfRef = useRef(null);
  const dragHintRef = useRef(null); dragHintRef.current = dragHint;
  const dragCtx = useRef(null);   // 끄는 동안 미리보기: { rects, skip, kind, id, into, overKey }
  const onNodeDragStart = useCallback((e, node) => {
    dragSnapshot.current = currentGraph();
    {
      const g0 = dragSnapshot.current;
      // 선택 안 된 것을 끌면 그것만 움직인다 (남아 있던 선택은 같이 안 움직임)
      const sel = node.selected ? rf.getNodes().filter((n) => n.selected).map((n) => n.id) : [];
      const moving = new Set([node.id, ...sel]);
      for (const id of [...moving]) for (const d of descendants(g0, id)) moving.add(d);
      dragCtx.current = { rects: absoluteRects(g0), skip: moving, id: node.id, kind: node.type === 'awsGroup' ? 'group' : 'node', into: undefined, overKey: '' };
    }
    if (node?.type !== 'awsGroup') return;
    const g = dragSnapshot.current;
    if (isOverlay(g.groups.find((x) => x.id === node.id))) { setDragHint({ overlay: true }); return; }   // 겹치는 상자: 테두리만
    const all = descendants(g, node.id);
    if (e?.altKey || e?.sourceEvent?.altKey || altPressed.current || altHeld.current) {
      altDrag.current = { id: node.id, last: { ...node.position }, kids: [...g.groups, ...g.nodes].filter((x) => x.parent === node.id).map((x) => x.id) };
      setDragHint({ alone: true, n: all.size });
    } else {
      altDrag.current = null;
      if (all.size) {
        rf.setNodes((ns) => ns.map((n) => (all.has(n.id) ? { ...n, className: 'follow' } : n)));
        setDragHint({ alone: false, n: all.size });
      }
    }
  }, [currentGraph, rf]);

  const onNodeDragStop = useCallback((_e, _node, dragged) => {
    setDragHint(null);
    document.querySelectorAll('.react-flow__node.drop-target').forEach((el) => el.classList.remove('drop-target'));
    dragCtx.current = null;
    rf.setNodes((ns) => ns.map((n) => (n.className === 'follow' ? { ...n, className: undefined } : n)));
    const g = currentGraph();
    const rects = absoluteRects(g);
    const draggedIds = new Set(dragged.map((n) => n.id));
    // Alt+끌기: 상자만 옮겼으니 원래 안에 있던 것들의 소속을 놓인 자리 기준으로 다시 정한다
    const altKids = new Set(altDrag.current ? altDrag.current.kids : []);
    if (altDrag.current) { for (const k of altKids) draggedIds.add(k); altDrag.current = null; }
    const byId = new Map([...g.groups, ...g.nodes].map((i) => [i.id, i]));
    const hasDraggedAncestor = (item) => { let p = item.parent, guard = 0; while (p && guard++ < 64) { if (draggedIds.has(p)) return true; p = byId.get(p)?.parent; } return false; };
    for (const id of draggedIds) {
      const item = byId.get(id);
      if (!item || (hasDraggedAncestor(item) && !altKids.has(id))) continue;   // Alt 로 상자만 옮겼으면 안의 것은 각자 소속을 다시 정한다
      const r = rects.get(id);
      const isGroup = 'w' in item;
      const pt = isGroup ? { x: r.x + 8, y: r.y + 8 } : { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      const np = innermostGroupAt(g, rects, pt, new Set([id, ...descendants(g, id)]));
      if ((np || null) !== (item.parent || null)) {
        const pr = np ? rects.get(np) : { x: 0, y: 0 };
        item.parent = np;
        item.x = Math.round(r.x - pr.x);
        item.y = Math.round(r.y - pr.y);
      }
    }
    g.groups = sortGroups(g.groups);
    const before = dragSnapshot.current;
    dragSnapshot.current = null;
    if (!tryCommit(g, before) && before) commit(before, null);   // 규칙에 막히면 끌기 전 자리로 되돌림
  }, [commit, tryCommit, currentGraph, rf]);

  // ----- 팔레트에서 떨어뜨리기 / 클릭으로 추가 -----
  const addAt = useCallback((payload, flowPos) => {
    const g = currentGraph();
    const rects = absoluteRects(g);
    const ids = allIds(g);
    if (payload.type === 'card' || (payload.type === 'icon' && g.mode === 'card')) {
      // 카드 모드: 아이콘을 놓으면 아이콘 카드, '빈 카드'면 글만 있는 카드
      const abs = { x: flowPos.x - CARD_DEFAULT.w / 2, y: flowPos.y - CARD_DEFAULT.h / 2 };
      const parent = innermostGroupAt(g, rects, flowPos);
      const pr = parent ? rects.get(parent) : { x: 0, y: 0 };
      const icon = payload.key ? catalog.icons.get(payload.key) : null;
      const id = uid('c', ids);
      g.nodes.push({ id, type: 'card', icon: payload.key || null, label: icon?.name || '제목', body: icon ? '' : '설명을 적어 주세요', parent, x: Math.round(abs.x - pr.x), y: Math.round(abs.y - pr.y), ...CARD_DEFAULT });
      return tryCommit(g) ? id : null;
    }
    if (payload.type === 'text' || payload.type === 'badge') {
      const text = payload.type === 'text';
      const w = text ? 180 : 28, h = text ? 40 : 28;
      const parent = innermostGroupAt(g, rects, flowPos);
      const pr = parent ? rects.get(parent) : { x: 0, y: 0 };
      // 번호는 지금 있는 번호 다음 수로
      const next = 1 + Math.max(0, ...g.nodes.filter((n) => n.type === 'badge').map((n) => parseInt(n.label, 10) || 0));
      const id = uid(text ? 't' : 'b', ids);
      g.nodes.push({ id, type: payload.type, icon: null, label: text ? '텍스트를 입력하십시오' : String(next), parent, x: Math.round(flowPos.x - w / 2 - pr.x), y: Math.round(flowPos.y - h / 2 - pr.y), w, h, ...(text ? { size: 'md', bold: false } : {}) });
      return tryCommit(g) ? id : null;
    }
    if (payload.type === 'icon') {
      const abs = { x: flowPos.x - ICON_SIZE / 2, y: flowPos.y - ICON_SIZE / 2 };
      const parent = innermostGroupAt(g, rects, flowPos);
      const pr = parent ? rects.get(parent) : { x: 0, y: 0 };
      const icon = catalog.icons.get(payload.key);
      const id = uid('n', ids);
      g.nodes.push({ id, icon: payload.key, label: icon?.name || '', parent, x: Math.round(abs.x - pr.x), y: Math.round(abs.y - pr.y) });
      return tryCommit(g) ? id : null;
    }
    if (payload.type === 'group') {
      const kind = catalog.kinds.get(payload.kind);
      const abs = { x: flowPos.x - 40, y: flowPos.y - 24 };
      const parent = innermostGroupAt(g, rects, flowPos);
      const pr = parent ? rects.get(parent) : { x: 0, y: 0 };
      const id = uid(payload.kind, ids);
      g.groups.push({ id, kind: payload.kind, label: kind?.name || '', parent, x: Math.round(abs.x - pr.x), y: Math.round(abs.y - pr.y), ...GROUP_DEFAULT });
      g.groups = sortGroups(g.groups);
      return tryCommit(g) ? id : null;
    }
    return null;
  }, [catalog, tryCommit, currentGraph]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/arch-canvas');
    if (!raw) return;
    addAt(JSON.parse(raw), rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  }, [addAt, rf]);

  const onDragOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }, []);

  const addAtCenter = useCallback((payload) => {
    const r = wrapRef.current.getBoundingClientRect();
    const id = addAt(payload, rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }));
    if (id) setTimeout(() => rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id }))), 0);
    return id;
  }, [addAt, rf]);

  // 추천 클릭: 그룹 안 빈 자리에 넣거나(into), 선택한 아이콘 오른쪽에 놓고 연결(next)
  const addSuggested = useCallback((payload, target) => {
    if (!target) return addAtCenter(payload);
    const g = currentGraph();
    const ids = allIds(g);
    let parent = null, pos = null, connectFrom = null;
    if (target.mode === 'into') {
      parent = target.id;
      pos = freeSlot(g, parent);
    } else {
      const src = g.nodes.find((n) => n.id === target.id);
      if (!src) return addAtCenter(payload);
      parent = src.parent || null;
      connectFrom = src.id;
      const sw = src.type === 'card' ? src.w + 30 : 140, sh = src.type === 'card' ? src.h + 24 : 110;
      const taken = (x, y) => g.nodes.some((n) => (n.parent || null) === parent && Math.abs(n.x - x) < sw - 40 && Math.abs(n.y - y) < sh - 30);
      pos = [[sw, 0], [sw, sh], [0, sh], [-sw, 0], [sw, -sh], [0, -sh]].map(([dx, dy]) => ({ x: src.x + dx, y: src.y + dy })).find((p) => !taken(p.x, p.y)) || freeSlot(g, parent);
    }
    let id;
    if (payload.type === 'card' || (payload.type === 'icon' && g.mode === 'card')) {
      id = uid('c', ids);
      const icon = payload.key ? catalog.icons.get(payload.key) : null;
      g.nodes.push({ id, type: 'card', icon: payload.key || null, label: icon?.name || '제목', body: icon ? '' : '설명을 적어 주세요', parent, x: pos.x, y: pos.y, ...CARD_DEFAULT });
    } else if (payload.type === 'icon') {
      id = uid('n', ids);
      g.nodes.push({ id, icon: payload.key, label: catalog.icons.get(payload.key)?.name || '', parent, x: pos.x, y: pos.y });
    } else {
      id = uid(payload.kind, ids);
      g.groups.push({ id, kind: payload.kind, label: catalog.kinds.get(payload.kind)?.name || '', parent, x: pos.x, y: pos.y, ...GROUP_DEFAULT });
      g.groups = sortGroups(g.groups);
    }
    if (connectFrom) g.edges.push({ ...EDGE_DEFAULTS, id: uid('e', ids), source: connectFrom, target: id });
    if (!tryCommit(g)) return;
    setTimeout(() => rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id }))), 0);
  }, [addAtCenter, catalog, currentGraph, rf, tryCommit]);

  // ----- 선택 항목을 그룹으로 묶기 -----
  const wrapSelection = useCallback(() => {
    const g = currentGraph();
    const sel = rf.getNodes().filter((n) => n.selected).map((n) => n.id);
    if (!sel.length) return;
    const rects = absoluteRects(g);
    const byId = new Map([...g.groups, ...g.nodes].map((i) => [i.id, i]));
    const selSet = new Set(sel);
    const tops = sel.filter((id) => { let p = byId.get(id)?.parent, guard = 0; while (p && guard++ < 64) { if (selSet.has(p)) return false; p = byId.get(p)?.parent; } return true; });
    const PAD = 24, TOP = 44;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of tops) { const r = rects.get(id); x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h + ('w' in byId.get(id) ? 0 : 30)); }
    const parent = byId.get(tops[0]).parent || null;
    const pr = parent ? rects.get(parent) : { x: 0, y: 0 };
    const id = uid('group', allIds(g));
    const grp = { id, kind: 'generic', label: '상자', parent, x: Math.round(x0 - PAD - pr.x), y: Math.round(y0 - TOP - pr.y), w: Math.round(x1 - x0 + PAD * 2), h: Math.round(y1 - y0 + TOP + PAD) };
    g.groups.push(grp);
    const gAbs = { x: x0 - PAD, y: y0 - TOP };
    for (const tid of tops) { const it = byId.get(tid); const r = rects.get(tid); it.parent = id; it.x = Math.round(r.x - gAbs.x); it.y = Math.round(r.y - gAbs.y); }
    g.groups = sortGroups(g.groups);
    if (!tryCommit(g)) return;
    setTimeout(() => rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id }))), 0);
  }, [tryCommit, currentGraph, rf]);

  // ----- 속성 편집 -----
  const updateItem = useCallback((id, set, coalesceKey) => {
    const g = currentGraph();
    const item = g.groups.find((x) => x.id === id) || g.nodes.find((x) => x.id === id) || g.edges.find((x) => x.id === id);
    if (!item) return;
    for (const [k, v] of Object.entries(set)) { if (v === undefined) delete item[k]; else item[k] = v; }   // undefined = 덮어쓰기 제거(기본값으로)
    tryCommit(g, undefined, { coalesce: coalesceKey });
  }, [tryCommit, currentGraph]);

  const setDoc = useCallback((patch) => { const g = currentGraph(); Object.assign(g, patch); commit(g); }, [commit, currentGraph]);

  const updateContext = useCallback((ctx) => {
    const g = currentGraph();
    g.context = { ...g.context, ...ctx };
    commit(g, undefined, { coalesce: 'context' });
  }, [commit, currentGraph]);

  // ----- AI: 검수(annotate 핀) / 그리기(패치 명령 미리보기 → 적용) -----
  const askHistory = useRef([]);   // 자유 질문 이어가기용 (최근 6개)
  const runAi = useCallback(async (mode, request = '') => {
    if (viewRef.current?.aiOff) { toastMsg('AI 기능이 꺼져 있습니다. 보기 설정에서 켤 수 있습니다.'); return; }
    if (!isVerified(aiSettings)) { pendingDraw.current = request; setConnect({ open: true, pending: mode }); return; }
    const g = currentGraph();
    const docId = docsRef.current.active;   // 결과는 요청한 탭에 붙인다 (그사이 탭을 옮겨도)
    const docTitle = docsRef.current.list.find((x) => x.id === docId)?.title || g.title;
    const msgs = mode === 'review' ? buildReviewMessages(g, catalog, lintRef.current)
      : mode === 'ask' ? buildAskMessages(g, catalog, request, lintRef.current, askHistory.current)
      : buildDrawMessages(g, catalog, request, lintRef.current);
    const ac = new AbortController();
    aiAbort.current?.abort();
    aiAbort.current = ac;
    setAi((s) => ({ busy: mode, result: mode === 'ask' ? s.result : null, error: null, question: mode === 'ask' ? request : s.question }));
    setPanel('ai');
    const t0 = Date.now();
    try {
      const raw = await aiRun(aiSettings, { ...msgs, signal: ac.signal, maxTokens: mode === 'ask' ? 4000 : 16000 });
      if (ac.signal.aborted) return;
      if (mode === 'ask') {
        const prevHist = docsRef.current.active === docId ? askHistory.current : (tabAi.current.get(docId) || []);
        const thread = [...prevHist, { role: 'user', text: request }, { role: 'ai', text: raw }].slice(-6);
        if (docsRef.current.active === docId) askHistory.current = thread; else tabAi.current.set(docId, thread);
        setAi((s) => ({ busy: null, error: null, question: request, result: { mode: 'ask', docId, docTitle, raw, ms: Date.now() - t0, provider: providerById(aiSettings.provider)?.name || aiSettings.provider, question: request, answer: raw, thread } }));
        return;
      }
      const j = parseJsonReply(raw);
      const base = { mode, docId, docTitle, raw, ms: Date.now() - t0, provider: providerById(aiSettings.provider)?.name || aiSettings.provider, summary: String(j.summary || '') };
      if (mode === 'review') {
        const { annotations, dropped } = findingsToAnnotations(j.findings, g);
        if (docsRef.current.active === docId) {
          const cur = currentGraph();
          cur.annotations = [...cur.annotations.filter((a) => !String(a.id).startsWith('ai-')), ...annotations];
          commit(cur);
        } else {
          // 다른 탭으로 옮겨 간 사이에 끝났으면 그 탭의 저장본에 넣는다
          const saved = loadDoc(docId);
          if (saved) { saved.annotations = [...(saved.annotations || []).filter((a) => !String(a.id).startsWith('ai-')), ...annotations]; saveDoc(docId, saved); }
          toastMsg(`AI 검수 결과를 "${docTitle}" 탭에 넣었습니다.`, 4000);
        }
        setAi({ busy: null, error: null, result: { ...base, findings: annotations, dropped } });
      } else {
        setAi({ busy: null, error: null, result: { ...base, ops: Array.isArray(j.ops) ? j.ops : [] } });
      }
    } catch (e) {
      if (ac.signal.aborted || e?.kind === 'cancel') { setAi({ busy: null, result: null, error: null }); return; }
      setAi({ busy: null, result: null, error: { message: e.message || String(e), detail: e.detail, kind: e.kind } });
    }
  }, [aiSettings, catalog, commit, currentGraph, toastMsg]);

  const runAiRef = useRef(runAi);
  runAiRef.current = runAi;

  // ----- 가이드 -----
  const loadTemplateById = useCallback((id) => {
    const t = BUILTIN_TEMPLATES.find((x) => x.meta?.id === id);
    if (!t) return;
    const { meta, ...g } = t;
    commit({ ...g, title: meta.name, context: contextRef.current, theme: themeRef.current }, undefined, { fit: true });
  }, [commit]);
  const applyOpsRaw = useCallback((ops) => {
    const r = applyPatch(currentGraph(), ops, catalog.check);
    const ok = tryCommit(r.graph);
    if (ok) setTimeout(() => rf.fitView({ padding: 0.08, duration: 300 }), 30);
    return { ...r, blocked: !ok };
  }, [catalog, currentGraph, tryCommit, rf]);
  const startGuide = useCallback(() => { setGuide({ ...emptyGuide(), docId: docsRef.current.active }); setPanel('guide'); }, [setGuide]);

  const applyAiOps = useCallback((ops) => {
    const owner = ai.result?.docId;
    if (owner && owner !== docsRef.current.active) {
      const name = docsRef.current.list.find((x) => x.id === owner)?.title;
      if (!name) { toastMsg('이 명령을 만든 탭이 닫혀서 적용할 수 없습니다.'); return; }
      switchDoc(owner);
      toastMsg(`이 명령은 "${name}" 탭에서 만든 것이라 그 탭으로 이동했습니다. [적용]을 다시 누르십시오.`, 5000);
      return;
    }
    const r = applyPatch(currentGraph(), ops, catalog.check);
    const ok = tryCommit(r.graph);
    setAi((s) => ({ ...s, result: s.result ? { ...s.result, applied: { ...r, blocked: !ok } } : s.result }));
  }, [catalog, currentGraph, tryCommit, ai.result, switchDoc, toastMsg]);

  const selectById = useCallback((id) => {
    rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
    rf.setEdges((es) => es.map((e) => ({ ...e, selected: e.id === id })));
  }, [rf]);

  // ----- 오른쪽 클릭 메뉴 만들기 -----
  const removeItems = useCallback((ids) => {
    const g = currentGraph();
    const r = applyPatch(g, ids.map((id) => ({ op: 'remove', id })), catalog.check);
    commit(r.graph);
  }, [catalog, commit, currentGraph]);
  // 복제: 아이콘·카드는 그대로, 그룹은 안의 것과 그 사이 연결선까지 통째로. 여러 개도 한 번에.
  const duplicateItems = useCallback((ids) => {
    const g = currentGraph();
    const taken = allIds(g);
    const want = new Set(ids);
    // 선택한 것 중 다른 선택 항목 안에 이미 들어 있는 건 빼고(부모가 복제하면 같이 따라온다)
    const roots = [...g.groups, ...g.nodes].filter((x) => want.has(x.id)).filter((x) => { let p = x.parent; while (p) { if (want.has(p)) return false; p = g.groups.find((q) => q.id === p)?.parent; } return true; });
    if (!roots.length) return;
    const map = new Map();
    const newId = (old, prefix) => { const id = uid(prefix, taken); taken.add(id); map.set(old, id); return id; };
    const sub = new Set();
    for (const r of roots) { sub.add(r.id); if (g.groups.some((q) => q.id === r.id)) for (const d of descendants(g, r.id)) sub.add(d); }
    const groups = g.groups.filter((x) => sub.has(x.id)).map((x) => ({ ...x, id: newId(x.id, 'g') }));
    const nodes = g.nodes.filter((x) => sub.has(x.id)).map((x) => ({ ...x, id: newId(x.id, x.type === 'card' ? 'c' : 'n') }));
    renewSets([...groups, ...nodes]);
    for (const x of [...groups, ...nodes]) {
      const isRoot = roots.some((r) => map.get(r.id) === x.id);
      x.parent = map.get(x.parent) || x.parent || null;
      if (isRoot) { x.x += 40; x.y += 40; }
    }
    const edges = g.edges.filter((e) => sub.has(e.source) && sub.has(e.target)).map((e) => ({ ...e, id: uid('e', taken), source: map.get(e.source), target: map.get(e.target) }));
    edges.forEach((e) => taken.add(e.id));
    g.groups.push(...groups); g.nodes.push(...nodes); g.edges.push(...edges);
    const fresh = new Set(roots.map((r) => map.get(r.id)));
    if (tryCommit(g)) setTimeout(() => { rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: fresh.has(n.id) }))); rf.setEdges((es) => es.map((x) => ({ ...x, selected: false }))); }, 0);
  }, [currentGraph, tryCommit, rf]);
  const duplicateNode = useCallback((id) => duplicateItems([id]), [duplicateItems]);

  // ----- 요소 복사·잘라내기·붙여넣기 (Ctrl+C / X / V). 앱 안 클립보드 + 시스템 클립보드(텍스트) 둘 다 -----
  const clip = useRef(null);
  const lastPointer = useRef(null);   // 캔버스 위 마지막 마우스 위치(흐름 좌표). 붙여넣기 자리
  const copySelection = useCallback(async () => {
    const ids = rf.getNodes().filter((n) => n.selected).map((n) => n.id);
    if (!ids.length) return false;
    const piece = extractSubgraph(currentGraph(), ids);
    if (!piece) return false;
    clip.current = piece;
    try { await navigator.clipboard.writeText(CLIP_MARK + '\n' + JSON.stringify(piece)); } catch { /* 권한 없으면 앱 안 클립보드만 */ }
    const n = piece.nodes.length, gcount = piece.groups.length;
    toastMsg(`복사했습니다 · ${gcount ? `그룹 ${gcount}, ` : ''}노드 ${n}. Ctrl+V 로 붙여 넣습니다.`, 2200);
    return true;
  }, [rf, currentGraph, toastMsg]);
  const cutSelection = useCallback(async () => {
    const ids = rf.getNodes().filter((n) => n.selected).map((n) => n.id);
    if (!ids.length) return;
    if (await copySelection()) removeItems(ids);
  }, [rf, copySelection, removeItems]);
  const pasteClip = useCallback(async (at) => {
    let piece = clip.current;
    try {
      const t = IS_SAFARI ? '' : await navigator.clipboard.readText();
      if (t && t.startsWith(CLIP_MARK)) piece = JSON.parse(t.slice(CLIP_MARK.length));
    } catch { /* 읽기 권한 없으면 앱 안 클립보드 */ }
    if (!piece) { toastMsg('붙여 넣을 것이 없습니다. 먼저 요소를 선택하고 Ctrl+C 를 누르십시오.'); return; }
    const g = currentGraph();
    let pos = at || lastPointer.current;
    if (!pos) {
      // 마우스 위치를 모르면 화면 가운데
      const el = wrapRef.current?.getBoundingClientRect();
      pos = el ? rf.screenToFlowPosition({ x: el.left + el.width / 2, y: el.top + el.height / 2 }) : { x: 0, y: 0 };
      const sz = subgraphSize(piece); pos = { x: pos.x - sz.w / 2, y: pos.y - sz.h / 2 };
    }
    const fresh = new Set(insertSubgraph(g, piece, { at: { x: Math.round(pos.x), y: Math.round(pos.y) } }));
    if (tryCommit(g)) setTimeout(() => { rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: fresh.has(n.id) }))); rf.setEdges((es) => es.map((x) => ({ ...x, selected: false }))); }, 0);
  }, [currentGraph, tryCommit, rf, toastMsg]);
  // 화살표로 1px(Shift: 10px) 옮기기
  const nudgeSelection = useCallback((dx, dy) => {
    const ids = new Set(rf.getNodes().filter((n) => n.selected).map((n) => n.id));
    if (!ids.size) return false;
    const g = currentGraph();
    const parentOf = (id) => (g.groups.find((q) => q.id === id) || g.nodes.find((q) => q.id === id))?.parent;
    // 부모가 함께 선택돼 있으면 부모만 옮긴다(안의 것은 따라온다). 잠긴 것은 움직이지 않는다
    const top = (x) => { for (let p = x.parent; p; p = parentOf(p)) if (ids.has(p)) return false; return true; };
    for (const x of [...g.groups, ...g.nodes]) if (ids.has(x.id) && !x.locked && top(x)) { x.x += dx; x.y += dy; }
    tryCommit(g, undefined, { coalesce: 'nudge' });
    return true;
  }, [rf, currentGraph, tryCommit]);
  // 조각 템플릿: 선택을 저장 / 메뉴에서 골라 끼워 넣기
  const saveSelectionAsPiece = useCallback(async () => {
    const ids = rf.getNodes().filter((n) => n.selected).map((n) => n.id);
    const piece = ids.length ? extractSubgraph(currentGraph(), ids) : null;
    if (!piece) { toastMsg('먼저 조각으로 저장할 요소를 선택하십시오.'); return; }
    const name = window.prompt('조각 이름 (예: 2-AZ 웹 계층, VPN 연결)', '');
    if (!name?.trim()) return;
    try {
      await saveUserTemplate({ ...emptyGraph(name.trim()), groups: piece.groups, nodes: piece.nodes, edges: piece.edges, roots: piece.roots }, name.trim(), { piece: true });
      setUserTemplates(await loadUserTemplates());
      toastMsg(`조각으로 저장했습니다: ${name.trim()} · 템플릿 메뉴 [내 조각]`, 3500);
    } catch (e) { toastMsg('저장 실패: ' + (e.message || e)); }
  }, [rf, currentGraph, toastMsg]);
  const insertPiece = useCallback((t) => {
    const { meta, ...pg } = t;
    const roots = pg.roots || [...pg.groups, ...pg.nodes].filter((x) => !x.parent).map((x) => x.id);
    const piece = { groups: pg.groups, nodes: pg.nodes, edges: pg.edges || [], roots };
    const g = currentGraph();
    const el = wrapRef.current?.getBoundingClientRect();
    const c = el ? rf.screenToFlowPosition({ x: el.left + el.width / 2, y: el.top + el.height / 2 }) : { x: 0, y: 0 };
    const sz = subgraphSize(piece);
    const fresh = new Set(insertSubgraph(g, piece, { at: { x: Math.round(c.x - sz.w / 2), y: Math.round(c.y - sz.h / 2) } }));
    if (tryCommit(g)) setTimeout(() => { rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: fresh.has(n.id) }))); toastMsg(`끼워 넣었습니다: ${meta?.name || ''} · 끌어서 자리를 잡으십시오.`, 3000); }, 0);
  }, [currentGraph, tryCommit, rf, toastMsg]);
  const removeTemplate = useCallback(async (t) => {
    if (!window.confirm(`"${t.meta?.name}" 을(를) 템플릿 메뉴에서 지우시겠습니까?`)) return;
    try { await deleteUserTemplate(t); setUserTemplates(await loadUserTemplates()); } catch (e) { toastMsg('지우지 못했습니다: ' + (e.message || e)); }
  }, [toastMsg]);
  const askAboutNode = useCallback((n) => {
    const name = n.data?.label || catalog.icons.get(n.data?.icon)?.name || n.id;
    runAi('ask', `"${name}" (id: ${n.id}) 에 대해 묻습니다. 이 요소가 현재 다이어그램에서 하는 역할은 무엇이고, 제안서 관점에서 빠지거나 보강할 점이 있습니까? 제안서에 적을 한 줄 설명도 부탁합니다.`);
  }, [catalog, runAi]);
  const askAboutEdge = useCallback((e) => {
    runAi('ask', `연결선 ${e.source} → ${e.target}${e.data?.label ? ` ("${e.data.label}")` : ''} 에 대해 묻습니다. 이 연결이 어떤 통신/흐름인지, 프로토콜·포트·보안 관점에서 주의할 점과 제안서에 적을 한 줄 설명을 부탁합니다.`);
  }, [runAi]);

  // 정렬 · 간격 · 크기 맞추기 (선택한 노드들)
  const selIds = () => rf.getNodes().filter((n) => n.selected).map((n) => n.id);
  // 잠근 것은 정렬·간격·크기 맞추기에서 빠진다
  const freeOf = (ids) => { const out = ids.filter((id) => !rf.getNode(id)?.data?.locked); if (out.length < ids.length) toastMsg(`잠긴 ${ids.length - out.length}개는 움직이지 않습니다.`, 2200); return out; };
  const alignSel = useCallback((how, ids0 = selIds()) => { const ids = freeOf(ids0); if (ids.length < 2) { toastMsg('두 개 이상 선택하십시오.'); return; } tryCommit(alignItems(currentGraph(), ids, how)); }, [currentGraph, tryCommit, toastMsg]); // eslint-disable-line react-hooks/exhaustive-deps
  const distributeSel = useCallback((axis, ids0 = selIds()) => { const ids = freeOf(ids0); if (ids.length < 3) { toastMsg('간격 맞추기는 세 개 이상 선택하십시오.'); return; } tryCommit(distributeItems(currentGraph(), ids, axis)); }, [currentGraph, tryCommit, toastMsg]); // eslint-disable-line react-hooks/exhaustive-deps
  const sameSizeSel = useCallback((dim, ids0 = selIds()) => { const ids = freeOf(ids0); if (canResizeCount(currentGraph(), ids) < 2) { toastMsg('크기 맞추기는 그룹이나 카드를 두 개 이상 선택하십시오.'); return; } tryCommit(sameSize(currentGraph(), ids, dim)); }, [currentGraph, tryCommit, toastMsg]); // eslint-disable-line react-hooks/exhaustive-deps

  // 레이어: 앞뒤 순서, 잠금, 패널에서 끌어 옮기기
  const orderSel = useCallback((how, ids) => {
    const list = ids || [...rf.getNodes().filter((n) => n.selected).map((n) => n.id)];
    if (!list.length) return;
    const g0 = currentGraph(), g1 = reorder(g0, list, how);
    const key = (g) => g.groups.map((x) => x.id).join() + '|' + g.nodes.map((x) => x.id).join();
    if (key(g0) === key(g1)) { toastMsg(how === 'front' || how === 'forward' ? '이미 맨 앞입니다.' : '더 뒤로 갈 수 없습니다. 상자 안의 것은 그 상자보다 뒤로 가지 않습니다.', 2600); return; }
    tryCommit(g1);
  }, [rf, currentGraph, tryCommit, toastMsg]);
  // 묶기 (Ctrl+G): 파워포인트처럼 보이지 않는 묶음. 하나를 클릭하면 모두 선택되고 함께 움직인다
  const groupSel = useCallback((ids) => {
    const list = ids || rf.getNodes().filter((n) => n.selected).map((n) => n.id);
    if (list.length < 2) { toastMsg('묶으려면 두 개 이상 선택하십시오.'); return; }
    const g = currentGraph(), want = new Set(list), sid = newSetId();
    const old = new Set([...g.groups, ...g.nodes].filter((x) => want.has(x.id) && x.set).map((x) => x.set));   // 이미 묶인 것은 통째로 합친다
    for (const x of [...g.groups, ...g.nodes]) if (want.has(x.id) || (x.set && old.has(x.set))) x.set = sid;
    commit(g);
    toastMsg('묶었습니다. 하나를 클릭하면 함께 선택되고 함께 움직입니다. 풀기: Ctrl+Shift+G', 3200);
  }, [rf, currentGraph, commit, toastMsg]);
  const ungroupSel = useCallback((ids) => {
    const list = new Set(ids || rf.getNodes().filter((n) => n.selected).map((n) => n.id));
    const g = currentGraph();
    const sets = new Set([...g.groups, ...g.nodes].filter((x) => list.has(x.id) && x.set).map((x) => x.set));
    if (!sets.size) { toastMsg('선택한 것에 묶음이 없습니다.'); return; }
    for (const x of [...g.groups, ...g.nodes]) if (x.set && sets.has(x.set)) delete x.set;
    commit(g);
    toastMsg('묶음을 풀었습니다.', 2000);
  }, [rf, currentGraph, commit, toastMsg]);
  const lockItems = useCallback((ids, on) => {
    const g = currentGraph(); const want = new Set(ids);
    for (const x of [...g.groups, ...g.nodes]) if (want.has(x.id)) { if (on) x.locked = true; else delete x.locked; }
    commit(g);
    toastMsg(on ? '잠갔습니다. 끌기·화살표·정렬·크기 조절로 바뀌지 않습니다. 오른쪽 클릭 [잠금 해제] 또는 Ctrl+L 로 풉니다.' : '잠금을 풀었습니다.', 3000);
  }, [currentGraph, commit, toastMsg]);
  const layerMove = useCallback((id, target) => {
    const g = currentGraph();
    const g1 = placeFront(g, id, target);
    if (g1 === g) { toastMsg('아이콘·글은 늘 상자보다 앞에 그려집니다. 같은 종류끼리 순서를 바꾸십시오.', 2600); return; }
    tryCommit(g1);
  }, [currentGraph, tryCommit, toastMsg]);

  // 화면에 보이는 이름 (id 대신)  — labelOfRef 는 위쪽(끄는 중 안내)에서 쓰려고
  const labelOf = useCallback((id) => {
    const n = rf.getNode(id);
    if (!n) return '(없음)';
    return n.data?.label || (n.type === 'awsGroup' ? catalog.kinds.get(n.data?.kind)?.name : catalog.icons.get(n.data?.icon)?.name) || '이름 없음';
  }, [rf, catalog]);

  labelOfRef.current = labelOf;
  const onNodeContextMenu = useCallback((e, node) => {
    e.preventDefault();
    const d = node.data || {};
    const sel = rf.getNodes().filter((n) => n.selected).map((n) => n.id);
    const ids = sel.includes(node.id) && sel.length > 1 ? sel : [node.id];
    if (!sel.includes(node.id)) selectById(node.id);
    const items = [];
    const many = ids.length > 1;
    if (node.type === 'awsGroup') {
      const base = catalog.kinds.get(d.kind);
      items.push({ label: '라벨 바꾸기…', action: () => { const v = window.prompt('그룹 라벨', d.label || ''); if (v != null) updateItem(node.id, { label: v }); } });
      items.push({ label: '종류', options: [['vpc', 'VPC'], ['az', 'AZ'], ['public-subnet', '퍼블릭'], ['private-subnet', '프라이빗'], ['section', '섹션']], value: d.kind, onPick: (v) => updateItem(node.id, { kind: v }) });
      items.push({ label: '선', options: [['solid', '실선'], ['dashed', '점선'], ['none', '없음']], value: d.line || base?.line, onPick: (v) => updateItem(node.id, { line: v }) });
      items.push({ label: '테두리 색', color: true, value: d.color || base?.color, onPick: (v) => updateItem(node.id, { color: v }, 'color:' + node.id), onReset: () => updateItem(node.id, { color: undefined }) });
      items.push('sep');
      items.push({ label: '안의 요소 모두 선택', action: () => { const g = currentGraph(); const ds = descendants(g, node.id); rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: ds.has(n.id) }))); } });
    } else if (node.type === 'awsCard') {
      items.push({ label: '제목 바꾸기…', action: () => { const v = window.prompt('카드 제목', d.label || ''); if (v != null) updateItem(node.id, { label: v }); } });
      items.push({ label: '설명 바꾸기…', action: () => { const v = window.prompt('카드 설명 (줄바꿈은 패널에서)', d.body || ''); if (v != null) updateItem(node.id, { body: v }); } });
      items.push({ label: '강조색', color: true, value: d.accent, onPick: (v) => updateItem(node.id, { accent: v }, 'accent:' + node.id), onReset: () => updateItem(node.id, { accent: undefined }) });
      items.push({ label: '아이콘 바꾸기 (패널)', action: () => setPanel(null) });
    } else if (node.type === 'awsText') {
      items.push({ label: '글 바꾸기 (패널)', action: () => setPanel(null) });
      items.push({ label: '크기', options: [['sm', '작게'], ['md', '보통'], ['lg', '크게'], ['xl', '제목']], value: d.size || 'md', onPick: (v) => updateItem(node.id, { size: v }) });
      items.push({ label: '굵게', options: [['0', '보통'], ['1', '굵게']], value: d.bold ? '1' : '0', onPick: (v) => updateItem(node.id, { bold: v === '1' }) });
      items.push({ label: '글자색', color: true, value: d.accent, onPick: (v) => updateItem(node.id, { accent: v }, 'accent:' + node.id), onReset: () => updateItem(node.id, { accent: undefined }) });
    } else if (node.type === 'awsBadge') {
      items.push({ label: '번호 바꾸기…', action: () => { const v = window.prompt('번호 (또는 짧은 글자)', d.label || ''); if (v != null && v.trim()) updateItem(node.id, { label: v.trim().slice(0, 3) }); } });
      items.push({ label: '색', color: true, value: d.accent, onPick: (v) => updateItem(node.id, { accent: v }, 'accent:' + node.id), onReset: () => updateItem(node.id, { accent: undefined }) });
    } else {
      items.push({ label: '라벨 바꾸기…', action: () => { const v = window.prompt('라벨', d.label || ''); if (v != null) updateItem(node.id, { label: v }); } });
      items.push({ label: '아이콘 바꾸기 (팔레트에서 검색 후 클릭)', action: () => document.querySelector('.palette .search')?.focus() });
    }
    items.push('sep');
    items.push({ label: '맨 앞으로 가져오기', hint: 'Ctrl+Shift+]', action: () => orderSel('front', ids) });
    items.push({ label: '앞으로 가져오기', hint: 'Ctrl+]', action: () => orderSel('forward', ids) });
    items.push({ label: '뒤로 보내기', hint: 'Ctrl+[', action: () => orderSel('backward', ids) });
    items.push({ label: '맨 뒤로 보내기', hint: 'Ctrl+Shift+[', action: () => orderSel('back', ids) });
    if (many) items.push({ label: `${ids.length}개 묶기`, hint: 'Ctrl+G', action: () => groupSel(ids) });
    if (d.set || (many && ids.some((id) => rf.getNode(id)?.data?.set))) items.push({ label: '묶음 풀기', hint: 'Ctrl+Shift+G', action: () => ungroupSel(ids) });
    items.push({ label: d.locked ? '잠금 해제' : '잠그기', hint: 'Ctrl+L', action: () => lockItems(ids, !d.locked) });
    items.push({ label: '레이어 목록 보기', hint: '전체 순서', action: () => setPanel('layers') });
    items.push('sep');
    items.push({ label: many ? `${ids.length}개 복사` : '복사', hint: 'Ctrl+C', action: () => copySelection() });
    items.push({ label: many ? `${ids.length}개 잘라내기` : '잘라내기', hint: 'Ctrl+X', action: () => cutSelection() });
    items.push({ label: many ? `${ids.length}개 복제` : node.type === 'awsGroup' ? '안의 것까지 복제' : '복제', hint: 'Ctrl+D', action: () => duplicateItems(ids) });
    items.push({ label: many ? '선택을 조각 템플릿으로 저장…' : '조각 템플릿으로 저장…', hint: '템플릿 메뉴에 추가', action: () => saveSelectionAsPiece() });
    if (many) items.push({ label: `${ids.length}개를 새 상자로 감싸기`, hint: '상자를 만들어 안에 넣기', action: wrapSelection });
    if (many) {
      items.push({ label: '가로 정렬', options: [['left', '왼쪽'], ['hcenter', '가운데'], ['right', '오른쪽']], value: null, onPick: (v) => alignSel(v, ids) });
      items.push({ label: '세로 정렬', options: [['top', '위'], ['vcenter', '가운데'], ['bottom', '아래']], value: null, onPick: (v) => alignSel(v, ids) });
      if (ids.length >= 3) items.push({ label: '간격 맞추기', options: [['h', '가로'], ['v', '세로']], value: null, onPick: (v) => distributeSel(v, ids) });
      if (canResizeCount(currentGraph(), ids) >= 2) items.push({ label: '크기 맞추기', options: [['w', '너비'], ['h', '높이'], ['both', '둘 다']], value: null, onPick: (v) => sameSizeSel(v, ids) });
    }
    if (node.type !== 'awsGroup' || true) items.push({ label: 'AI에게 물어보기', ask: true, action: () => askAboutNode(node) });
    items.push('sep');
    items.push({ label: many ? `${ids.length}개 삭제` : '삭제', hint: 'Delete', danger: true, action: () => removeItems(ids) });
    setCtx({ x: e.clientX, y: e.clientY, title: node.type === 'awsGroup' ? (d.label || '그룹') : node.type === 'awsCard' ? (d.label || '카드') : node.type === 'awsText' ? '글상자' : node.type === 'awsBadge' ? `번호 ${d.label || ''}` : (d.label || catalog.icons.get(d.icon)?.name || '아이콘'), items });
  }, [rf, catalog, selectById, updateItem, currentGraph, duplicateItems, wrapSelection, askAboutNode, removeItems, alignSel, distributeSel, sameSizeSel, copySelection, cutSelection, saveSelectionAsPiece, orderSel, lockItems, groupSel, ungroupSel]);

  // Shift+클릭 다중 선택: Shift 는 영역 선택 키이기도 해서 React Flow 기본 다중 선택이 안 먹는다.
  // 클릭 직전 선택을 기억해 두었다가, Shift+클릭이면 그 선택에 더하거나(이미 있으면 빼기) 되돌린다.
  const prevSel = useRef({ nodes: [], edges: [] });
  const rememberSelection = useCallback(() => {
    prevSel.current = { nodes: rf.getNodes().filter((n) => n.selected).map((n) => n.id), edges: rf.getEdges().filter((x) => x.selected).map((x) => x.id) };
  }, [rf]);
  const shiftToggle = useCallback((kind, id) => {
    const p = prevSel.current;
    const set = (list) => new Set(list);
    const ns = set(p.nodes), es = set(p.edges);
    const target = kind === 'node' ? ns : es;
    const on = !target.has(id);
    const grpSet = kind === 'node' ? rf.getNode(id)?.data?.set : null;
    const ids = grpSet ? rf.getNodes().filter((n) => n.data?.set === grpSet).map((n) => n.id) : [id];
    for (const x of ids) { if (on) target.add(x); else target.delete(x); }
    rf.setNodes((all) => all.map((n) => (n.selected === ns.has(n.id) ? n : { ...n, selected: ns.has(n.id) })));
    rf.setEdges((all) => all.map((x) => (x.selected === es.has(x.id) ? x : { ...x, selected: es.has(x.id) })));
  }, [rf]);
  // Shift 를 누르면 React Flow 가 영역 선택용 덮개를 깔아서 선/노드 클릭이 안 닿는다.
  // 그래서 캡처 단계에서 포인터 아래 요소를 직접 찾아 토글하고, 이 클릭은 React Flow 로 보내지 않는다.
  const shiftHandled = useRef(false);
  const onCanvasPointerDownCapture = useCallback((e) => {
    altPressed.current = !!e.altKey;
    rememberSelection();
    shiftHandled.current = false;
    if (e.button === 0 && !(e.shiftKey || e.ctrlKey || e.metaKey)) {
      const el = e.target.closest?.('.react-flow__node');
      const set = el?.dataset.id ? rf.getNode(el.dataset.id)?.data?.set : null;
      if (set && !rf.getNode(el.dataset.id)?.selected) rf.setNodes((ns) => ns.map((n) => { const want = n.data?.set === set; return n.selected === want ? n : { ...n, selected: want }; }));
    }
    if (!(e.shiftKey || e.ctrlKey || e.metaKey) || e.button !== 0) return;
    const hit = document.elementsFromPoint(e.clientX, e.clientY);
    for (const el of hit) {
      const edgeEl = el.closest?.('g.react-flow__edge');
      if (edgeEl?.dataset.id) { shiftToggle('edge', edgeEl.dataset.id); shiftHandled.current = true; break; }
      const nodeEl = el.closest?.('.react-flow__node');
      if (nodeEl?.dataset.id) { shiftToggle('node', nodeEl.dataset.id); shiftHandled.current = true; break; }
      const lbl = el.closest?.('.edge-label');
      if (lbl) break;
    }
    if (shiftHandled.current) { e.stopPropagation(); e.preventDefault(); }
  }, [rememberSelection, shiftToggle, rf]);
  const onCanvasClickCapture = useCallback((e) => { if (shiftHandled.current) { e.stopPropagation(); e.preventDefault(); shiftHandled.current = false; } }, []);
  const onEdgeClick = useCallback(() => {}, []);
  const onNodeClick = useCallback(() => {}, []);

  // 여러 개를 한 번에 바꾸기 (되돌리기 한 번에 묶임)
  const updateMany = useCallback((ids, set) => {
    const g = currentGraph();
    const want = new Set(ids);
    for (const item of [...g.groups, ...g.nodes, ...g.edges]) {
      if (!want.has(item.id)) continue;
      for (const [k, v] of Object.entries(set)) { if (v === undefined) delete item[k]; else item[k] = v; }
    }
    tryCommit(g);
  }, [currentGraph, tryCommit]);

  const onEdgeContextMenu = useCallback((e, edge) => {
    e.preventDefault();
    // 이미 여러 선이 선택돼 있고 그중 하나를 눌렀으면 선택 유지 → 전부에 적용
    const selE = rf.getEdges().filter((x) => x.selected).map((x) => x.id);
    const ids = selE.includes(edge.id) && selE.length > 1 ? selE : [edge.id];
    if (ids.length === 1) {
      rf.setEdges((es) => es.map((x) => ({ ...x, selected: x.id === edge.id })));
      rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: false })));
    }
    const many = ids.length > 1;
    const all = rf.getEdges().filter((x) => ids.includes(x.id));
    const same = (k) => (all.every((x) => x.data?.[k] === all[0].data?.[k]) ? all[0].data?.[k] : null);   // 다르면 아무것도 표시 안 함
    const d = edge.data || {};
    const items = [
      { label: '모양', options: [['straight', '직선'], ['elbow', '직각'], ['curve', '곡선']], value: same('shape'), onPick: (v) => updateMany(ids, { shape: v }) },
      { label: '선', options: [['solid', '실선'], ['dashed', '점선']], value: same('line'), onPick: (v) => updateMany(ids, { line: v }) },
      { label: '화살표', options: [['end', '끝'], ['both', '양쪽'], ['none', '없음']], value: same('arrow'), onPick: (v) => updateMany(ids, { arrow: v }) },
      'sep',
      ...(many ? [] : [{ label: '라벨 바꾸기…', action: () => { const v = window.prompt('연결선 라벨', d.label || ''); if (v != null) updateItem(edge.id, { label: v }); } }]),
      { label: many ? `방향 뒤집기 (${ids.length}개)` : '방향 뒤집기', action: () => { const g = currentGraph(); for (const ed of g.edges) if (ids.includes(ed.id)) { [ed.source, ed.target] = [ed.target, ed.source]; [ed.sp, ed.tp] = [ed.tp, ed.sp]; if (!ed.sp) delete ed.sp; if (!ed.tp) delete ed.tp; } tryCommit(g); } },
      { label: 'AI에게 물어보기', ask: true, action: () => (many ? askSelRef.current?.('') : askAboutEdge(edge)) },
      'sep',
      { label: many ? `${ids.length}개 삭제` : '삭제', hint: 'Delete', danger: true, action: () => removeItems(ids) },
    ];
    setCtx({ x: e.clientX, y: e.clientY, title: many ? `연결선 ${ids.length}개 · 한꺼번에 바꾸기` : `연결선 ${edge.data?.sp ? '빈 곳' : labelOf(edge.source)} → ${edge.data?.tp ? '빈 곳' : labelOf(edge.target)}`, items });
  }, [rf, updateItem, updateMany, currentGraph, tryCommit, askAboutEdge, removeItems, labelOf]);
  const askSelRef = useRef(null);

  // 연결선 라벨에서 오른쪽 클릭 → 같은 연결선 메뉴
  useEffect(() => {
    const on = (ev) => { const ed = rf.getEdges().find((x) => x.id === ev.detail.id); if (ed) onEdgeContextMenu({ preventDefault() {}, clientX: ev.detail.x, clientY: ev.detail.y }, ed); };
    window.addEventListener('arch-edge-ctx', on);
    return () => window.removeEventListener('arch-edge-ctx', on);
  }, [rf, onEdgeContextMenu]);

  const onPaneContextMenu = useCallback((e) => {
    e.preventDefault();
    const flowPos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const items = [
      { label: '여기에 글상자 추가', hint: '제목·설명·메모', action: () => addAt({ type: 'text' }, flowPos) },
      ...(docMode === 'card'
        ? [{ label: '여기에 카드 추가', action: () => addAt({ type: 'card' }, flowPos) }, { label: '여기에 섹션 추가', action: () => addAt({ type: 'group', kind: 'section' }, flowPos) }]
        : [{ label: '여기에 그룹 추가', action: () => addAt({ type: 'group', kind: 'generic' }, flowPos) }]),
      { label: '여기에 붙여넣기', hint: 'Ctrl+V', action: () => pasteClip(flowPos) },
      { label: '여기에 번호 추가', hint: '①②③', action: () => addAt({ type: 'badge' }, flowPos) },
      'sep',
      { label: '전체 선택', hint: 'Ctrl+A', action: () => rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: true }))) },
      { label: '화면에 맞추기', action: () => rf.fitView({ padding: 0.08, duration: 300 }) },
      { label: view.pins === false ? '경고·참고 표시 보이기' : '경고·참고 표시 숨기기', hint: '제안서 화면용', action: () => setView({ pins: view.pins === false }) },
      'sep',
      { label: 'PNG 복사', hint: 'Ctrl+C', action: () => exportImageRef.current('clipboard', false) },
      { label: 'AI 검수', ask: true, action: () => runAi('review') },
    ];
    setCtx({ x: e.clientX, y: e.clientY, items });
  }, [rf, addAt, docMode, runAi, view.pins, setView, pasteClip]);
  const exportImageRef = useRef(null);

  // 선택한 것들에 대해 묻기 (떠 있는 바에서)
  const askAboutSelection = useCallback((question) => {
    const ns = rf.getNodes().filter((n) => n.selected);
    const es = rf.getEdges().filter((x) => x.selected);
    const names = [
      ...ns.map((n) => `${n.data?.label || catalog.icons.get(n.data?.icon)?.name || n.id} (id: ${n.id})`),
      ...es.map((x) => `연결선 ${x.source} → ${x.target} (id: ${x.id})`),
    ];
    const q = (question || '').trim() || '이 요소들이 현재 다이어그램에서 하는 역할은 무엇이고, 제안서 관점에서 빠지거나 보강할 점이 있습니까? 제안서에 적을 한 줄 설명도 부탁합니다.';
    runAi('ask', `선택한 요소: ${names.join(', ')}\n\n${q}`);
  }, [rf, catalog, runAi]);
  askSelRef.current = askAboutSelection;

  // ----- 이미지 내보내기 (PNG 2배, SVG, PNG 클립보드). 선택이 있으면 선택만. -----
  const renderSvg = useCallback((selectedOnly) => {
    const g = currentGraph();
    let include = null;
    if (selectedOnly) {
      const sel = [...rf.getNodes().filter((n) => n.selected).map((n) => n.id), ...rf.getEdges().filter((e) => e.selected).map((e) => e.id)];
      if (sel.length) include = selectionIds(g, new Set(sel));
    }
    const base = graphToSvg(g, catalog, include, { background: exp.background, padding: exp.padding, textScale: view.textScale });
    return { ...decorateSvg(base, g, { ...exp, titleText: exp.titleText || g.title }), partial: !!include };
  }, [catalog, currentGraph, exp, rf, view.textScale]);

  const exportImage = useCallback(async (what, selectedOnly = true) => {
    const r = renderSvg(selectedOnly);
    if (!r.svg) { toastMsg('내보낼 게 없습니다.'); return; }
    const stem = safeName(title) + (r.partial ? '_선택' : '');
    try {
      if (what === 'svg') {
        const where = await saveBlob(svgToBlob(r.svg), stem + '.svg');
        toastMsg(`SVG 저장했습니다 (${r.width}×${r.height}px)${where === 'downloads' ? ' · 다운로드 폴더' : ''}`);
      } else {
        const k = [1, 2, 3, 4].includes(+exp.scale) ? +exp.scale : 2;
        if (what === 'clipboard') {
          const pngP = svgToPng(r.svg, r.width, r.height, k);
          try {
            await copyPngToClipboard(pngP);
            toastMsg(`PNG 복사했습니다 (${r.width * k}×${r.height * k}px, ${k}배) · PowerPoint에서 ${IS_MAC ? '⌘V' : 'Ctrl+V'}`);
          } catch (e) {
            await saveBlob(await pngP, stem + '.png');
            toastMsg('클립보드에 못 넣었습니다 (' + (e.message || e) + '). 대신 PNG 파일로 저장했습니다.', 6000);
          }
          return;
        }
        const png = await svgToPng(r.svg, r.width, r.height, k);
        if (what === 'png') {
          const where = await saveBlob(png, stem + '.png');
          toastMsg(`PNG 저장했습니다 (${r.width * k}×${r.height * k}px, ${k}배)${where === 'downloads' ? ' · 다운로드 폴더' : ''}`);
        } else {
          try {
            await copyPngToClipboard(png);
            toastMsg(`PNG 복사했습니다 (${r.width * k}×${r.height * k}px, ${k}배) · PowerPoint에서 Ctrl+V`);
          } catch (e) {
            // 클립보드 쓰기가 막힌 환경(권한 거부, 비보안 컨텍스트)이면 파일로 대신 내려준다
            await saveBlob(png, stem + '.png');
            toastMsg('클립보드에 못 넣었습니다 (' + (e.message || e) + '). 대신 PNG 파일로 저장했습니다.', 6000);
          }
        }
      }
    } catch (e) { toastMsg('내보내기 실패: ' + (e.message || e), 5000); }
  }, [renderSvg, title, toastMsg, exp.scale]);
  exportImageRef.current = exportImage;

  // ----- PowerPoint 복사 -----
  const copyPpt = useCallback(async (selectedOnly) => {
    const g = currentGraph();
    let include = null;
    if (selectedOnly) {
      const sel = [...rf.getNodes().filter((n) => n.selected).map((n) => n.id), ...rf.getEdges().filter((e) => e.selected).map((e) => e.id)];
      if (!sel.length) { toastMsg('선택된 게 없습니다. 먼저 골라 주세요.'); return; }
      include = selectionIds(g, new Set(sel));
    }
    const scene = graphToScene(g, catalog, include, { textScale: view.textScale });
    if (!scene.shapes.length) { toastMsg('복사할 게 없습니다.'); return; }
    const st = sceneStats(scene);
    const desc = `도형 ${st.rect + st.pic + st.text + st.cxn}개 (그룹 ${st.rect}, 아이콘 ${st.pic}, 글상자 ${st.text}, 연결선 ${st.cxn}) · ${(scene.width / 360000).toFixed(1)}×${(scene.height / 360000).toFixed(1)}cm`;
    try {
      if (window.desktop) {
        await window.desktop.copyScene(JSON.stringify(scene));
        toastMsg('PowerPoint에서 Ctrl+V · ' + desc, 4000);
      } else {
        downloadText(JSON.stringify(scene), safeName(title) + '.scene.json');
        toastMsg('브라우저에서는 PowerPoint 복사가 안 됩니다. 장면 JSON으로 저장했습니다. ' + desc, 5000);
      }
    } catch (e) {
      toastMsg('복사 실패: ' + (e.message || e));
    }
  }, [catalog, currentGraph, rf, title, toastMsg, view.textScale]);

  // ----- 파일 -----
  // 저장: 탭마다 마지막으로 저장한 파일을 기억해서 Ctrl+S 는 그 파일을 덮어쓰고, Ctrl+Shift+S 는 새 이름으로.
  const fileHandles = useRef(new Map());   // 브라우저(File System Access API)용
  const setTabFile = useCallback((name, path) => {
    const d = docsRef.current;
    setDocs({ ...d, list: d.list.map((x) => (x.id === d.active ? { ...x, file: path || name, fileName: name } : x)) });
  }, [setDocs]);
  const saveJson = useCallback(async (asNew = false) => {
    const g = currentGraph();
    const text = JSON.stringify(g, null, 2);
    const d = docsRef.current;
    const tab = d.list.find((x) => x.id === d.active);
    const suggested = safeName(g.title) + '.arch.json';
    try {
      if (window.desktop?.call) {
        if (!asNew && tab?.file) {
          const r = await window.desktop.call('file.save', { path: tab.file, text });
          if (!r?.needDialog) { toastMsg('저장했습니다: ' + r.name); return; }
        }
        const r = await window.desktop.call('file.saveAs', { name: tab?.fileName || suggested, text });
        if (r?.cancelled) return;
        setTabFile(r.name, r.path); toastMsg('저장했습니다: ' + r.path);
        return;
      }
      if (window.showSaveFilePicker) {
        let h = !asNew && fileHandles.current.get(d.active);
        if (!h) h = await window.showSaveFilePicker({ suggestedName: tab?.fileName || suggested, types: [{ description: 'Arch Canvas 다이어그램', accept: { 'application/json': ['.json'] } }] });
        const w = await h.createWritable(); await w.write(text); await w.close();
        fileHandles.current.set(d.active, h); setTabFile(h.name);
        toastMsg('저장했습니다: ' + h.name);
        return;
      }
      downloadText(text, suggested); toastMsg('다운로드했습니다: ' + suggested);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      toastMsg('저장하지 못했습니다: ' + (e.message || e), 5000);
    }
  }, [currentGraph, toastMsg, setTabFile]);

  const openGraphText = useCallback((text, name, path) => {
    const g = JSON.parse(text);
    if (!g || !Array.isArray(g.nodes)) throw new Error('다이어그램 JSON 형식이 아닙니다');
    const cur = currentGraph();
    if (!cur.nodes.length && !cur.groups.length) commit(normalizeGraph(g), undefined, { fit: true });
    else addDoc(normalizeGraph(g));
    if (path || name) setTimeout(() => setTabFile(name, path), 0);
    toastMsg('불러왔습니다: ' + name);
  }, [commit, currentGraph, addDoc, toastMsg, setTabFile]);
  const openJson = useCallback(async () => {
    if (window.desktop?.call) {
      try { const r = await window.desktop.call('file.open', {}); if (!r?.cancelled) openGraphText(r.text, r.name, r.path); }
      catch (e) { toastMsg('읽지 못했습니다: ' + (e.message || e)); }
      return;
    }
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try { openGraphText(await f.text(), f.name); } catch (e) { toastMsg('읽지 못했습니다: ' + e.message); }
    };
    input.click();
  }, [openGraphText, toastMsg]);

  const loadTemplate = useCallback((t) => {
    const g = currentGraph();
    if ((g.nodes.length || g.groups.length) && !window.confirm('지금 그리던 다이어그램을 이 템플릿으로 바꾸시겠습니까? (Ctrl+Z 로 되돌릴 수 있습니다)')) return;
    const { meta, ...graph } = t;
    // 제안서 컨텍스트와 테마는 그대로 둔다 (템플릿은 그림만 바꾼다)
    commit({ ...graph, title: meta?.name || graph.title, context: g.context, theme: g.theme }, undefined, { fit: true });
  }, [commit, currentGraph]);

  const saveAsTemplate = useCallback(async () => {
    const name = window.prompt('템플릿 이름', title);
    if (!name) return;
    try {
      await saveUserTemplate(currentGraph(), name);
      setUserTemplates(await loadUserTemplates());
      toastMsg('템플릿으로 저장했습니다: ' + name);
    } catch (e) { toastMsg('저장 실패: ' + (e.message || e)); }
  }, [currentGraph, title, toastMsg]);

  // [새로] = 새 탭. 지금 그리던 건 그 탭에 그대로 남는다.
  const newDiagram = useCallback(() => addDoc(), [addDoc]);

  // 더블클릭 · F2: 이름 바꾸기 (오른쪽 패널의 입력칸으로 바로 이동)
  const renameSelected = useCallback(() => {
    const n = rf.getNodes().find((x) => x.selected); const ed = !n && rf.getEdges().find((x) => x.selected);
    if (!n && !ed) return;
    setPanel(null);
    setTimeout(() => { const inp = document.querySelector('.side .insp input, .side .insp textarea'); if (inp) { inp.focus(); inp.select?.(); } }, 50);
  }, [rf]);
  const onNodeDoubleClick = useCallback((e, node) => { e.preventDefault(); selectById(node.id); setTimeout(renameSelected, 0); }, [selectById, renameSelected]);
  const onEdgeDoubleClick = useCallback((e, edge) => { e.preventDefault(); selectById(edge.id); setTimeout(renameSelected, 0); }, [selectById, renameSelected]);

  // ----- 단축키 -----
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || document.activeElement?.isContentEditable) return;
      if (document.querySelector('.modal-back, .tour')) return;   // 모달·둘러보기 뒤 캔버스에는 단축키를 보내지 않는다
      const k = e.key.toLowerCase();
      const textSelected = (window.getSelection()?.toString() || '').trim().length > 0;
      if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'c' && e.shiftKey) { e.preventDefault(); if (isDesktop) copyPpt(rf.getNodes().some((n) => n.selected) || rf.getEdges().some((x) => x.selected)); }
      else if ((e.ctrlKey || e.metaKey) && k === 'c') { if (textSelected) return; e.preventDefault(); copySelection().then((did) => { if (!did) exportImage('clipboard'); }); }
      else if ((e.ctrlKey || e.metaKey) && k === 'x') { if (textSelected) return; e.preventDefault(); cutSelection(); }
      else if ((e.ctrlKey || e.metaKey) && (e.code === 'BracketRight' || e.code === 'BracketLeft')) { e.preventDefault(); orderSel(e.code === 'BracketRight' ? (e.shiftKey ? 'front' : 'forward') : (e.shiftKey ? 'back' : 'backward')); }
      else if ((e.ctrlKey || e.metaKey) && k === 'l') { e.preventDefault(); const sel = rf.getNodes().filter((n) => n.selected); if (sel.length) lockItems(sel.map((n) => n.id), !sel.every((n) => n.data?.locked)); }
      else if ((e.ctrlKey || e.metaKey) && k === 'v') { e.preventDefault(); pasteClip(); }
      else if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const d = e.shiftKey ? 10 : 1;
        const did = nudgeSelection(k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0);
        if (did) e.preventDefault();
      }
      else if (k === 'f2') { e.preventDefault(); renameSelected(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); const ids = rf.getNodes().filter((n) => n.selected).map((n) => n.id); if (ids.length) duplicateItems(ids); }
      else if ((e.ctrlKey || e.metaKey) && k === 'a') { if (textSelected) return; e.preventDefault(); rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: true }))); }
      else if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); saveJson(e.shiftKey); }
      else if ((e.ctrlKey || e.metaKey) && k === 'o') { e.preventDefault(); openJson(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'f') { e.preventDefault(); setFind((f) => ({ open: true, q: f.q, i: 0, n: f.n + 1 })); }
      else if ((e.ctrlKey || e.metaKey) && k === 'g') { e.preventDefault(); if (e.shiftKey) ungroupSel(); else groupSel(); }
      else if ((e.ctrlKey || e.metaKey) && k === 't') { e.preventDefault(); if (e.shiftKey) reopenDoc(); else addDoc(); }
      else if (e.ctrlKey && k === 'tab') {
        e.preventDefault();
        const d = docsRef.current; const i = d.list.findIndex((x) => x.id === d.active);
        const n = d.list[(i + (e.shiftKey ? -1 : 1) + d.list.length) % d.list.length];
        if (n) switchDoc(n.id);
      }
      else if (k === 'escape') { if (rf.getNodes().some((n) => n.selected) || rf.getEdges().some((x) => x.selected)) { rf.setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n))); rf.setEdges((es) => es.map((x) => (x.selected ? { ...x, selected: false } : x))); } else setPanel(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, copyPpt, exportImage, saveJson, openJson, groupSel, ungroupSel, rf, isDesktop, addDoc, switchDoc, duplicateItems, reopenDoc, copySelection, cutSelection, pasteClip, nudgeSelection, renameSelected, orderSel, lockItems]);

  // 선 끝을 다른 노드로 옮기기
  useEffect(() => {
    const on = (ev) => {
      const { id, end, node, point } = ev.detail;
      const g = currentGraph();
      const e = g.edges.find((x) => x.id === id);
      if (!e) return;
      const ptKey = end === 'source' ? 'sp' : 'tp';
      const other = end === 'source' ? e.target : e.source;
      // 빈 곳에 놓으면 그 자리에 끝이 남는다 (다른 끝은 요소에 붙어 있어야 한다)
      if (!node) {
        if (!point) return;
        if (!other) { toastMsg('양쪽 끝을 모두 빈 곳에 둘 수는 없습니다. 한쪽은 요소에 연결하십시오.'); return; }
        e[end] = null; e[ptKey] = point;
        commit(g);
        return;
      }
      if (e[end] === node) return;
      if (node === other) { toastMsg('같은 요소끼리는 연결할 수 없습니다.'); return; }
      const s2 = end === 'source' ? node : e.source, t2 = end === 'target' ? node : e.target;
      if (g.edges.some((x) => x.id !== id && x.source === s2 && x.target === t2)) { toastMsg('이미 같은 연결선이 있습니다.'); return; }
      e[end] = node; delete e[ptKey];
      if (tryCommit(g)) toastMsg(`연결 대상을 "${labelOf(node)}"(으)로 바꿨습니다. Ctrl+Z 로 되돌릴 수 있습니다.`, 3000);
    };
    window.addEventListener('arch-reconnect', on);
    return () => window.removeEventListener('arch-reconnect', on);
  }, [currentGraph, tryCommit, commit, toastMsg, labelOf]);

  // 직각선 꺾이는 위치
  useEffect(() => {
    const on = (ev) => {
      const { id, bend } = ev.detail;
      const g = currentGraph();
      const e = g.edges.find((x) => x.id === id);
      if (!e) return;
      if (Math.abs(bend - 0.5) < 0.001) delete e.bend; else e.bend = bend;
      commit(g);
    };
    window.addEventListener('arch-bend', on);
    return () => window.removeEventListener('arch-bend', on);
  }, [currentGraph, commit]);

  // 핀 툴팁의 [AI에게 물어보기] → 여기로 온다
  useEffect(() => {
    const on = (e) => runAiRef.current('ask', e.detail);
    window.addEventListener('arch-ask', on);
    return () => window.removeEventListener('arch-ask', on);
  }, []);

  // 자동화 훅(테스트/스크립트용): window.__arch.loadTemplate('three-tier-web'), patch([...]), copyAll(), graph()
  useEffect(() => {
    window.__arch = {
      graph: currentGraph,
      loadTemplate: (id) => { const t = BUILTIN_TEMPLATES.find((x) => x.meta?.id === id); if (!t) throw new Error('없는 템플릿: ' + id); const { meta, ...g } = t; commit({ ...g, title: meta.name, context: contextRef.current, theme: themeRef.current }, undefined, { fit: true }); },
      patch: (ops) => { const r = applyPatch(currentGraph(), ops, catalog.check); const ok = tryCommit(r.graph); return { ...r, blocked: !ok }; },
      lint: () => lintRef.current,
      load: (graph) => commit(normalizeGraph(graph), undefined, { fit: true }),
      update: { check: () => checkUpdate(false), apply: applyUpdate, state: () => updRef.current },
      select: (ids) => { const set = new Set(ids); rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: set.has(n.id) }))); rf.setEdges((es) => es.map((x) => ({ ...x, selected: set.has(x.id) }))); },
      ai: { review: () => runAi('review'), draw: (req) => runAi('draw', req), ask: (q) => runAi('ask', q), state: () => ai, settings: () => aiSettings, setSettings: setAiSettings, applyOps: applyAiOps, setContext: updateContext },
      guide: {
        state: () => guide, set: (s) => { setGuide(s); setPanel('guide'); }, start: startGuide,
        steps: (s) => visibleSteps(s || guide), ops: (step, s) => opsFor(step, s || guide),
        loadTemplate: loadTemplateById, apply: applyOpsRaw,
      },
      exportSvg: (selectedOnly = false) => renderSvg(selectedOnly),
      exportPng: async (selectedOnly = false, scale = 2) => { const r = renderSvg(selectedOnly); const b = await svgToPng(r.svg, r.width, r.height, scale); return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); },
      copyAll: () => copyPpt(false),
      copySelected: () => copyPpt(true),
    };
    return () => { delete window.__arch; };
  }, [catalog, commit, tryCommit, currentGraph, copyPpt, renderSvg, runAi, ai, aiSettings, setAiSettings, applyAiOps, updateContext, guide, setGuide, startGuide, loadTemplateById, applyOpsRaw, checkUpdate, applyUpdate]);

  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  const selectedEdges = useMemo(() => edges.filter((e) => e.selected), [edges]);
  const canUndo = hist.current.past.length > 0, canRedo = hist.current.future.length > 0; // histVer 로 갱신
  void histVer;

  return (
    <div className={'app' + (view.depth ? ' depth' : '') + (theme === 'dark' ? ' theme-dark' : '') + (theming ? ' theming' : '') + (docMode === 'card' ? ' mode-card' : '') + (view.pins === false ? ' no-pins' : '') + (view.aiOff ? ' ai-off' : '')} style={{ '--pal-w': layout.pal + 'px', '--side-w': layout.side + 'px', '--label-scale': view.textScale }}>
      <header className="top">
        <div className="brand">Arch Canvas <span className="ver">{APP_VERSION}</span></div>
        <div className="tools">
          {/* 파일 */}
          <button className="tb ic-only" onClick={newDiagram} title="새 다이어그램 탭 (Ctrl+T)" aria-label="새 다이어그램 탭"><Icon name="new" /></button>
          <button className="tb ic-only" onClick={openJson} title="열기 (Ctrl+O)" aria-label="열기"><Icon name="open" /></button>
          <button className="tb ic-only" onClick={() => saveJson(false)} title="저장 (Ctrl+S) · 다른 이름으로 저장 (Ctrl+Shift+S)" onContextMenu={(e) => { e.preventDefault(); saveJson(true); }} aria-label="저장"><Icon name="save" /></button>
          <TemplateMenu builtin={BUILTIN_TEMPLATES} user={userTemplates} onPick={(t) => (t.meta?.piece ? insertPiece(t) : loadTemplate(t))} onSave={saveAsTemplate} onSavePiece={saveSelectionAsPiece} onDelete={removeTemplate} hasSel={selectedNodes.length > 0} />
          <span className="sep" />
          {/* 모드 */}
          <div className="modectl" role="group" aria-label="모드">
            <button className={docMode === 'infra' ? 'on' : ''} onClick={() => setDoc({ mode: 'infra' })} title="인프라: AWS 공식 아이콘 + 규칙 검사" aria-label="인프라 모드"><Icon name="infra" /><span className="lbl" data-p="2">인프라</span></button>
            <button className={docMode === 'card' ? 'on' : ''} onClick={() => setDoc({ mode: 'card' })} title="카드: 솔루션 구성도(제목·설명 카드)" aria-label="카드 모드"><Icon name="card" /><span className="lbl" data-p="2">카드</span></button>
          </div>
          <span className="sep" />
          {/* 실행 취소 */}
          <button className="tb ic-only" onClick={undo} disabled={!canUndo} title="실행 취소 (Ctrl+Z)" aria-label="실행 취소"><Icon name="undo" /></button>
          <button className="tb ic-only" onClick={redo} disabled={!canRedo} title="다시 실행 (Ctrl+Y)" aria-label="다시 실행"><Icon name="redo" /></button>
          <span className="sep" />
          {/* 내보내기: [PNG 복사 | ▾] */}
          <span className="split tour-export">
            <button className="tb primary has-lbl" data-p="1" onClick={() => exportImage('clipboard')} title="PNG 클립보드 복사, 선택이 있으면 선택만 (Ctrl+C). 배율·제목·범례는 [▾ > 내보내기 설정]" aria-label="PNG 복사"><Icon name="copy" /><span className="lbl" data-p="1">PNG 복사</span></button>
            <details className="menu split-more">
              <summary className="tb primary caret" title="내보내기: 설정, PNG/SVG 저장, PPT 도형" aria-label="내보내기 옵션"><Icon name="caret" size={12} /></summary>
              <div className="menu-list right" onClick={(e) => { if (e.target.closest('button')) window.__closeMenus?.(); }}>
              <div className="menu-sec">배경</div>
              <label className="menu-opt"><input type="radio" name="bg" checked={exportBg === 'transparent'} onChange={() => setExportBg('transparent')} /> 투명</label>
              <label className="menu-opt"><input type="radio" name="bg" checked={exportBg === 'white'} onChange={() => setExportBg('white')} /> 흰색</label>
              <div className="menu-sec">{selectedNodes.length || selectedEdges.length ? '선택 영역만' : '전체'}</div>
              <button onClick={() => setExpOpen(true)}>내보내기 설정…<small>배율 {exp.scale}배{exp.title ? ' · 제목' : ''}{exp.legend ? ' · 범례' : ''}{exp.aspect === '16:9' ? ' · 16:9' : ''}</small></button>
              <button onClick={() => exportImage('png')}>PNG 저장<small>{exp.scale}배 해상도</small></button>
              <button onClick={() => exportImage('svg')}>SVG 저장<small>벡터</small></button>
              <button onClick={() => exportImage('clipboard')}>PNG 클립보드 복사<small>Ctrl+C</small></button>
              {isDesktop && (
                <>
                  <div className="menu-sec">PowerPoint 편집 도형 (EXE 전용)</div>
                  <button onClick={() => copyPpt(false)}>전체를 도형으로 복사<small>Ctrl+Shift+C</small></button>
                  <button onClick={() => copyPpt(true)} disabled={!selectedNodes.length && !selectedEdges.length}>선택만 도형으로 복사</button>
                </>
              )}
            </div>
          </details>
          </span>
          <span className="sep" />
          {/* AI: [AI 검수 | ◧] + 규칙 */}
          <AiChip settings={aiSettings} onClick={() => setConnect({ open: true, pending: null })} />
          <span className="split ai-split">
            <button onClick={() => runAi('review')} className="tb toolbar-ai has-lbl" data-p="1" disabled={!!ai.busy} title="AI 검수: 제안서 컨텍스트 기준" aria-label="AI 검수">
              {ai.busy === 'review' ? <Icon name="spinner" className="spin-ic" /> : <Icon name="sparkle" />}<span className="lbl" data-p="1">AI 검수</span>
            </button>
            <button onClick={() => setPanel(panel === 'ai' ? null : 'ai')} className={'tb toolbar-ai ic-half tour-ai' + (panel === 'ai' ? ' on' : '')} title="AI 패널: 제안서 컨텍스트 · 물어보기 · 그리기·고치기" aria-label="AI 패널"><Icon name="panel" /></button>
          </span>
          <button onClick={() => { setPanel(null); const id = addAtCenter({ type: 'text' }); if (id) setTimeout(() => { rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id }))); setTimeout(() => { const inp = document.querySelector('.side .insp textarea'); inp?.focus(); inp?.select(); }, 80); }, 0); }} className="tb ic-only" title="글상자 추가: 화면 가운데에 넣고 바로 글을 씁니다" aria-label="글상자 추가"><Icon name="text" /></button>
          {(view.layersBtn || panel === 'layers') && <button onClick={() => setPanel(panel === 'layers' ? null : 'layers')} className={'tb ic-only' + (panel === 'layers' ? ' on' : '')} title="레이어 목록: 전체 앞뒤 순서와 잠금 (고급)" aria-label="레이어"><Icon name="layers" /></button>}
          <button onClick={() => setPanel(panel === 'rules' ? null : 'rules')} className={'tb ic-only tour-rules' + (panel === 'rules' ? ' on' : '') + (violations.length ? ' warn' : '')} title={`규칙 검사${violations.length ? ` (${violations.length}건)` : ''}`} aria-label="규칙 검사">
            <Icon name="shield" />{violations.length > 0 && <span className={'badge' + (violations.some((v) => v.severity === 'block') ? ' block' : '')}>{violations.length}</span>}
          </button>
          <span className="sep" />
          {/* 도움 */}
          <button onClick={() => (panel === 'guide' ? setPanel(null) : guide ? setPanel('guide') : startGuide())} className={'tb has-lbl tour-guide' + (panel === 'guide' ? ' on' : '')} data-p="2" title="가이드: 단계별로 만들기" aria-label="가이드">
            <Icon name="guide" /><span className="lbl" data-p="2">가이드</span>{guide && guide.phase === 'steps' && <span className="prog">{Math.min(guide.idx + 1, visibleSteps(guide).length)}/{visibleSteps(guide).length}</span>}
          </button>
          <button onClick={() => setPanel(panel === 'help' ? null : 'help')} className={'tb ic-only' + (panel === 'help' || panel === 'patch' ? ' on' : '')} title="도움말" aria-label="도움말"><Icon name="help" /></button>
          {upd.info?.newer && <button className="tb upd-chip has-lbl" onClick={() => setUpd((u) => ({ ...u, open: true }))} title={`새 버전 ${upd.info.version} 이(가) 있습니다. 누르면 바뀐 내용을 보고 바로 업데이트할 수 있습니다.`}><svg className="upd-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg><span className="lbl">업데이트 {upd.info.version}</span></button>}
          <details className="menu settings">
            <summary className="tb ic-only" title="보기 설정: 테마 · 격자 · 텍스트 · 연결선" aria-label="보기 설정"><Icon name="settings" /></summary>
            <div className="menu-list settings-menu right">
              <div className="menu-sec">테마 <small>(파일에 저장, 내보내기에도 적용)</small></div>
              <div className="seg">
                <button className={theme === 'light' ? 'on' : ''} onClick={() => setDoc({ theme: 'light' })}>라이트</button>
                <button className={theme === 'dark' ? 'on' : ''} onClick={() => setDoc({ theme: 'dark' })}>다크</button>
              </div>
              <div className="menu-sec">텍스트 크기 <small>{Math.round(view.textScale * 100)}% · 화면과 내보내기 모두</small></div>
              <label className="menu-opt range"><input type="range" min="70" max="160" step="5" value={Math.round(view.textScale * 100)} onChange={(e) => setView({ textScale: +e.target.value / 100 })} /><button className="small" onClick={() => setView({ textScale: 1 })}>100%</button></label>
              <div className="menu-sec">연결선 기본값 <small>(새로 잇는 선에 적용)</small></div>
              <div className="seg">
                {[['straight', '직선'], ['elbow', '직각'], ['curve', '곡선']].map(([v, n]) => <button key={v} className={view.edgeShape === v ? 'on' : ''} onClick={() => setView({ edgeShape: v })}>{n}</button>)}
              </div>
              <div className="seg">
                {[['end', '화살표 끝'], ['both', '양쪽'], ['none', '없음']].map(([v, n]) => <button key={v} className={view.edgeArrow === v ? 'on' : ''} onClick={() => setView({ edgeArrow: v })}>{n}</button>)}
              </div>
              <label className="menu-opt reshape"><span className="hint">지금 있는 선 모두</span> <button className="small" onClick={() => reshapeAll('elbow')}>직각으로</button> <button className="small" onClick={() => reshapeAll('straight')}>직선으로</button> <button className="small" onClick={() => reshapeAll('curve')}>곡선으로</button></label>
              <div className="menu-sec">격자 <small>(화면용, 내보내기엔 없음)</small></div>
              <div className="seg">
                <button className={view.lines ? 'on' : ''} onClick={() => setView({ lines: !view.lines })}><span className="ic-lines" /> 선</button>
                <button className={view.dots ? 'on' : ''} onClick={() => setView({ dots: !view.dots })}><span className="ic-dots" /> 점</button>
                <button className={view.major ? 'on' : ''} onClick={() => setView({ major: !view.major })} disabled={!view.lines && !view.dots}>5칸 굵은 선</button>
              </div>
              <label className="menu-opt range">진하기 <input type="range" min="0" max="100" value={view.strength} onChange={(e) => setView({ strength: +e.target.value })} disabled={!view.lines && !view.dots} /> <span>{view.strength}</span></label>
              <div className="menu-sec">간격 <small>{view.gap}px</small></div>
              <div className="seg gap-seg">
                {[8, 12, 16, 24, 32, 48].map((g) => <button key={g} className={view.gap === g ? 'on' : ''} onClick={() => setView({ gap: g })} disabled={!view.lines && !view.dots}>{g}</button>)}
              </div>
              <div className="menu-sec">경고·참고 표시 <small>(화면 전용. 내보내기에는 들어가지 않습니다)</small></div>
              <label className="menu-opt"><input type="checkbox" checked={view.pins !== false} onChange={(e) => setView({ pins: e.target.checked })} /> 요소 위에 표시</label>
              <label className="menu-opt"><input type="checkbox" checked={view.guides !== false} onChange={(e) => setView({ guides: e.target.checked })} /> 끌 때 정렬 안내선</label>
              <div className="menu-sec">AI <small>(끄면 AI 버튼과 [AI에게 물어보기]가 모두 숨겨집니다)</small></div>
              <label className="menu-opt"><input type="checkbox" checked={!view.aiOff} onChange={(e) => setView({ aiOff: !e.target.checked })} /> AI 기능 사용</label>
              <div className="menu-sec">입체감</div>
              <label className="menu-opt"><input type="checkbox" checked={view.depth} onChange={(e) => setView({ depth: e.target.checked })} /> 그룹·아이콘 그림자</label>
              <div className="menu-sec">고급</div>
              <label className="menu-opt"><input type="checkbox" checked={!!view.layersBtn} onChange={(e) => setView({ layersBtn: e.target.checked })} /> 툴바에 레이어 목록 버튼</label>
              <button onClick={() => setView(VIEW_DEFAULT)}>보기 설정 기본값으로</button>
            </div>
          </details>
        </div>
      </header>

      <DocTabs docs={docs} onSwitch={switchDoc} onAdd={() => addDoc()} onClose={closeDoc} onRename={renameDoc} onDuplicate={duplicateDoc} onMove={moveDoc} onContext={onTabContext} />

      <Palette onAdd={addAtCenter} onSuggest={addSuggested} suggest={suggestFor(selectedNodes, catalog, docMode)} cardMode={docMode === 'card'} resizer={<Resizer which="pal" onResize={onResize} />} />

      <div className="canvas" ref={wrapRef} onPointerDownCapture={onCanvasPointerDownCapture} onMouseDownCapture={(e) => { if (shiftHandled.current) { e.stopPropagation(); e.preventDefault(); } }} onClickCapture={onCanvasClickCapture}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onBeforeDelete={onBeforeDelete}
          onEdgeClick={onEdgeClick}
          onNodeClick={onNodeClick}
          onNodeContextMenu={onNodeContextMenu}
          onEdgeContextMenu={onEdgeContextMenu}
          onPaneContextMenu={onPaneContextMenu}
          onNodeDoubleClick={onNodeDoubleClick}
          onEdgeDoubleClick={onEdgeDoubleClick}
          onPaneMouseMove={(e) => { lastPointer.current = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }); }}
          onPaneMouseLeave={() => { lastPointer.current = null; }}
          onDrop={onDrop}
          onDragOver={onDragOver}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={36}
          selectionMode={SelectionMode.Partial}
          selectionOnDrag={false}
          selectionKeyCode="Shift"
          multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
          deleteKeyCode={['Delete', 'Backspace']}
          minZoom={0.1}
          maxZoom={3}
          snapToGrid
          snapGrid={[4, 4]}
          elevateNodesOnSelect={false}
          elevateEdgesOnSelect={false}
          onMoveStart={() => hidePinTip()}
          proOptions={{ hideAttribution: true }}
          fitView
        >
          {view.lines && view.strength > 0 && <Background id="grid-lines" variant={BackgroundVariant.Lines} gap={view.gap} lineWidth={1} color={gridColor(0.5 * (view.strength / 100))} />}
          {view.dots && view.strength > 0 && <Background id="grid-dots" variant={BackgroundVariant.Dots} gap={view.gap} size={1 + view.strength / 50} color={gridColor(0.1 + 0.6 * (view.strength / 100))} />}
          {(view.lines || view.dots) && view.major && view.strength > 0 && (
            // 5칸마다 굵은 선: 지도 눈금처럼 거리감이 생긴다
            <Background id="grid-major" variant={BackgroundVariant.Lines} gap={view.gap * 5} lineWidth={1} color={gridColor(0.35 * (view.strength / 100))} />
          )}
          {guideLines.length > 0 && (
            <ViewportPortal>
              <svg className="guide-lines" style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 9000 }} width="1" height="1">
                {guideLines.map((l, i) => <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />)}
              </svg>
            </ViewportPortal>
          )}
          {!view.aiOff && <AskBar onAsk={askAboutSelection} busy={ai.busy} />}
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'awsGroup' ? (catalog.kinds.get(n.data.kind)?.color || '#999') + '33' : '#232F3E')} />
        </ReactFlow>
        {find.open && <FindBar key={find.n} initial={find.q} onClose={(q) => setFind((f) => ({ ...f, open: false, q }))} />}
        {webNote && <div className="web-note" role="status"><span><b>웹 버전</b> · 작업은 이 브라우저에 저장됩니다. 중요한 다이어그램은 [저장]으로 파일을 남기십시오. Claude CLI·PowerPoint 도형 복사는 <a href="./download/" target="_blank" rel="noopener">Windows 버전</a>에서만 됩니다.</span><button className="small" onClick={closeWebNote}>확인</button></div>}
        {dragHint && <div className="drag-hint" role="status">{[
          dragHint.overlay ? '겹치는 상자 · 테두리만 움직입니다' : dragHint.alone ? `상자만 옮기는 중 · 안의 ${dragHint.n}개는 제자리` : dragHint.n ? `안의 ${dragHint.n}개가 함께 움직입니다 · Alt: 상자만` : null,
          dragHint.live ? (dragHint.into ? `→ ${dragHint.into} 안으로` : '→ 어느 상자에도 속하지 않음') : null,
          dragHint.over?.length ? `+ ${dragHint.over.join(', ')} 멤버` : null,
        ].filter(Boolean).join('  ·  ')}</div>}
        {toastV && (typeof toastV === 'string'
          ? <div className={'toast' + (toastOut ? ' out' : '')}>{toastV}</div>
          : (
            <div className={'toast rule ' + toastV.kind + (toastOut ? ' out' : '')}>
              <b>{toastV.title}</b><span>{toastV.explain}</span>
              {toastV.ask && <div className="toast-actions"><button className="small ask" onClick={() => { setToastState(null); runAi('ask', toastV.ask); }}>AI에게 물어보기</button><button className="small" onClick={() => setToastState(null)}>닫기</button></div>}
            </div>
          ))}
      </div>

      <aside className="side">
        <Resizer which="side" onResize={onResize} />
        {panel === 'patch' ? (
          <PatchPanel onApply={(ops) => { const r = applyPatch(currentGraph(), ops, catalog.check); const ok = tryCommit(r.graph); return { ...r, blocked: !ok }; }} />
        ) : panel === 'rules' ? (
          <RulesPanel violations={violations} nodes={nodes} edges={edges} onPick={selectById} onAsk={(v) => runAi('ask', askAboutText(v))} />
        ) : panel === 'guide' && guide && guide.docId && guide.docId !== docs.active && docs.list.some((x) => x.id === guide.docId) ? (
          <div className="insp">
            <h3>가이드</h3>
            <p>가이드는 "{docs.list.find((x) => x.id === guide.docId)?.title}" 탭에서 진행 중입니다.</p>
            <div className="row"><button className="primary" onClick={() => { switchDoc(guide.docId); setTimeout(() => setPanel('guide'), 0); }}>그 탭으로 이동</button><button onClick={startGuide}>이 탭에서 새로 시작</button></div>
          </div>
        ) : panel === 'guide' && guide ? (
          <GuidePanel graphIds={new Set(nodes.map((n) => n.id))}
            state={guide} setState={setGuide} isEmpty={!nodes.length}
            onLoadTemplate={loadTemplateById} onApplyOps={applyOpsRaw}
            violations={violations} onShowRules={() => setPanel('rules')} onPick={selectById}
            onAiReview={() => runAi('review')} aiReady={isVerified(aiSettings)} aiBusy={ai.busy}
            onExport={(w) => exportImage(w, false)} onSetContext={updateContext}
            onClose={() => setPanel(null)}
          />
        ) : panel === 'ai' ? (
          <AiPanel
            context={context} onContext={updateContext}
            settings={aiSettings} verified={isVerified(aiSettings)}
            onOpenConnect={(pending) => setConnect({ open: true, pending })}
            state={ai} onReview={() => runAi('review')} onDraw={(req) => runAi('draw', req)} onAsk={(q) => runAi('ask', q)}
            onApplyOps={applyAiOps} onCancel={() => aiAbort.current?.abort()} onPick={selectById} nameOf={labelOf} activeDocId={docs.active}
          />
        ) : panel === 'layers' ? (
          <LayersPanel graph={currentGraph()} selected={[...selectedNodes.map((n) => n.id)]}
            onSelect={(id, add) => rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id ? (add ? !n.selected : true) : (add ? n.selected : false) })))}
            onMove={layerMove} onOrder={(how) => orderSel(how)} onLock={(id, on) => lockItems([id], on)} onClose={() => setPanel(null)} />
        ) : panel === 'help' ? (
          <Help isDesktop={isDesktop} onPatch={() => setPanel('patch')} onTour={() => { setPanel(null); setTour(true); }} onCheckUpdate={() => checkUpdate(true)} updBusy={upd.busy} updInfo={upd.info} onToast={toastMsg} stats={{ groups: nodes.filter((n) => n.type === 'awsGroup').length, nodes: nodes.filter((n) => n.type !== 'awsGroup').length, edges: edges.length, mode: docMode, theme }} />
        ) : (
          <Inspector allNodes={nodes} nodes={selectedNodes} edges={selectedEdges} onChange={updateItem} onChangeMany={updateMany} onWrap={wrapSelection} onGroup={groupSel} onUngroup={ungroupSel} onAlign={alignSel} onDistribute={distributeSel} onSameSize={sameSizeSel} annotations={annotationsRef.current} violations={violations} onShowRules={() => setPanel('rules')} onStartGuide={startGuide} onAsk={(p) => runAi('ask', askAboutText(p))} stats={{ groups: nodes.filter((n) => n.type === 'awsGroup').length, icons: nodes.filter((n) => n.type === 'awsIcon').length, edges: edges.length }} />
        )}
      </aside>

      <PinTip />
      <ContextMenu menu={ctx} onClose={closeCtx} />
      <UpdateDialog open={upd.open} info={upd.info} busy={upd.busy} onClose={() => setUpd((u) => ({ ...u, open: false }))} onApply={applyUpdate} />
      <ExportDialog open={expOpen} value={exp} onChange={setExp} graph={expOpen ? currentGraph() : null} renderSvg={renderSvg} hasSel={selectedNodes.length + selectedEdges.length > 0}
        onClose={() => setExpOpen(false)} onRun={(w) => { setExpOpen(false); exportImage(w); }} />
      <Tour open={tour} onClose={() => setTour(false)} />
      <ConnectModal
        open={connect.open} pending={connect.pending} settings={aiSettings} onSettings={setAiSettings}
        onClose={() => setConnect({ open: false, pending: null })}
        onReady={(pending) => { setConnect({ open: false, pending: null }); setTimeout(() => runAiRef.current(pending, pendingDraw.current), 0); }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
function Palette({ onAdd, onSuggest, suggest, cardMode, resizer }) {
  const catalog = useCatalog();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(120);
  const [showAll, setShowAll] = useState(false);
  const results = useMemo(() => searchIcons(catalog, q, limit), [catalog, q, limit]);
  const dragStart = (e, payload) => {
    e.dataTransfer.setData('application/arch-canvas', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };
  const searching = q.trim().length > 0;
  return (
    <aside className="palette">
      {resizer}
      <input className="search" placeholder="아이콘 검색: EC2, 로드밸런서, S3…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(120); }} aria-label="아이콘 검색" />
      {!searching && (
        <div className="pal-annot">
          <div className="pal-mini" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAdd({ type: 'text' }); } }} draggable onDragStart={(e) => dragStart(e, { type: 'text' })} onClick={() => onAdd({ type: 'text' })} title="글상자: 제목·설명·메모"><span className="mini-ic">T</span>글상자</div>
          <div className="pal-mini" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAdd({ type: 'badge' }); } }} draggable onDragStart={(e) => dragStart(e, { type: 'badge' })} onClick={() => onAdd({ type: 'badge' })} title="번호 배지: 흐름 순서 ①②③"><span className="mini-ic round">1</span>번호</div>
        </div>
      )}
      {!searching && (
        <>
          <div className="pal-section suggest-head">{suggest.title} <small>{suggest.target ? '클릭하면 바로 들어갑니다' : '클릭하면 가운데에'}</small></div>
          <div className="pal-suggest" key={suggest.title}>
            {suggest.items.map((it) => {
              if (it.type === 'card') {
                return (
                  <div key="card" className="pal-icon is-card" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }} draggable onDragStart={(e) => dragStart(e, { type: 'card' })} onClick={() => onSuggest({ type: 'card' }, suggest.target)} title="글만 있는 카드">
                    <span className="pal-card-box">Aa</span><span>빈 카드</span>
                  </div>
                );
              }
              const ic = it.type === 'icon' ? catalog.icons.get(it.key) : null;
              const k = it.type === 'group' ? catalog.kinds.get(it.kind) : null;
              const gi = k?.icon ? catalog.icons.get(k.icon) : null;
              const payload = it.type === 'icon' ? { type: 'icon', key: it.key } : { type: 'group', kind: it.kind };
              return (
                <div key={it.key || it.kind} className={'pal-icon' + (it.type === 'group' ? ' is-group' : '')} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }} draggable onDragStart={(e) => dragStart(e, payload)} onClick={() => onSuggest(payload, suggest.target)} title={ic ? ic.name + (cardMode ? ' (아이콘 카드)' : '') : k.name + ' (그룹)'}>
                  {ic ? <img src={ic.src} alt="" /> : <span className="pal-group-box big" style={{ borderColor: k.color, borderStyle: k.line === 'none' ? 'solid' : k.line, '--grp-fill-light': k.fill || '#fff', '--grp-fill-dark': k.fill ? `color-mix(in srgb, ${k.color} 14%, #101d20)` : '#101d20', background: 'var(--grp-fill)' }}>{gi && <img src={gi.src} alt="" width={16} height={16} />}</span>}
                  <span>{ic ? ic.name : k.name}</span>
                </div>
              );
            })}
          </div>
          <button className="pal-toggle" onClick={() => setShowAll(!showAll)}>{showAll ? '전체 목록 접기 ▴' : '전체 목록 보기 ▾'}</button>
        </>
      )}
      {(searching || showAll) && <>
      <div className="pal-section">그룹 <small>끌어다 놓거나 클릭</small></div>
      <div className="pal-groups">
        {catalog.groupKinds.map((k) => {
          const ic = k.icon ? catalog.icons.get(k.icon) : null;
          return (
            <div key={k.id} className="pal-group" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }} draggable onDragStart={(e) => dragStart(e, { type: 'group', kind: k.id })} onClick={() => onAdd({ type: 'group', kind: k.id })} title={k.name}>
              <span className="pal-group-box" style={{ borderColor: k.color, borderStyle: k.line === 'none' ? 'solid' : k.line, '--grp-fill-light': k.fill || '#fff', '--grp-fill-dark': k.fill ? `color-mix(in srgb, ${k.color} 14%, #101d20)` : '#101d20', background: 'var(--grp-fill)' }}>
                {ic && <img src={ic.src} alt="" width={16} height={16} />}
              </span>
              <span>{k.name}</span>
            </div>
          );
        })}
      </div>
      <div className="pal-section">아이콘 <small>{results.length}{results.length >= limit ? '+' : ''}</small></div>
      <div className="pal-icons">
        {results.map((ic) => (
          <div key={ic.key} className="pal-icon" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }} draggable onDragStart={(e) => dragStart(e, { type: 'icon', key: ic.key })} onClick={() => onAdd({ type: 'icon', key: ic.key })} title={`${ic.name}\n${ic.category} · ${ic.kind}`}>
            <img src={ic.src} alt="" loading="lazy" />
            <span>{ic.name}</span>
          </div>
        ))}
        {results.length >= limit && <button className="more" onClick={() => setLimit(limit + 200)}>더 보기</button>}
        {!results.length && <div className="empty">검색 결과가 없습니다</div>}
      </div>
      </>}
    </aside>
  );
}

// ---------------------------------------------------------------------------------------------
function TemplateMenu({ builtin, user, onPick, onSave, onSavePiece, onDelete, hasSel }) {
  const ref = useRef(null);
  const sections = useMemo(() => {
    const m = new Map();
    for (const t of [...builtin, ...user]) { const s = t.meta?.section || '기타'; (m.get(s) || m.set(s, []).get(s)).push(t); }
    return [...m.entries()];
  }, [builtin, user]);
  const close = () => { window.__closeMenus?.(); };
  return (
    <details className="menu" ref={ref}>
      <summary className="tb has-lbl" data-p="3" title="템플릿에서 시작" aria-label="템플릿"><Icon name="template" /><span className="lbl" data-p="3">템플릿</span><Icon name="caret" size={12} className="caret-ic" /></summary>
      <div className="menu-list" onClick={close}>
        {sections.map(([s, list]) => (
          <div key={s}>
            <div className="menu-sec">{s}</div>
            {list.map((t) => (
              <div key={t.meta?.id || t.meta?.file} className="tpl-row">
                <button onClick={() => onPick(t)} title={t.meta?.piece ? '지금 다이어그램 가운데에 끼워 넣습니다' : '지금 다이어그램을 이 템플릿으로 바꿉니다'}>
                  {t.meta?.piece ? '⊕ ' : ''}{t.meta?.name || t.title}<small>{t.meta?.description}</small>
                </button>
                {t.meta?.builtin === false && <button className="tpl-x" title="메뉴에서 지우기" aria-label="지우기" onClick={(e) => { e.stopPropagation(); onDelete(t); }}>×</button>}
              </div>
            ))}
          </div>
        ))}
        <div className="menu-sec">—</div>
        <button onClick={onSave}>현재 다이어그램을 템플릿으로 저장…</button>
        <button onClick={onSavePiece} disabled={!hasSel} title={hasSel ? '' : '먼저 캔버스에서 요소를 선택하십시오'}>선택한 요소를 조각으로 저장…<small>나중에 다른 다이어그램에 끼워 넣기</small></button>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------------------------
function Inspector({ nodes, edges, onChange, onChangeMany, onWrap, onGroup, onUngroup, onAlign, onDistribute, onSameSize, annotations, violations, onShowRules, onStartGuide, onAsk, stats, allNodes = [] }) {
  const catalog = useCatalog();
  const parentName = (id) => { const p = allNodes.find((n) => n.id === id); return p?.data?.label || catalog.kinds.get(p?.data?.kind)?.name || '그룹'; };
  const one = nodes.length + edges.length === 1 ? (nodes[0] || edges[0]) : null;
  if (!one) {
    return (
      <div className="insp">
        {nodes.length + edges.length > 1 ? (
          <>
            <h3>{nodes.length}개 노드 · {edges.length}개 연결선 선택</h3>
            {edges.length > 1 && (() => {
              const ids = edges.map((x) => x.id);
              const same = (k) => (edges.every((x) => x.data?.[k] === edges[0].data?.[k]) ? edges[0].data?.[k] : '');
              return (
                <div className="multi-edit">
                  <h4>연결선 {edges.length}개 한꺼번에</h4>
                  <label>모양<select value={same('shape')} onChange={(e) => onChangeMany(ids, { shape: e.target.value })}><option value="" disabled>여러 값</option><option value="straight">직선</option><option value="elbow">직각</option><option value="curve">곡선</option></select></label>
                  <label>선<select value={same('line')} onChange={(e) => onChangeMany(ids, { line: e.target.value })}><option value="" disabled>여러 값</option><option value="solid">실선</option><option value="dashed">점선</option></select></label>
                  <label>화살표<select value={same('arrow')} onChange={(e) => onChangeMany(ids, { arrow: e.target.value })}><option value="" disabled>여러 값</option><option value="end">끝</option><option value="both">양쪽</option><option value="none">없음</option></select></label>
                </div>
              );
            })()}
            {nodes.length >= 2 && (
              <div className="align-tools">
                <h4>정렬</h4>
                <div className="align-row" role="group" aria-label="정렬">
                  {[['left', '왼쪽 맞춤'], ['hcenter', '가로 가운데'], ['right', '오른쪽 맞춤'], ['top', '위 맞춤'], ['vcenter', '세로 가운데'], ['bottom', '아래 맞춤']].map(([k, t]) => (
                    <button key={k} className="al" title={t} aria-label={t} onClick={() => onAlign(k)}><AlignIcon kind={k} /></button>
                  ))}
                </div>
                <div className="align-row" role="group" aria-label="간격과 크기">
                  <button className="al" title="가로 간격 같게 (3개 이상)" aria-label="가로 간격 같게" disabled={nodes.length < 3} onClick={() => onDistribute('h')}><AlignIcon kind="dist-h" /></button>
                  <button className="al" title="세로 간격 같게 (3개 이상)" aria-label="세로 간격 같게" disabled={nodes.length < 3} onClick={() => onDistribute('v')}><AlignIcon kind="dist-v" /></button>
                  <button className="al wide" title="그룹·카드 크기를 가장 큰 것에 맞춤" onClick={() => onSameSize('both')}>크기 맞추기</button>
                </div>
              </div>
            )}
            <div className="row-btns">
              <button onClick={() => onGroup()} disabled={nodes.length < 2} title="파워포인트처럼 묶습니다. 하나를 클릭하면 모두 선택되고 함께 움직입니다.">묶기 (Ctrl+G)</button>
              {nodes.some((n) => n.data?.set) && <button onClick={() => onUngroup()}>묶음 풀기</button>}
              <button onClick={onWrap} disabled={!nodes.length} title="새 상자를 만들어 선택한 것을 그 안에 넣습니다">새 상자로 감싸기</button>
            </div>
            <p className="hint">Shift+클릭으로 더 고르거나 빼기 · 오른쪽 클릭으로 한꺼번에 바꾸기 · Delete 로 지우기</p>
          </>
        ) : (
          <>
            <h3>다이어그램</h3>
            <p>그룹 {stats.groups} · 아이콘 {stats.icons} · 연결선 {stats.edges}</p>
            {stats.groups + stats.icons === 0 && (
              <div className="start-buttons">
                <button className="primary" onClick={onStartGuide}>가이드로 시작 — 순서대로 버튼만 누르면 됩니다</button>
                <p className="hint">빈 캔버스로 하려면 왼쪽 팔레트에서 바로 끌어다 놓거나 상단 [템플릿]을 고르세요.</p>
              </div>
            )}
            {violations.length > 0
              ? <button className="warnbtn" onClick={onShowRules}>규칙 위반 {violations.length}건 보기</button>
              : stats.groups + stats.icons > 0 && <p className="ok">규칙 위반 없음</p>}
            <p className="hint">왼쪽에서 아이콘을 끌어다 놓고, 노드 가장자리 점을 끌어 다른 노드에 놓으면 연결됩니다. 그룹 안에 놓으면 그 그룹에 들어가고, 그룹을 끌면 안의 것이 같이 움직입니다.</p>
            <p className="hint">Shift+드래그: 영역 선택 · Shift+클릭: 여러 개 선택(선도 가능) · 그룹 선택 후 모서리로 크기 조절</p>
          </>
        )}
      </div>
    );
  }
  const pins = annotations.filter((a) => a.target === one.id);
  const isEdge = !!one.source;
  const isGroup = one.type === 'awsGroup';
  const isCard = one.type === 'awsCard';
  const isText = one.type === 'awsText', isBadge = one.type === 'awsBadge';
  const d = one.data || {};
  if (isText || isBadge) {
    return (
      <div className="insp">
        <h3>{isText ? '글상자' : '번호'}</h3>
        {isText
          ? <label>글<textarea className="short" value={d.label || ''} onChange={(e) => onChange(one.id, { label: e.target.value }, 'label:' + one.id)} placeholder="제목, 설명, 메모" /></label>
          : <label>번호 (또는 짧은 글자)<input value={d.label || ''} maxLength={3} onChange={(e) => onChange(one.id, { label: e.target.value }, 'label:' + one.id)} /></label>}
        {isText && (
          <>
            <label>크기<select value={d.size || 'md'} onChange={(e) => onChange(one.id, { size: e.target.value })}><option value="sm">작게</option><option value="md">보통</option><option value="lg">크게</option><option value="xl">제목</option></select></label>
            <label className="row-check"><input type="checkbox" checked={!!d.bold} onChange={(e) => onChange(one.id, { bold: e.target.checked })} /> 굵게</label>
          </>
        )}
        <label>{isText ? '글자색' : '색'}<span className="row"><input type="color" value={d.accent || (isText ? '#232F3E' : '#232F3E')} onChange={(e) => onChange(one.id, { accent: e.target.value.toUpperCase() }, 'accent:' + one.id)} /><button className="small" onClick={() => onChange(one.id, { accent: undefined })}>기본</button></span></label>
        <p className="hint">{isText ? '모서리를 끌어 글상자 크기를 바꿀 수 있습니다. 글이 넘치면 내보낼 때 잘립니다.' : '흐름 순서를 표시합니다. 새로 넣으면 다음 번호가 자동으로 붙습니다.'}</p>
      </div>
    );
  }
  const baseKind = isGroup ? catalog.kinds.get(d.kind) : null;
  return (
    <div className="insp">
      <h3>{isEdge ? '연결선' : isCard ? '카드' : isGroup ? (baseKind?.name || '그룹') : (catalog.icons.get(d.icon)?.name || '아이콘')}</h3>
      <label>{isCard ? '제목' : '라벨'}<input value={d.label || ''} onChange={(e) => onChange(one.id, { label: e.target.value }, 'label:' + one.id)} /></label>
      {isCard && (
        <>
          <label>설명<textarea className="short" value={d.body || ''} onChange={(e) => onChange(one.id, { body: e.target.value }, 'body:' + one.id)} placeholder="한두 줄 설명" /></label>
          <IconPicker value={d.icon} onPick={(key) => onChange(one.id, { icon: key })} />
          <label>강조색<span className="row"><input type="color" value={d.accent || '#2DD4BF'} onChange={(e) => onChange(one.id, { accent: e.target.value.toUpperCase() }, 'accent:' + one.id)} /><button className="small" onClick={() => onChange(one.id, { accent: undefined })}>기본</button></span></label>
        </>
      )}
      {isGroup && (
        <label className="row-check" title="겹치는 상자는 아무것도 품지 않습니다. 끌면 테두리만 움직이고, 안에 보이는 아이콘은 각자의 서브넷에 속한 채 멤버가 됩니다.">
          <input type="checkbox" checked={isOverlay({ kind: d.kind, overlay: d.overlay })} onChange={(e) => onChange(one.id, { overlay: e.target.checked })} />
          겹치는 상자 (ASG·보안 그룹처럼 품지 않고 걸쳐 그림)
        </label>
      )}
      {isGroup && (
        <label>종류
          <select value={d.kind} onChange={(e) => onChange(one.id, { kind: e.target.value })}>
            {catalog.groupKinds.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        </label>
      )}
      {isGroup && (
        <>
          <label>테두리 색<span className="row"><input type="color" value={d.color || baseKind?.color || '#7D8998'} onChange={(e) => onChange(one.id, { color: e.target.value.toUpperCase() }, 'color:' + one.id)} /><button className="small" onClick={() => onChange(one.id, { color: undefined })}>기본</button></span></label>
          <label>선<select value={d.line || baseKind?.line || 'solid'} onChange={(e) => onChange(one.id, { line: e.target.value })}><option value="solid">실선</option><option value="dashed">점선</option><option value="none">없음</option></select></label>
          <label>채움<span className="row"><input type="color" value={('fill' in d ? d.fill : baseKind?.fill) || '#FFFFFF'} onChange={(e) => onChange(one.id, { fill: e.target.value.toUpperCase() }, 'fill:' + one.id)} /><button className="small" onClick={() => onChange(one.id, { fill: null })}>없음</button><button className="small" onClick={() => onChange(one.id, { fill: undefined })}>기본</button></span></label>
        </>
      )}
      {isEdge && (
        <>
          <label>선<select value={d.line} onChange={(e) => onChange(one.id, { line: e.target.value })}>{LINES.map((v) => <option key={v} value={v}>{v === 'solid' ? '실선' : '점선'}</option>)}</select></label>
          <label>모양<select value={d.shape} onChange={(e) => onChange(one.id, { shape: e.target.value })}>{SHAPES.map((v) => <option key={v} value={v}>{{ straight: '직선', elbow: '직각', curve: '곡선' }[v]}</option>)}</select></label>
          <label>화살표<select value={d.arrow} onChange={(e) => onChange(one.id, { arrow: e.target.value })}>{ARROWS.map((v) => <option key={v} value={v}>{{ end: '끝', both: '양쪽', none: '없음' }[v]}</option>)}</select></label>
        </>
      )}
      {one.parentId && <p className="hint">위치: {parentName(one.parentId)} 안</p>}
      {pins.length > 0 && (
        <div className="pins">
          <h4>경고·참고</h4>
          {pins.map((p) => (
            <div key={p.id} className={'pin-row ' + p.level}>
              <b>{p.level === 'error' ? '심각' : p.level === 'warn' ? '경고' : '참고'}</b> {p.message}
              {p.explain && <p className="explain">{p.explain}</p>}
              <button className="small ask" onClick={() => onAsk(p)}>AI에게 물어보기</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 카드의 아이콘 고르기: 검색해서 하나 클릭. '없음'도 가능.
function IconPicker({ value, onPick }) {
  const catalog = useCatalog();
  const [q, setQ] = useState('');
  const cur = value ? catalog.icons.get(value) : null;
  const results = useMemo(() => (q.trim() ? searchIcons(catalog, q, 9) : []), [catalog, q]);
  return (
    <label>아이콘
      <span className="row" style={{ alignItems: 'center' }}>
        {cur ? <img src={cur.src} alt="" width={24} height={24} /> : <span className="hint">없음</span>}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색해서 바꾸기" style={{ flex: 1 }} />
        {cur && <button className="small" onClick={() => onPick(null)}>없음</button>}
      </span>
      {results.length > 0 && (
        <div className="pick-grid">
          {results.map((ic) => <button key={ic.key} className="pick" title={ic.name} onClick={() => { onPick(ic.key); setQ(''); }}><img src={ic.src} alt="" /><small>{ic.name}</small></button>)}
        </div>
      )}
    </label>
  );
}

// ---------------------------------------------------------------------------------------------
function RulesPanel({ violations, nodes, edges, onPick, onAsk }) {
  const catalog = useCatalog();
  const nodeName = (n) => n?.data?.label || (n?.type === 'awsGroup' ? catalog.kinds.get(n.data?.kind)?.name : catalog.icons.get(n?.data?.icon)?.name) || '이름 없음';
  const nameOf = (id) => {
    const n = nodes.find((x) => x.id === id);
    if (n) return nodeName(n);
    const e = edges.find((x) => x.id === id);
    return e ? `연결선 ${e.data?.sp ? '빈 곳' : nodeName(nodes.find((x) => x.id === e.source))} → ${e.data?.tp ? '빈 곳' : nodeName(nodes.find((x) => x.id === e.target))}` : '';
  };
  return (
    <div className="insp">
      <h3>규칙 검사 {violations.length ? `· ${violations.length}건` : ''}</h3>
      {!violations.length && <p className="ok">지금 다이어그램은 규칙에 걸리는 게 없습니다.</p>}
      {violations.map((v, i) => (
        <div key={i} className={'pin-row card ' + (v.severity === 'block' ? 'error' : v.severity)} onClick={() => onPick(v.target)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(v.target); } }} role="button" tabIndex={0}>
          <b>{v.severity === 'block' ? '차단' : v.severity === 'warn' ? '경고' : '참고'}</b> {v.message}
          <div className="hint">{nameOf(v.target)}</div>
          <p className="explain">{v.explain}</p>
          <button className="small ask" onClick={(e) => { e.stopPropagation(); onAsk(v); }}>AI에게 물어보기</button>
        </div>
      ))}
      <p className="hint">규칙 {RULES.length}개로 검사합니다. 차단은 그 동작을 반영하지 않고, 경고는 반영하되 이유를 함께 표시합니다.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
function PatchPanel({ onApply }) {
  const [text, setText] = useState('[\n  { "op": "add_node", "icon": "Arch_Amazon-ElastiCache", "label": "ElastiCache", "parent": "app-a" }\n]');
  const [result, setResult] = useState(null);
  const run = () => {
    try {
      const r = onApply(JSON.parse(text));
      if (r.blocked) { setResult('규칙에 막혀서 반영하지 않았습니다 (화면의 설명 참고)'); return; }
      setResult(r.errors.length ? `${r.applied}개 적용, ${r.errors.length}개 실패:\n` + r.errors.map((e) => `#${e.index} ${e.op}: ${e.message}`).join('\n') : `${r.applied}개 적용`);
    } catch (e) { setResult('JSON 오류: ' + e.message); }
  };
  return (
    <div className="insp">
      <h3>패치 적용</h3>
      <p className="hint">AI 가 만드는 변경 명령과 같은 형식입니다. 고급 사용자용입니다. op: {PATCH_OPS.join(', ')}</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <button className="primary" onClick={run}>적용</button>
      {result && <pre className="result">{result}</pre>}
    </div>
  );
}

function Help({ isDesktop, onPatch, onTour, onCheckUpdate, updBusy, updInfo, onToast, stats }) {
  return (
    <div className="insp help">
      <Feedback isDesktop={isDesktop} onToast={onToast} stats={stats} />
      <h3>쓰는 법</h3>
      <button className="primary" onClick={onTour}>둘러보기 다시 보기 (30초)</button>
      {isDesktop && <div className="row"><button onClick={onCheckUpdate} disabled={updBusy}>{updBusy ? '확인하는 중…' : '업데이트 확인'}</button><span className="hint">현재 {APP_VERSION}{updInfo?.newer ? ` · 새 버전 ${updInfo.version}` : ''}</span></div>}
      <p><b>처음이면</b> 빈 캔버스의 [가이드로 시작]. 순서대로 버튼만 누르면 됩니다.</p>
      <p><b>팔레트 추천</b> 그룹을 고르면 그 안에 넣을 만한 것, 아이콘을 고르면 옆에 붙여 연결할 것이 팔레트 위에 뜹니다. 클릭하면 바로 들어갑니다.</p>
      <p><b>추가</b> 왼쪽 팔레트에서 끌어다 놓기(또는 클릭하면 화면 가운데에).</p>
      <p><b>연결</b> 노드 가장자리의 작은 점을 끌어 다른 노드 위에 놓기.</p>
      <p><b>그룹</b> 그룹 안에 놓으면 들어가고, 밖으로 끌면 나옵니다. 그룹을 선택하면 모서리로 크기 조절. 여러 개 고르고 Ctrl+G 로 묶기.</p>
      <p><b>복사·붙여넣기</b> 요소를 선택하고 Ctrl+C, 마우스를 둔 자리에 Ctrl+V. 다른 탭에도 붙일 수 있습니다. Ctrl+X 잘라내기, Ctrl+D 복제(그룹은 안의 것까지). 선택이 없을 때 Ctrl+C 는 그림(PNG) 복사입니다.</p>
      <p><b>지우기</b> Delete. <b>이름</b> 더블클릭 또는 F2. <b>옮기기</b> 화살표 키(Shift: 10px). <b>되돌리기</b> Ctrl+Z / Ctrl+Y. <b>선택 해제</b> Esc.</p>
      <p><b>상자와 레이어</b> 소속은 화면 위치 그대로입니다: 상자 안에 놓은 것은 그 상자를 따라 움직이고, 끄는 동안 들어갈 상자가 빛납니다. 상자만 옮기려면 Alt 를 누른 채 끄십시오. ASG·보안 그룹 같은 겹치는 상자는 아무것도 품지 않고 테두리만 움직입니다. 앞뒤 순서는 오른쪽 클릭 [맨 앞으로 가져오기 · 뒤로 보내기] 또는 Ctrl+[ / Ctrl+] 로 바꾸고, Ctrl+G 로 여러 개를 묶으면 하나를 클릭해도 함께 선택되고 함께 움직입니다(풀기 Ctrl+Shift+G). 잠근 것(Ctrl+L)은 어떤 방법으로도 움직이지 않고 자물쇠가 보입니다. 선을 선택하면 양 끝 손잡이로 연결 대상을 바꾸거나 빈 곳에 끝을 둘 수 있고, 직각선은 가운데 구간에 손잡이가 생겨 꺾이는 위치를 옮길 수 있고(두 번 클릭하면 가운데로), PowerPoint 로 보낼 때도 같은 위치로 갑니다. 상자는 안에 든 것보다 작게 줄어들지 않습니다. 전체 순서를 한눈에 보려면 오른쪽 클릭 [레이어 목록 보기]를 누르십시오(보기 설정 › 고급에서 툴바 버튼으로 둘 수 있습니다).</p>
      <p><b>조각 템플릿</b> 자주 쓰는 묶음(예: 2-AZ 웹 계층)을 선택해 오른쪽 클릭 [조각 템플릿으로 저장]. 템플릿 메뉴 [내 조각]에서 고르면 지금 그림에 끼워 넣습니다.</p>
      <p><b>정렬</b> 여러 개를 선택하면 오른쪽 패널과 오른쪽 클릭 메뉴에 정렬·간격·크기 맞추기가 나옵니다. 끌 때는 분홍 안내선에 맞춰 붙습니다.</p>
      <p><b>글상자·번호</b> 팔레트 위쪽 [글상자] [번호]. 번호는 다음 수가 자동으로 붙습니다.</p>
      <p><b>찾기</b> Ctrl+F. <b>파일</b> Ctrl+S 저장(같은 파일에 덮어쓰기) · Ctrl+Shift+S 다른 이름으로 · Ctrl+O 열기. <b>탭</b> Ctrl+T 새 탭 · Ctrl+Shift+T 닫은 탭 다시 열기.</p>
      <p><b>내보내기</b> Ctrl+C 또는 [PNG 복사]로 클립보드에 복사한 뒤 PowerPoint 에서 Ctrl+V. 선택이 있으면 선택 영역만 내보냅니다. [내보내기 ▾ &gt; 내보내기 설정]에서 배율·배경·여백·16:9·제목·범례를 미리 보며 정합니다.</p>
      <p><b>규칙 검사</b> 아키텍처 규칙에 어긋나면 차단(빨강)하거나 경고(주황)하면서 이유를 알려 드립니다. 상단 [규칙 검사](방패) 버튼에서 전체 목록을 보고, 누르면 해당 요소가 선택됩니다.</p>
      <p><b>AI</b> [AI 검수]를 누르면 제안서 컨텍스트(제목·요건서)와 다이어그램을 함께 보내 요건 대비 빈틈을 표시로 받습니다. [AI] 패널의 "그리기·고치기"에 원하는 구성을 문장으로 적으면 바뀔 내용을 미리 보여 주고, [적용]으로 반영합니다. 상단 칩에서 연결 방식(Claude CLI / API 키)을 고르고 바꿀 수 있습니다.</p>
      {isDesktop && <p><b>PowerPoint 편집 도형</b> (EXE 전용) Ctrl+Shift+C: 아이콘은 1.5cm SVG 그림, 그룹은 사각형, 연결선은 도형에 붙은 연결선으로 들어갑니다.</p>}
      <p><b>파일</b> 다이어그램은 JSON 그래프(groups / nodes / edges / annotations)로 저장됩니다. 템플릿도 같은 형식이라 '템플릿으로 저장'하면 메뉴에 들어옵니다.</p>
      <p className="hint">아이콘: AWS Architecture Icons (Icon Shelf 데이터 재사용). AWS가 후원하거나 승인한 도구가 아닙니다.</p>
      <button className="small" onClick={onPatch}>고급: 패치 명령 직접 넣기</button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
function safeName(s) { return (s || 'diagram').replace(/[\\/:*?"<>|]/g, '_').trim() || 'diagram'; }
function downloadText(text, file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = file;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// 정렬 버튼 아이콘 (16x16)
function AlignIcon({ kind }) {
  const P = {
    left: <><path d="M2.5 2v12" /><rect x="4.5" y="4" width="8" height="3" rx=".5" /><rect x="4.5" y="9" width="5" height="3" rx=".5" /></>,
    hcenter: <><path d="M8 2v12" /><rect x="3.5" y="4" width="9" height="3" rx=".5" /><rect x="5" y="9" width="6" height="3" rx=".5" /></>,
    right: <><path d="M13.5 2v12" /><rect x="3.5" y="4" width="8" height="3" rx=".5" /><rect x="6.5" y="9" width="5" height="3" rx=".5" /></>,
    top: <><path d="M2 2.5h12" /><rect x="4" y="4.5" width="3" height="8" rx=".5" /><rect x="9" y="4.5" width="3" height="5" rx=".5" /></>,
    vcenter: <><path d="M2 8h12" /><rect x="4" y="3.5" width="3" height="9" rx=".5" /><rect x="9" y="5" width="3" height="6" rx=".5" /></>,
    bottom: <><path d="M2 13.5h12" /><rect x="4" y="3.5" width="3" height="8" rx=".5" /><rect x="9" y="6.5" width="3" height="5" rx=".5" /></>,
    'dist-h': <><path d="M2 2v12M14 2v12" /><rect x="6.5" y="4" width="3" height="8" rx=".5" /></>,
    'dist-v': <><path d="M2 2h12M2 14h12" /><rect x="4" y="6.5" width="8" height="3" rx=".5" /></>,
  };
  return <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[kind]}</svg>;
}

// 캔버스 안 찾기 (Ctrl+F): 라벨·아이콘 이름·그룹 종류로 찾아서 하나씩 가운데로 보여준다
function FindBar({ initial = '', onClose }) {
  const rf = useReactFlow();
  const catalog = useCatalog();
  const [q, setQ] = useState(initial);
  const [i, setI] = useState(0);
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return rf.getNodes().filter((n) => {
      const d = n.data || {};
      const hay = [d.label, d.body, catalog.icons.get(d.icon)?.name, catalog.icons.get(d.icon)?.ko, catalog.kinds.get(d.kind)?.name].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(t);
    }).map((n) => n.id);
  }, [q, rf, catalog]);
  const show = useCallback((k) => {
    if (!hits.length) return;
    const idx = ((k % hits.length) + hits.length) % hits.length;
    setI(idx);
    const id = hits[idx];
    rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
    rf.setEdges((es) => es.map((x) => (x.selected ? { ...x, selected: false } : x)));
    const inn = rf.getInternalNode(id);
    if (inn) { const w = inn.measured?.width ?? 48, h = inn.measured?.height ?? 48; rf.setCenter(inn.internals.positionAbsolute.x + w / 2, inn.internals.positionAbsolute.y + h / 2, { zoom: Math.max(rf.getZoom(), 1), duration: 300 }); }
  }, [hits, rf]);
  useEffect(() => { if (hits.length) show(0); }, [hits]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="findbar" role="search">
      <input autoFocus value={q} placeholder="캔버스에서 찾기: 라벨, 서비스 이름" aria-label="캔버스에서 찾기"
        onChange={(e) => { setQ(e.target.value); setI(0); }}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') show(e.shiftKey ? i - 1 : i + 1); if (e.key === 'Escape') onClose(q); }} />
      <span className="find-count">{q.trim() ? (hits.length ? `${i + 1} / ${hits.length}` : '없음') : ''}</span>
      <button className="small" onClick={() => show(i - 1)} disabled={hits.length < 2} aria-label="이전">▲</button>
      <button className="small" onClick={() => show(i + 1)} disabled={hits.length < 2} aria-label="다음">▼</button>
      <button className="small" onClick={() => onClose(q)} aria-label="닫기">×</button>
    </div>
  );
}

// 내보내기 설정 대화상자: 오른쪽에 미리보기
function ExportDialog({ open, value, onChange, graph, renderSvg, hasSel, onClose, onRun }) {
  const ex = useExit2(open || null, 180);
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { const r = renderSvg(true); setPreview(r?.svg ? { url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(r.svg), w: r.width, h: r.height } : null); }, 60);
    return () => clearTimeout(t);
  }, [open, value, renderSvg]);
  useEffect(() => {
    if (!open) return;
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [open, onClose]);
  if (!open && !ex.v) return null;
  const v = value;
  const used = graph ? usedLineStyles(graph) : { solid: true, dashed: true };
  const seg = (key, opts) => (
    <div className="seg">{opts.map(([val, name]) => <button key={String(val)} className={v[key] === val ? 'on' : ''} onClick={() => onChange({ [key]: val })}>{name}</button>)}</div>
  );
  return (
    <div className={'modal-back' + (!open ? ' closing' : '')} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal export-dlg" role="dialog" aria-modal="true" aria-labelledby="ex-title">
        <div className="modal-head"><h3 id="ex-title">내보내기 설정</h3><button className="x" onClick={onClose} aria-label="닫기">×</button></div>
        <div className="ex-body">
          <div className="ex-form">
            <div className="menu-sec">배율 (PNG)</div>
            {seg('scale', [[1, '1배'], [2, '2배'], [3, '3배'], [4, '4배']])}
            <div className="menu-sec">배경 {graph?.theme === 'dark' && <small>(다크 테마는 항상 어두운 배경)</small>}</div>
            {seg('background', [['transparent', '투명'], ['white', '흰색']])}
            <div className="menu-sec">여백</div>
            {seg('padding', [[8, '좁게'], [24, '보통'], [48, '넓게'], [80, '아주 넓게']])}
            <div className="menu-sec">비율</div>
            {seg('aspect', [['fit', '그림에 맞춤'], ['16:9', '16:9 슬라이드']])}
            <div className="menu-sec">제목</div>
            <label className="menu-opt"><input type="checkbox" checked={v.title} onChange={(e) => onChange({ title: e.target.checked })} /> 위에 제목 넣기</label>
            {v.title && <input className="ex-input" value={v.titleText} placeholder={graph?.title || '다이어그램 제목'} onChange={(e) => onChange({ titleText: e.target.value })} />}
            <div className="menu-sec">범례 <small>(쓰인 선 종류만)</small></div>
            <label className="menu-opt"><input type="checkbox" checked={v.legend} onChange={(e) => onChange({ legend: e.target.checked })} /> 아래에 범례 넣기</label>
            {v.legend && (
              <>
                {used.solid && <label className="ex-row"><span className="ex-line" /> <input className="ex-input" value={v.legendSolid} onChange={(e) => onChange({ legendSolid: e.target.value })} /></label>}
                {used.dashed && <label className="ex-row"><span className="ex-line dashed" /> <input className="ex-input" value={v.legendDashed} onChange={(e) => onChange({ legendDashed: e.target.value })} /></label>}
                {!used.solid && !used.dashed && <p className="hint">연결선이 없어 범례가 비어 있습니다.</p>}
              </>
            )}
            <p className="hint">{hasSel ? '선택한 부분만 내보냅니다.' : '전체를 내보냅니다.'} PNG 복사(Ctrl+C)도 이 설정을 씁니다. PowerPoint 도형 복사에는 제목·범례가 들어가지 않습니다.</p>
          </div>
          <div className="ex-preview">{preview ? <img src={preview.url} alt="미리보기" /> : <span className="hint">내보낼 것이 없습니다</span>}{preview && <small className="hint">{preview.w * v.scale}×{preview.h * v.scale}px</small>}</div>
        </div>
        <div className="modal-actions">
          <button onClick={() => onRun('svg')}>SVG 저장</button>
          <button onClick={() => onRun('png')}>PNG 저장</button>
          <button className="primary" onClick={() => onRun('clipboard')} autoFocus>PNG 복사</button>
        </div>
      </div>
    </div>
  );
}

// 새 버전 안내: 변경 내용과 [지금 업데이트]
function UpdateDialog({ open, info, busy, onClose, onApply }) {
  const ex = useExit2(open || null, 180);
  useEffect(() => {
    if (!open) return;
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [open, onClose]);
  if (!open && !ex.v) return null;
  const notes = String(info?.notes || '').trim();
  const mb = info?.asset?.size ? (info.asset.size / 1048576).toFixed(1) + 'MB' : '';
  return (
    <div className={'modal-back' + (!open ? ' closing' : '')} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal update-dlg" role="dialog" aria-modal="true" aria-labelledby="up-title">
        <div className="modal-head"><h3 id="up-title">새 버전 {info?.version}</h3><button className="x" onClick={onClose} aria-label="닫기" disabled={busy}>×</button></div>
        <p className="modal-note">현재 {info?.current || APP_VERSION} → {info?.version}{mb ? ` · 내려받기 ${mb}` : ''}. 업데이트하면 프로그램이 잠시 닫혔다가 새 버전으로 다시 시작됩니다. 작업 내용은 자동 저장돼 있습니다.</p>
        <div className="upd-notes">{notes ? notes.split('\n').map((ln, i) => <p key={i}>{ln.replace(/^[-*]\s*/, '• ')}</p>) : <p className="hint">변경 내용 설명이 없습니다.</p>}</div>
        <div className="modal-actions">
          {info?.html && <a className="link-btn" href={info.html} target="_blank" rel="noreferrer">릴리스 페이지 ↗</a>}
          <span className="grow" />
          <button onClick={onClose} disabled={busy}>나중에</button>
          <button className={'primary' + (busy ? ' waiting' : '')} onClick={onApply} disabled={busy} autoFocus>{busy ? <Busy label="내려받는 중" /> : '지금 업데이트'}</button>
        </div>
      </div>
    </div>
  );
}

// 의견 보내기: [보내기]를 누르면 계정 없이 바로 만든 사람 메일로 간다(Web3Forms). 키가 없거나 실패하면 깃허브 이슈 / 내용 복사.
const FEEDBACK_REPO = 'svalu/arch-canvas';
const FEEDBACK_KEY = '8006959b-6cdc-4fbe-aaf8-365afd626302';   // Web3Forms access key (공개용 키: 받는 메일 주소는 Web3Forms 쪽에만 있고 코드에는 없다)
function Feedback({ isDesktop, onToast, stats }) {
  const [kind, setKind] = useState('개선');
  const [text, setText] = useState('');
  const [name, setName] = useState(() => { try { return localStorage.getItem('arch-canvas:fb-name') || ''; } catch { return ''; } });
  const [withInfo, setWithInfo] = useState(true);
  const body = () => {
    const env = `- 버전: ${APP_VERSION} (${isDesktop ? 'EXE' : '브라우저'})\n- 환경: ${navigator.userAgent.replace(/\s*\(KHTML.*$/, '')}\n- 화면: 그룹 ${stats.groups} · 요소 ${stats.nodes} · 연결선 ${stats.edges} · ${stats.mode === 'card' ? '카드' : '인프라'} 모드 · ${stats.theme === 'dark' ? '다크' : '라이트'}`;
    return `${text.trim()}\n\n${name.trim() ? `보낸 사람: ${name.trim()}\n` : ''}${withInfo ? `\n---\n${env}\n` : ''}`;
  };
  const title = () => `[${kind}] ${text.trim().split('\n')[0].slice(0, 60)}`;
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const sendMail = async () => {
    if (!text.trim()) { onToast('내용을 적어 주십시오.'); return; }
    try { localStorage.setItem('arch-canvas:fb-name', name.trim()); } catch { /* */ }
    setSending(true);
    try {
      const r = await fetch('https://api.web3forms.com/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ access_key: FEEDBACK_KEY, subject: `[Arch Canvas 피드백] ${title()}`, from_name: name.trim() || 'Arch Canvas 사용자', kind, version: APP_VERSION, message: body(), botcheck: false }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.success === false) throw new Error(j.message || 'HTTP ' + r.status);
      setText(''); setSent(true);
      onToast('전달했습니다. 고맙습니다.', 3500);
    } catch (err) {
      onToast(`보내지 못했습니다 (${String(err.message || err).slice(0, 60)}). 인터넷 연결을 확인하거나 [내용 복사] 후 메신저로 보내 주십시오.`, 7000);
    } finally { setSending(false); }
  };
  const send = () => {
    if (!text.trim()) { onToast('내용을 적어 주십시오.'); return; }
    try { localStorage.setItem('arch-canvas:fb-name', name.trim()); } catch { /* */ }
    const url = `https://github.com/${FEEDBACK_REPO}/issues/new?` + new URLSearchParams({ title: title(), body: body(), labels: 'feedback' }).toString();
    window.open(url.slice(0, 7800), '_blank');
    onToast('브라우저에서 깃허브 이슈 화면이 열렸습니다. [Create] 를 누르면 전달됩니다.', 5000);
  };
  const copy = async () => {
    if (!text.trim()) { onToast('내용을 적어 주십시오.'); return; }
    try { await navigator.clipboard.writeText(`${title()}\n\n${body()}`); onToast('복사했습니다. 메신저나 메일에 붙여 넣어 보내 주십시오.', 3500); } catch { onToast('복사하지 못했습니다.'); }
  };
  return (
    <div className="feedback">
      <h3>의견 보내기</h3>
      <div className="seg fb-kind">{['버그', '개선', '질문'].map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k}</button>)}</div>
      <textarea className="short" value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === '버그' ? '무엇을 했을 때 어떻게 됐는지 적어 주십시오. 예) 상자를 끌었더니 안의 아이콘이 같이 움직였다' : kind === '질문' ? '궁금한 점을 적어 주십시오' : '이렇게 되면 좋겠다는 점을 적어 주십시오'} />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름 (선택)" />
      <label className="row-check"><input type="checkbox" checked={withInfo} onChange={(e) => setWithInfo(e.target.checked)} /> 버전·환경 정보 함께 보내기 (다이어그램 내용은 보내지 않습니다)</label>
      {FEEDBACK_KEY ? (
        <>
          <div className="row"><button className="primary" onClick={sendMail} disabled={sending || !text.trim()}>{sending ? '보내는 중…' : '보내기'}</button><button onClick={copy}>내용 복사</button></div>
          <p className="hint">{sent ? '전달됐습니다. 더 있으면 이어서 적어 주십시오.' : '계정 없이 바로 만든 사람에게 전달됩니다.'} 깃허브 계정이 있으면 <a href="#" onClick={(e) => { e.preventDefault(); send(); }}>깃허브 이슈로 남길 수도</a> 있습니다.</p>
        </>
      ) : (
        <>
          <div className="row"><button className="primary" onClick={send}>깃허브로 보내기</button><button onClick={copy}>내용 복사</button></div>
          <p className="hint">깃허브 계정이 있으면 [깃허브로 보내기], 없으면 [내용 복사] 후 메신저로 보내 주십시오.</p>
        </>
      )}
    </div>
  );
}
