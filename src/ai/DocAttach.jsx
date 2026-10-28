// 시스템 구조 문서(MD) 첨부: 다른 AI 로 뽑은 README·HANDOFF 같은 문서를 넣으면 그림의 1차 근거로 쓴다.
// "어떻게 만들어요?" 를 누르면 사용자의 AI 에게 그대로 복사해 물어볼 안내 문구를 보여 준다.
import React, { useRef, useState } from 'react';
import { Icon } from '../Icons.jsx';

export const DOC_PROMPT = `이 프로젝트를 AWS 아키텍처 그림으로 그리려고 해. 아래 항목을 마크다운(.md) 한 파일로 정리해 줘.
모르는 건 지어내지 말고 "모름"이라고 써 줘. 코드나 설정 파일에서 확인한 건 어디서 봤는지도 적어 줘.

1. 한 줄 소개: 무엇을 하는 서비스인지, 누가 쓰는지
2. 구성 요소: 화면(프론트엔드), 서버(백엔드), 데이터베이스, AI 모델, 예약 작업(밤마다 도는 것 등)
   - 각각 무엇으로 만들었는지 (언어·프레임워크·라이브러리, 모델 이름과 크기)
3. 지금 어디서 돌고 있는지: 내 PC / 회사 서버 / 클라우드, 포트 번호, 하루 종일 켜져 있는지
4. 데이터: 무엇을 어디에 저장하는지 (파일·DB·이미지·모델 파일), 대략 크기, 개인정보가 있는지
5. 바깥과의 연결: 외부 API, 로그인, 결제, 검색, 메일 등
6. 처리 흐름: 사용자가 무언가를 하면 어떤 순서로 처리되는지 (예: 화면 → 서버 → AI 모델 → DB)
7. 목적과 규모: 회사 서비스 / 포트폴리오 / 개인용 중 무엇인지, 몇 명이 쓸지, 계속 켜 둬야 하는지, 한 달 예산
8. 꼭 지켜야 할 것: 보안, 속도, 비용, 끊기면 안 되는 정도 등`;

export async function readDocFile(file, onError) {
  if (!file) return null;
  if (file.size > 2 * 1024 * 1024) { onError?.('2MB 보다 큰 파일은 넣을 수 없습니다.'); return null; }
  const text = await file.text();
  if (!text.trim()) { onError?.('비어 있는 파일입니다.'); return null; }
  return { name: file.name, text };
}

export function DocAttach({ doc, onAttach, onError, onCopied }) {
  const ref = useRef(null);
  const [how, setHow] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(DOC_PROMPT); onCopied?.('안내 문구를 복사했습니다. 쓰시는 AI 에 붙여 넣고, 나온 MD 파일을 여기에 넣어 주세요.'); }
    catch { onError?.('복사하지 못했습니다. 글을 직접 선택해 복사해 주세요.'); }
  };
  return (
    <div className="doc-attach">
      <div className="doc-row">
        {doc ? (
          <span className="doc-chip" title={doc.text.slice(0, 300)}><Icon name="file" size={14} /> {doc.name} <small>{doc.text.length < 1000 ? `${doc.text.length}자` : `${Math.round(doc.text.length / 1000)}천 자`}</small>
            <button className="x" onClick={() => onAttach(null)} aria-label="첨부 빼기"><Icon name="close" size={14} /></button></span>
        ) : (
          <button className="doc-btn" onClick={() => ref.current?.click()}><Icon name="attach" size={15} /> 시스템 구조 문서(MD) 넣기</button>
        )}
        <button className="link" onClick={() => setHow(!how)}>{how ? '안내 닫기' : 'MD 는 어떻게 만들어요?'}</button>
      </div>
      {how && (
        <div className="doc-how">
          <p>쓰시는 AI(Claude, ChatGPT, Cursor 등)에게 <b>프로젝트 폴더를 열어 둔 채</b> 아래 글을 그대로 물어보세요. 나온 MD 파일을 위 버튼으로 넣으면 됩니다.</p>
          <pre>{DOC_PROMPT}</pre>
          <button className="small" onClick={copy}>안내 문구 복사</button>
        </div>
      )}
      <input ref={ref} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden
        onChange={async (e) => { const d = await readDocFile(e.target.files?.[0], onError); e.target.value = ''; if (d) onAttach(d); }} />
    </div>
  );
}
