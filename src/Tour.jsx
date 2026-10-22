// 둘러보기: 처음 켰을 때 화면 요소를 하나씩 밝히며 설명한다. 대상은 CSS 선택자, 카드는 대상 옆에 붙는다.
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { useExit } from './useExit.js';

export const TOUR_KEY = 'arch-canvas:tour-done';
export const tourDone = () => { try { return localStorage.getItem(TOUR_KEY) === '1'; } catch { return false; } };

const STEPS = [
  { sel: null, title: 'Arch Canvas 에 오신 것을 환영합니다', body: 'AWS 아키텍처 다이어그램을 그리고, 규칙과 AI 로 검수하고, 제안서에 바로 붙일 수 있는 도구입니다. 주요 화면을 30초 동안 안내해 드립니다.' },
  { sel: '.tour-guide', title: '가이드', body: '처음 사용하신다면 여기서 시작하십시오. 만들 구성 선택 → 요건 체크 → 단계별 [넣기] 순서로 진행하면 다이어그램이 완성됩니다. 단계마다 그렇게 구성하는 이유도 함께 안내합니다.' },
  { sel: '.palette', title: '팔레트', body: '아이콘과 그룹을 고르는 곳입니다. 선택한 것이 없으면 자주 쓰는 항목을, 그룹을 선택하면 그 안에 넣을 항목을, 아이콘을 선택하면 연결할 만한 항목을 보여 줍니다. 클릭하거나 캔버스로 끌어다 놓으면 추가됩니다. 글상자와 번호도 여기에 있습니다.' },
  { sel: '.canvas', title: '캔버스', body: '다이어그램을 그리는 곳입니다. 요소 가장자리의 점을 끌어 다른 요소에 놓으면 연결되고, 그룹 안에 놓으면 그 그룹에 들어갑니다. Shift+클릭이나 Shift+드래그로 여러 개를 선택하고, 오른쪽 클릭으로 정렬·복제 등을 할 수 있습니다.' },
  { sel: '.settings', title: '보기 설정', body: '테마(라이트·다크), 텍스트 크기, 새 연결선 모양, 격자, 정렬 안내선, AI 사용 여부를 바꿀 수 있습니다. 격자와 그림자는 화면에만 보이고 내보낸 그림에는 들어가지 않습니다.' },
  { sel: '.tour-layers', title: '레이어', body: '무엇이 어느 상자 안에 들어 있는지와 앞뒤 순서를 보여 줍니다. 상자 안의 것은 상자를 따라 움직이며, 상자만 옮기려면 Alt 를 누른 채 끄십시오. 순서는 Ctrl+[ ] 로, 잠금은 Ctrl+L 로 바꿉니다.' },
  { sel: '.tour-rules', title: '규칙 검사', body: '그리는 동안 AWS 기본 규칙을 자동으로 검사합니다. 어긋나면 차단(빨강)하거나 경고(주황)하고 이유를 알려 드립니다. 숫자가 표시되면 눌러서 목록을 확인하십시오.' },
  { sel: '.toolbar-ai', title: 'AI 검수', body: '제안서 제목과 요건서를 넣어 두면 AI 가 요건 대비 빠진 것과 과한 것을 해당 요소 위에 표시합니다. 처음 사용할 때는 연결 방식(Claude CLI 또는 API 키)을 고르고 실제 응답을 확인하는 과정을 거칩니다.' },
  { sel: '.tour-ai', title: 'AI 패널', body: '제안서 컨텍스트를 입력하고, "그리기·고치기"에 원하는 구성을 문장으로 적으면 바뀔 내용을 미리 보여 드립니다. [적용]으로 반영하며, 검수 결과도 여기에 모입니다.' },
  { sel: '.tour-export', title: '내보내기', body: 'Ctrl+C 또는 [PNG 복사]로 그림을 클립보드에 넣고 PowerPoint 에서 Ctrl+V 로 붙입니다. 선택한 것이 있으면 그 부분만 내보냅니다. 배율·제목·범례·16:9 는 [▾ > 내보내기 설정]에서 정합니다.' },
  { sel: '.doctabs', title: '탭', body: '여러 다이어그램을 동시에 열어 둘 수 있습니다. + 로 새 탭을 열고, 더블클릭으로 이름을 바꾸고, 끌어서 순서를 바꿉니다. 닫은 탭은 Ctrl+Shift+T 로 다시 열 수 있습니다.' },
  { sel: '.side', title: '오른쪽 패널', body: '선택한 요소의 이름·종류·선 모양을 바꾸는 곳입니다. 여러 개를 선택하면 정렬 도구가 나타납니다. 가장자리를 끌어 폭을 조절할 수 있습니다.' },
  { sel: null, title: '안내를 마쳤습니다', body: '도움이 필요하면 상단 [?] 에서 사용법을 확인하실 수 있고, 이 안내도 다시 볼 수 있습니다. [가이드로 시작]을 눌러 첫 다이어그램을 만들어 보십시오.' },
];

export function Tour({ open, onClose }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  useEffect(() => { if (open) setI(0); }, [open]);
  const step = STEPS[i];

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = step.sel ? document.querySelector(step.sel) : null;
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect({ x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, i, step.sel]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); finish(); }
      if (e.key === 'ArrowRight' || (e.key === 'Enter' && !(document.activeElement?.tagName === 'BUTTON' && document.activeElement.closest('.tour-card')))) { e.stopPropagation(); e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft') { e.stopPropagation(); setI((v) => Math.max(0, v - 1)); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const ex = useExit(open || null, 220);
  if (!open && !ex.v) return null;
  const closing = !open;
  const finish = () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* */ } onClose(); };
  const next = () => (i + 1 < STEPS.length ? setI(i + 1) : finish());

  // 카드 위치: 대상 아래, 안 맞으면 위, 오른쪽 패널이면 왼쪽
  const W = 340, H = 170, M = 12;
  let cardStyle;
  if (!rect) cardStyle = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  else {
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = Math.min(Math.max(M, rect.x), vw - W - M);
    let top = rect.y + rect.h + M;
    if (top + H > vh) top = rect.y - H - M;
    if (rect.w > vw * 0.5 && rect.h > vh * 0.5) { left = rect.x + rect.w / 2 - W / 2; top = rect.y + rect.h / 2 - H / 2; }   // 캔버스처럼 큰 대상은 가운데
    if (rect.x + rect.w > vw - 40 && rect.w < vw * 0.4) { left = rect.x - W - M; top = Math.max(M, rect.y + 40); }           // 오른쪽 패널
    if (rect.x < 40 && rect.w < vw * 0.4) { left = rect.x + rect.w + M; top = Math.max(M, rect.y + 40); }                    // 왼쪽 팔레트
    cardStyle = { left, top };
  }

  return (
    <div className={'tour' + (closing ? ' closing' : '')} role="dialog" aria-modal="true" aria-label="둘러보기">
      <div className="tour-dim" style={rect ? { left: rect.x, top: rect.y, width: rect.w, height: rect.h } : { left: '50%', top: '50%', width: 0, height: 0 }} onClick={next} />
      <div className="tour-card" style={cardStyle} key={i}>
        <div className="tour-step">{i + 1} / {STEPS.length}</div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-actions">
          <button className="link" onClick={finish}>건너뛰기</button>
          <span style={{ flex: 1 }} />
          {i > 0 && <button onClick={() => setI(i - 1)}>이전</button>}
          <button className="primary" onClick={next} autoFocus>{i + 1 < STEPS.length ? '다음' : '시작하기'}</button>
        </div>
      </div>
    </div>
  );
}
