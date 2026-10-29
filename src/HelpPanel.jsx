// 도움말: 긴 글 대신 [묶음 목록 → 눌러서 들어가는 한 장]. 위에는 검색, 지금 상황에 맞는 항목, 단축키 모음.
// 상세는 오른쪽에서 밀려 들어오고 [‹ 목록]으로 돌아간다. [화면에서 보기]는 그 기능이 있는 자리를 잠깐 짚어 준다.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';

const GROUPS = [
  { id: 'start', icon: 'sparkle', title: '시작하기', sub: '첫 화면 · 패널 · 탭과 파일' },
  { id: 'draw', icon: 'draw', title: '그리기', sub: '추가 · 연결 · 상자 · 고치기' },
  { id: 'arrange', icon: 'grid', title: '정리하기', sub: '정렬 · 순서와 묶기 · 조각 · 찾기' },
  { id: 'ai', icon: 'shield', title: '검사와 AI', sub: '경고 · 말로 그리기 · 물어보기 · 연결' },
  { id: 'export', icon: 'download', title: '내보내기', sub: '압축 버전 · PNG 복사 · PowerPoint 도형' },
  { id: 'more', icon: 'settings', title: '설정과 도움', sub: '보기 설정 · 업데이트 · 피드백' },
];

// lines: 한 장에 3~4줄. keys: 아래 칩으로. spot: [화면에서 보기]로 짚을 자리(CSS 선택자, 앞에서부터 보이는 것).
const TOPICS = [
  { id: 'first', group: 'start', title: '처음 시작하기', lines: [
    '빈 캔버스의 "무엇을 그려 볼까요?" 칸에 만들고 싶은 걸 적고 Enter 를 누르세요. AWS 를 몰라도 됩니다.',
    'AI 가 부족한 것만 쉬운 질문 몇 개로 묻고, 그릴 내용을 먼저 보여 준 뒤 그립니다.',
    '버튼만 눌러 가며 만들려면 [따라 하기], 정리된 시스템 문서가 있으면 [시스템 문서로], 혼자 그리려면 [직접 그리기].',
  ], spot: ['.cstart-card', '.tour-guide'] },
  { id: 'panels', group: 'start', title: '패널 떼어 내기', lines: [
    '팔레트·오른쪽 패널의 맨 위 막대를 끌면 떨어져 나와 떠 있습니다.',
    '떠 있는 패널은 오른쪽 아래 모서리로 크기를 바꿉니다.',
    '화면 가장자리에 놓거나, 막대를 두 번 클릭하거나, [붙이기]를 누르면 제자리로 돌아갑니다.',
  ], spot: ['.palette .dockbar', '.palette'] },
  { id: 'files', group: 'start', title: '탭과 파일', lines: [
    '여러 그림을 탭으로 함께 열어 둘 수 있습니다. 더블클릭으로 이름을 바꾸고, 끌어서 순서를 바꿉니다.',
    '저장은 같은 파일에 덮어씁니다. 파일은 JSON 그래프(groups · nodes · edges · annotations)입니다.',
    "템플릿도 같은 형식이라 [템플릿으로 저장]하면 메뉴에 들어옵니다.",
  ], keys: ['Ctrl+T 새 탭', 'Ctrl+Shift+T 닫은 탭 열기', 'Ctrl+S 저장', 'Ctrl+Shift+S 다른 이름', 'Ctrl+O 열기'], spot: ['.doctabs'] },

  { id: 'add', group: 'draw', title: '아이콘 넣기', lines: [
    '왼쪽 팔레트에서 끌어다 놓거나, 클릭하면 화면 가운데에 들어갑니다.',
    '상자를 고르면 그 안에 넣을 만한 것, 아이콘을 고르면 옆에 붙여 연결할 것이 팔레트 위에 추천됩니다.',
    '팔레트 위쪽 [글상자] [번호]로 설명과 순번을 붙입니다. 번호는 다음 수가 자동으로 붙습니다.',
  ], spot: ['.palette'] },
  { id: 'connect', group: 'draw', title: '선 잇기', lines: [
    '아이콘 가장자리의 작은 점을 끌어 다른 아이콘 위에 놓으면 연결됩니다.',
    '선을 선택하면 양 끝 손잡이로 대상을 바꾸거나, 빈 곳에 끝을 놓아 둘 수 있습니다.',
    '직각선은 가운데 손잡이로 꺾이는 위치를 옮기고, 두 번 클릭하면 가운데로 돌아갑니다. PowerPoint 에도 그대로 갑니다.',
  ], spot: ['.canvas'] },
  { id: 'boxes', group: 'draw', title: '상자에 넣기', lines: [
    '소속은 화면 위치 그대로입니다. 상자 안에 놓으면 그 상자를 따라 움직이고, 끄는 동안 들어갈 상자가 빛납니다.',
    '상자만 옮기려면 Alt 를 누른 채 끄세요. 상자는 안에 든 것보다 작게 줄어들지 않습니다.',
    'ASG·보안 그룹 같은 겹치는 상자는 아무것도 품지 않고 테두리만 움직입니다.',
  ], keys: ['Alt+끌기 상자만'], spot: ['.canvas'] },
  { id: 'edit', group: 'draw', title: '고치기 · 복사', lines: [
    '선택하고 Ctrl+C, 마우스를 둔 자리에 Ctrl+V. 다른 탭에도 붙일 수 있습니다.',
    '선택이 없을 때 Ctrl+C 는 그림(PNG) 복사입니다.',
    '이름은 더블클릭이나 F2, 옮기기는 화살표 키(Shift 를 누르면 10px).',
  ], keys: ['Ctrl+Z 되돌리기', 'Ctrl+Y 다시', 'Ctrl+X 잘라내기', 'Ctrl+D 복제', 'Delete 지우기', 'F2 이름', 'Esc 선택 해제'] },

  { id: 'align', group: 'arrange', title: '정렬 · 자동 정렬', lines: [
    '여러 개를 선택하면 오른쪽 패널과 오른쪽 클릭 메뉴에 정렬·간격·크기 맞추기가 나옵니다.',
    '끌 때는 분홍 안내선에 맞춰 붙습니다(보기 설정에서 끌 수 있음).',
    '[자동 정렬]은 빈 공간을 줄이고 나란한 상자와 아이콘 줄을 맞춥니다. Ctrl+A 로 전체를 고른 뒤 써도 됩니다.',
  ], keys: ['Ctrl+A 전체 선택'], spot: ['.side'] },
  { id: 'order', group: 'arrange', title: '앞뒤 순서 · 묶기 · 잠금', lines: [
    '오른쪽 클릭 [맨 앞으로 가져오기 · 뒤로 보내기]로 겹친 순서를 바꿉니다.',
    '여러 개를 묶으면 하나만 클릭해도 함께 선택되고 함께 움직입니다.',
    '잠근 것은 어떤 방법으로도 움직이지 않고 자물쇠가 보입니다. 전체 순서는 오른쪽 클릭 [레이어 목록 보기].',
  ], keys: ['Ctrl+] 앞으로', 'Ctrl+[ 뒤로', 'Ctrl+G 묶기', 'Ctrl+Shift+G 풀기', 'Ctrl+L 잠금'] },
  { id: 'snippet', group: 'arrange', title: '조각 템플릿', lines: [
    '자주 쓰는 묶음(예: 2-AZ 웹 계층)을 선택하고 오른쪽 클릭 [조각 템플릿으로 저장].',
    '템플릿 메뉴 [내 조각]에서 고르면 지금 그림에 끼워 넣습니다. 필요 없으면 × 로 지웁니다.',
  ] },
  { id: 'find', group: 'arrange', title: '찾기', lines: [
    '라벨·아이콘 이름·상자 종류로 찾아서 하나씩 가운데로 보여 줍니다.',
  ], keys: ['Ctrl+F 찾기', 'Enter 다음'] },

  { id: 'pins', group: 'ai', title: '경고 표시 (!)', lines: [
    '잘못 놓인 요소 위에는 주황·빨강 ! 가 늘 뜹니다. 눌러 보면 이유와 [AI에게 물어보기]가 나옵니다.',
    '보기 설정에서 숨길 수 있는 건 참고(i)뿐입니다.',
    '내보내기(PNG·PPT)에는 어느 표시도 들어가지 않습니다.',
  ], spot: ['.pin', '.canvas'] },
  { id: 'rules', group: 'ai', title: '규칙 검사', lines: [
    'AWS 기본 규칙에 어긋나면 차단(빨강)하거나 경고(주황)하면서 이유를 알려 드립니다.',
    '상단 방패 버튼에서 전체 목록을 보고, 누르면 해당 요소가 선택됩니다.',
  ], spot: ['.tour-rules'] },
  { id: 'aidraw', group: 'ai', title: '말로 그리기', lines: [
    '만들고 싶은 걸 막 적으세요. AI 가 부족한 것만 쉬운 질문으로 묻습니다(고르기만 하면 됨).',
    '그릴 내용을 먼저 보여 주고, [캔버스에 그리기]를 눌러야 그려집니다. Ctrl+Z 로 되돌릴 수 있습니다.',
    '물어본 것과 답한 것은 그림마다 기억해서 다음 요청에도 반영합니다.',
  ], spot: ['.tour-ai'] },
  { id: 'md', group: 'ai', title: '시스템 문서(MD)로 그리기', lines: [
    '이미 만든 프로그램이 있으면, 쓰시는 AI(Claude·ChatGPT·Cursor)에게 안내 문구로 물어 MD 파일을 받으세요.',
    '안내 문구는 [말로 그리기] 옆 [MD 는 어떻게 만들어요?]에 있고 [복사]로 가져갈 수 있습니다.',
    '받은 MD 를 [시스템 구조 문서(MD) 넣기]로 넣으면 그 내용을 근거로 그립니다.',
  ], spot: ['.doc-attach', '.tour-ai'] },
  { id: 'ask', group: 'ai', title: '물어보기 · AI 검수', lines: [
    '[AI 검수]는 요건 대비 빠진 것과 과한 것을 해당 요소 위에 표시합니다.',
    '답이 쓰임새(몇 명이 쓰는지, 회사 서비스인지 등)에 따라 달라지면 AI 가 먼저 쉬운 질문으로 되묻습니다.',
    '답한 내용은 [AI 에게 알려준 것]에 남고, 틀렸으면 × 로 지웁니다.',
  ], spot: ['.toolbar-ai'] },
  { id: 'aiconnect', group: 'ai', title: 'AI 연결', lines: [
    'Claude CLI 나 ChatGPT(Codex CLI)를 쓰면 내 구독으로 동작해 추가 비용이 없습니다(EXE 전용).',
    '처음이면 터미널에서 claude auth login 또는 codex login 으로 로그인해 두세요.',
    'API 키(Claude·OpenAI)도 됩니다. 이 경우 사용량만큼 요금이 듭니다.',
  ], spot: ['.ai-chip'] },

  { id: 'compact', group: 'export', title: '압축 버전 (슬라이드 한 칸용)', lines: [
    '빈 곳 오른쪽 클릭 [압축 버전 새 탭에 만들기] 또는 아무것도 고르지 않은 상태의 오른쪽 패널 버튼. 원본 탭은 그대로 둡니다.',
    'AZ A·B 처럼 같은 구조가 반복되면 하나만 남기고 이름에 ×2 를 붙입니다. NAT Gateway 같은 보조 아이콘과 빈 상자는 뺍니다.',
    'Auto Scaling 같은 겹치는 상자는 접어서 아이콘 이름에 "(Auto Scaling)" 으로 적고, 합친 AZ 의 DB 는 "(Multi-AZ)" 가 붙습니다.',
    '세로로 쌓인 상자는 한 줄로 눕혀 가로로 긴 그림이 됩니다. 마음에 안 드는 부분은 새 탭에서 손으로 고치면 됩니다.',
  ] },
  { id: 'png', group: 'export', title: 'PNG 로 복사', lines: [
    '[PNG 복사] 또는 Ctrl+C 로 클립보드에 넣고 PowerPoint 에서 Ctrl+V. 선택이 있으면 그 부분만 내보냅니다.',
    '[내보내기 ▾ › 내보내기 설정]에서 배율·배경·여백·16:9·제목·범례를 미리 보며 정합니다.',
  ], keys: ['Ctrl+C 그림 복사'], spot: ['.tour-export'] },
  { id: 'ppt', group: 'export', title: 'PowerPoint 편집 도형', desktop: true, lines: [
    '아이콘은 1.5cm SVG 그림, 상자는 사각형, 선은 도형에 붙은 연결선으로 들어갑니다. PowerPoint 에서 그대로 고칠 수 있습니다.',
  ], keys: ['Ctrl+Shift+C 도형 복사'], spot: ['.tour-export'] },

  { id: 'view', group: 'more', title: '보기 설정', lines: [
    '테마(라이트·다크), 텍스트 크기, 새 연결선 모양, 격자, 정렬 안내선, 참고(i) 표시, AI 사용 여부를 바꿉니다.',
    'AI 를 쓰지 않는 환경이면 [AI 기능 사용]을 끄면 AI 버튼이 모두 숨겨집니다.',
  ], spot: ['.settings'] },
  { id: 'update', group: 'more', title: '업데이트', desktop: true, action: 'update', lines: [
    '하루 한 번 새 버전을 확인해 상단에 [업데이트] 표시가 뜹니다. 누르면 바뀐 내용을 보고 바로 바꿀 수 있습니다.',
  ] },
  { id: 'feedback', group: 'more', title: '피드백 보내기', action: 'feedback', lines: [
    '불편한 점이나 바라는 것을 적어 주세요. 계정 없이 바로 만든 사람에게 전달됩니다.',
  ] },
  { id: 'tour', group: 'more', title: '둘러보기 (30초)', action: 'tour', lines: [
    '화면 곳곳을 차례로 짚어 주는 짧은 안내를 다시 봅니다.',
  ] },
  { id: 'advanced', group: 'more', title: '고급: 패치 명령', action: 'patch', lines: [
    'AI 가 만드는 변경 명령(JSON)을 직접 넣어 적용합니다. 고급 사용자용입니다.',
  ] },
  { id: 'about', group: 'more', title: '이 앱에 대해', action: 'about', lines: [
    '아이콘: AWS Architecture Icons (Icon Shelf 데이터 재사용). AWS 가 후원하거나 승인한 도구가 아닙니다.',
  ] },
];

const SHORTCUTS = [
  ['파일', ['Ctrl+S 저장', 'Ctrl+Shift+S 다른 이름', 'Ctrl+O 열기', 'Ctrl+T 새 탭', 'Ctrl+Shift+T 닫은 탭 열기']],
  ['고치기', ['Ctrl+Z 되돌리기', 'Ctrl+Y 다시', 'Ctrl+C 복사', 'Ctrl+V 붙이기', 'Ctrl+X 잘라내기', 'Ctrl+D 복제', 'Delete 지우기', 'F2 이름', 'Esc 선택 해제']],
  ['정리', ['Ctrl+A 전체 선택', 'Ctrl+G 묶기', 'Ctrl+Shift+G 풀기', 'Ctrl+L 잠금', 'Ctrl+] 앞으로', 'Ctrl+[ 뒤로', 'Alt+끌기 상자만', '화살표 1px 옮기기', 'Shift+화살표 10px']],
  ['보기·내보내기', ['Ctrl+F 찾기', 'Ctrl+C 그림 복사 (선택 없을 때)', 'Ctrl+Shift+C PowerPoint 도형']],
];

// "Ctrl+Shift+T 닫은 탭 열기" → [Ctrl+Shift+T] 닫은 탭 열기
function Key({ k }) {
  const i = k.indexOf(' ');
  return <span className="hk"><kbd>{i > 0 ? k.slice(0, i) : k}</kbd>{i > 0 && <span>{k.slice(i + 1)}</span>}</span>;
}

// [화면에서 보기]: 보이는 첫 자리를 화면에 들이고 몇 초 반짝인다
function spotlight(sels) {
  const el = (sels || []).map((s) => document.querySelector(s)).find((e) => e && e.getClientRects().length);
  if (!el) return false;
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  const ring = document.createElement('div');
  ring.className = 'help-spot';
  Object.assign(ring.style, { left: r.left - 6 + 'px', top: r.top - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px' });
  document.body.appendChild(ring);
  setTimeout(() => ring.remove(), 2600);
  return true;
}

/**
 * ctx: 지금 상황에 맞는 항목 id (App 이 선택 상태로 고른다). slots: { feedback, update, about } 상세 안에 넣을 화면.
 * on: { tour, patch }
 */
export function HelpPanel({ isDesktop, ctx, slots = {}, on = {} }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);         // 열린 항목 id 또는 'keys'
  const [dir, setDir] = useState('in');           // 밀려 들어오는 방향
  const [unfold, setUnfold] = useState(() => new Set());   // 펼친 묶음 (기본은 모두 접힘)
  const toggle = (id) => setUnfold((u) => { const n = new Set(u); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const listRef = useRef(null);
  const topics = useMemo(() => TOPICS.filter((t) => !t.desktop || isDesktop), [isDesktop]);
  const byId = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return null;
    return topics.filter((t) => (t.title + ' ' + t.lines.join(' ') + ' ' + (t.keys || []).join(' ')).toLowerCase().includes(s));
  }, [q, topics]);

  const go = (id) => { setDir('in'); setOpen(id); };
  const back = () => { setDir('out'); setOpen(null); };
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' || (e.key === 'ArrowLeft' && e.altKey)) { e.stopPropagation(); back(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const t = open && open !== 'keys' ? byId.get(open) : null;
  const sib = t ? topics.filter((x) => x.group === t.group) : [];
  const idx = t ? sib.indexOf(t) : -1;
  const suggest = ctx && byId.get(ctx);

  if (open === 'keys') {
    return (
      <div className="insp help hp" key="keys">
        <div className="hp-page in">
          <button className="hp-back" onClick={back}><Icon name="back" size={14} /> 목록</button>
          <h3>단축키 모음</h3>
          {SHORTCUTS.map(([g, ks]) => (
            <div key={g} className="hp-keys"><div className="hp-keys-h">{g}</div>{ks.map((k) => <Key key={k} k={k} />)}</div>
          ))}
        </div>
      </div>
    );
  }

  if (t) {
    const G = GROUPS.find((g) => g.id === t.group);
    return (
      <div className="insp help hp" key={t.id}>
        <div className={'hp-page ' + dir}>
          <button className="hp-back" onClick={back}><Icon name="back" size={14} /> 목록</button>
          <div className="hp-crumb"><Icon name={G.icon} size={13} /> {G.title}</div>
          <h3>{t.title}</h3>
          <ul className="hp-lines">{t.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          {t.keys && <div className="hp-keys">{t.keys.map((k) => <Key key={k} k={k} />)}</div>}
          {t.action === 'feedback' && slots.feedback}
          {t.action === 'update' && slots.update}
          {t.action === 'about' && slots.about}
          {t.action === 'tour' && <button className="primary" onClick={on.tour}>둘러보기 시작</button>}
          {t.action === 'patch' && <button onClick={on.patch}>패치 명령 넣기</button>}
          {t.spot && <button className="hp-show" onClick={() => spotlight(t.spot)}><Icon name="external" size={14} /> 화면에서 보기</button>}
          {sib.length > 1 && (
            <div className="hp-nav">
              <button disabled={idx <= 0} onClick={() => { setDir('back'); setOpen(sib[idx - 1].id); }}><Icon name="back" size={13} /> {idx > 0 ? sib[idx - 1].title : ''}</button>
              <span>{idx + 1} / {sib.length}</span>
              <button disabled={idx >= sib.length - 1} onClick={() => { setDir('in'); setOpen(sib[idx + 1].id); }}>{idx < sib.length - 1 ? sib[idx + 1].title : ''} <Icon name="chevron" size={13} /></button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="insp help hp" key="list">
      <div className={'hp-page ' + (dir === 'out' ? 'back' : 'fade')} ref={listRef}>
        <h3>도움말</h3>
        <label className="hp-search">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="찾기: 잠금, PPT, 연결…" spellCheck={false} />
          {q && <button className="x" onClick={() => setQ('')} aria-label="지우기"><Icon name="close" size={13} /></button>}
        </label>
        {hits ? (
          <div className="hp-list">
            {hits.length === 0 && <p className="hint">찾는 내용이 없습니다. 다른 말로 찾아보세요.</p>}
            {hits.map((x) => (
              <button key={x.id} className="hp-row" onClick={() => go(x.id)}>
                <span><b>{x.title}</b><small>{x.lines[0]}</small></span><Icon name="chevron" size={15} />
              </button>
            ))}
          </div>
        ) : (
          <>
            {suggest && (
              <button className="hp-suggest" onClick={() => go(suggest.id)}>
                <small>지금 도움이 될 것</small><b>{suggest.title}</b><Icon name="chevron" size={15} />
              </button>
            )}
            <div className="hp-groups">
              {GROUPS.map((g) => (
                <div key={g.id} className={'hp-group' + (unfold.has(g.id) ? ' open' : '')}>
                  <button className="hp-group-h" onClick={() => toggle(g.id)} aria-expanded={unfold.has(g.id)}>
                    <span className="hp-ic"><Icon name={g.icon} size={16} /></span><span><b>{g.title}</b><small>{g.sub}</small></span><Icon name="caret" size={15} className="hp-caret" />
                  </button>
                  <div className="hp-fold"><div className="hp-items">
                    {topics.filter((x) => x.group === g.id).map((x) => (
                      <button key={x.id} className="hp-item" tabIndex={unfold.has(g.id) ? 0 : -1} onClick={() => go(x.id)}>{x.title}<Icon name="chevron" size={13} /></button>
                    ))}
                  </div></div>
                </div>
              ))}
            </div>
            <button className="hp-row keys" onClick={() => go('keys')}><span className="hp-ic"><Icon name="keyboard" size={16} /></span><span><b>단축키 모음</b><small>한 장에 모아 봤어요</small></span><Icon name="chevron" size={15} /></button>
          </>
        )}
      </div>
    </div>
  );
}
