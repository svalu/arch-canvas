// 아이콘/그룹 종류 카탈로그. 빌드본은 <script id="icons"> 에서, 개발 서버는 data/icons.json 을 읽는다.
import { createContext, useContext } from 'react';

export const CatalogContext = createContext(null);
export const useCatalog = () => useContext(CatalogContext);

export async function loadCatalog() {
  let data;
  const el = document.getElementById('icons');
  if (el) data = JSON.parse(el.textContent);
  else data = await (await fetch('data/icons.json')).json();
  const icons = new Map(data.icons.map((i) => [i.key, i]));
  // 섹션: 카드 모드용 자유 색 박스 (색/선/채움은 그룹마다 덮어쓸 수 있음)
  const SECTION = { id: 'section', name: '섹션', icon: null, color: '#2DD4BF', line: 'solid', fill: null, text: '#2DD4BF', colorSource: 'theme' };
  data.groupKinds = [...data.groupKinds, SECTION];
  const kinds = new Map(data.groupKinds.map((k) => [k.id, k]));
  // 검색용 소문자 문자열
  const index = data.icons.map((i) => ({ key: i.key, text: `${i.name} ${i.key} ${i.category} ${i.ko || ''}`.toLowerCase() }));
  return {
    icons, kinds, list: data.icons, groupKinds: data.groupKinds, index,
    check: { iconKeys: new Set(icons.keys()), groupKinds: new Set(kinds.keys()) },
    generatedAt: data.generatedAt, source: data.source,
  };
}

/** 검색. 공백으로 나눈 말이 모두 들어 있는 아이콘. 빈 검색어면 서비스 아이콘부터. */
export function searchIcons(catalog, q, limit = 120) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const it of catalog.index) {
    if (words.every((w) => it.text.includes(w))) {
      out.push(catalog.icons.get(it.key));
      if (out.length >= limit) break;
    }
  }
  return out;
}

// 템플릿: 내장(templates/*.json 번들) + 사용자(EXE 옆 data\app\user-templates, 브라우저는 localStorage)
const builtin = import.meta.glob('../templates/*.json', { eager: true, import: 'default' });
export const BUILTIN_TEMPLATES = Object.entries(builtin)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([file, g]) => ({ ...g, meta: { ...g.meta, file: file.split('/').pop(), builtin: true } }));

const LS_KEY = 'arch-canvas:user-templates';

export async function deleteUserTemplate(t) {
  if (window.desktop?.call) { await window.desktop.call('template.delete', { file: t.meta?.file || '' }); return; }
  const list = (await loadUserTemplates()).filter((x) => x.meta?.id !== t.meta?.id);
  localStorage.setItem(LS_KEY, JSON.stringify(list));
}
export async function loadUserTemplates() {
  if (window.desktop) {
    try {
      const r = await fetch('user-templates/index.json', { cache: 'no-store' });
      if (!r.ok) return [];
      const idx = await r.json();
      const out = [];
      for (const f of idx.files || []) {
        try { const g = await (await fetch('user-templates/' + f, { cache: 'no-store' })).json(); out.push({ ...g, meta: { ...(g.meta || {}), file: f, builtin: false } }); } catch { /* 깨진 파일은 건너뜀 */ }
      }
      return out;
    } catch { return []; }
  }
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}

export async function saveUserTemplate(graph, name, { piece = false } = {}) {
  // piece: 선택 영역만 떼어 낸 조각. 불러오면 바꿔치기가 아니라 지금 다이어그램에 끼워 넣는다
  const meta = { id: (piece ? 'piece-' : 'user-') + Date.now(), section: piece ? '내 조각' : '내 템플릿', name, description: `${graph.groups.length} 그룹 · ${graph.nodes.length} 노드${piece ? ' · 끼워 넣기' : ''}`, builtin: false, piece };
  const g = { ...graph, title: name, meta };
  if (window.desktop) {
    await window.desktop.saveTemplate(meta.id + '.json', JSON.stringify(g, null, 2));
    return g;
  }
  const list = await loadUserTemplates();
  list.push(g);
  localStorage.setItem(LS_KEY, JSON.stringify(list));
  return g;
}
