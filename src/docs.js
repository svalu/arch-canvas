// 여러 다이어그램(문서 탭) 저장소. 목록·활성 탭은 localStorage, 문서마다 키 하나.
//   arch-canvas:docs          [{ id, title }]   탭 순서
//   arch-canvas:active        활성 문서 id
//   arch-canvas:doc:<id>      그래프 JSON
// 예전 단일 문서(arch-canvas:current)는 처음 한 번 첫 탭으로 옮긴다.
const K_LIST = 'arch-canvas:docs', K_ACTIVE = 'arch-canvas:active', K_DOC = (id) => 'arch-canvas:doc:' + id, K_OLD = 'arch-canvas:current';

const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
// 실패(용량 초과 등)는 false 를 돌려주고, 화면에 알릴 수 있게 이벤트를 쏜다
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { window.dispatchEvent(new CustomEvent('arch-save-failed', { detail: String(e?.message || e) })); return false; } };

export const newDocId = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

export function loadDocs() {
  let list = read(K_LIST, null);
  if (Array.isArray(list)) list = list.filter((d) => d && typeof d.id === 'string').map((d) => ({ id: d.id, title: String(d.title ?? '다이어그램'), ...(typeof d.file === 'string' ? { file: d.file, fileName: String(d.fileName || '') } : {}) }));
  if (!Array.isArray(list) || !list.length) {
    const id = newDocId();
    const old = read(K_OLD, null);
    list = [{ id, title: old?.title || '새 다이어그램' }];
    if (old) write(K_DOC(id), old);
    write(K_LIST, list);
    write(K_ACTIVE, id);
  }
  let active = read(K_ACTIVE, list[0].id);
  if (!list.some((d) => d.id === active)) active = list[0].id;
  return { list, active };
}
export const saveList = (list) => write(K_LIST, list);
export const saveActive = (id) => write(K_ACTIVE, id);
export const loadDoc = (id) => { const g = read(K_DOC(id), null); return g && typeof g === 'object' ? g : null; };
export const readList = () => { const l = read(K_LIST, []); return Array.isArray(l) ? l.filter((d) => d && typeof d.id === 'string') : []; };
export const docExists = (id) => { try { return localStorage.getItem(K_DOC(id)) != null; } catch { return false; } };
export const LIST_KEY = K_LIST;
export const saveDoc = (id, graph) => write(K_DOC(id), graph);
export const removeDoc = (id) => { try { localStorage.removeItem(K_DOC(id)); } catch { /* */ } };

// 닫은 탭은 바로 지우지 않고 최근 10개까지 보관한다 (Ctrl+Shift+T 로 다시 열기)
const K_TRASH = 'arch-canvas:closed';
export function trashDoc(id, title, graph) {
  const list = read(K_TRASH, []).filter((x) => x && x.id !== id);
  if (graph && (graph.nodes?.length || graph.groups?.length)) list.unshift({ id, title, at: Date.now() });
  while (list.length > 10) { const old = list.pop(); try { localStorage.removeItem(K_DOC(old.id)); } catch { /* */ } }
  write(K_TRASH, list);
  if (!list.some((x) => x.id === id)) removeDoc(id);
}
export const closedDocs = () => read(K_TRASH, []).filter((x) => x && typeof x.id === 'string');
export function untrashDoc(id) { write(K_TRASH, closedDocs().filter((x) => x.id !== id)); }
