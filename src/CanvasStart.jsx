// 빈 캔버스 첫 화면: 버튼 나열 대신 "무엇을 그려 볼까요?" 한 칸. 적고 Enter 면 말로 그리기가 바로 시작된다.
// 템플릿·가이드·직접 그리기는 아래 작은 카드로. 캔버스로 끌어다 놓는 건 그대로 된다(카드 바깥은 클릭이 통과).
import React, { useState } from 'react';
import { Icon } from './Icons.jsx';

const EXAMPLES = [
  '쇼핑몰을 AWS 에 올리고 싶어. 사람 몰려도 안 멈추게',
  '내 PC 에서 도는 AI 를 밖에서도 휴대폰으로 쓰고 싶어',
  '고객센터에 AI 상담을 붙이고 싶어',
];

export function CanvasStart({ onWizard, onTemplates, onGuide, onHide }) {
  const [text, setText] = useState('');
  const go = (t) => onWizard((t ?? text).trim());
  return (
    <div className="cstart" aria-label="시작하기">
      <div className="cstart-card">
        <div className="cstart-kicker"><Icon name="sparkle" size={14} /> 말로 그리기</div>
        <h2>무엇을 그려 볼까요?</h2>
        <p className="cstart-sub">만들고 싶은 걸 막 적으세요. AWS 를 몰라도 괜찮아요. 부족한 건 제가 쉬운 질문으로 여쭤볼게요.</p>
        <div className="cstart-input">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="예: 내 PC 에서 도는 AI 를 밖에서도 휴대폰으로 쓰고 싶어"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); go(); } }} />
          <button className="cstart-go" onClick={() => go()} aria-label="그리기 시작" title="그리기 시작 (Enter)">
            <Icon name="arrow" size={18} strokeWidth={2.2} />
          </button>
        </div>
        <div className="cstart-chips">
          {EXAMPLES.map((x) => <button key={x} className="chip" onClick={() => go(x)}>{x}</button>)}
        </div>
        <div className="cstart-ways">
          <button onClick={() => go('')}><span><Icon name="file" size={20} /></span><b>시스템 문서로</b><small>다른 AI 로 뽑은 MD 넣기</small></button>
          <button onClick={onTemplates}><span><Icon name="template" size={20} /></span><b>템플릿에서</b><small>3티어 웹, 서버리스 …</small></button>
          <button onClick={onGuide}><span><Icon name="guide" size={20} /></span><b>따라 하기</b><small>순서대로 버튼만</small></button>
          <button onClick={onHide}><span><Icon name="draw" size={20} /></span><b>직접 그리기</b><small>왼쪽에서 끌어다 놓기</small></button>
        </div>
      </div>
    </div>
  );
}
