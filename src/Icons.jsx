// 툴바 아이콘 (16x16, stroke 1.5, currentColor). 유나(UX) 정리안 기준.
import React from 'react';

const P = {
  new: <><path d="M9 1.75H4.25a1 1 0 0 0-1 1v10.5a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V5.5z" /><path d="M9 1.75V5.5h3.75" /><path d="M8 8v4M6 10h4" /></>,
  open: <><path d="M1.75 12.5V3.75a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1V6.5" /><path d="M1.75 12.5l1.6-5.2a1 1 0 0 1 .96-.7h9.44a.75.75 0 0 1 .72.97l-1.4 4.5a1 1 0 0 1-.96.68H2.75a1 1 0 0 1-1-1z" /></>,
  save: <><path d="M2.75 2.25h8.5l2 2v9a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5V2.75a.5.5 0 0 1 .5-.5z" /><path d="M5 2.25v3.5h5.5v-3.5" /><rect x="4.5" y="9" width="7" height="4.75" rx=".5" /></>,
  template: <><rect x="2" y="2" width="12" height="12" rx="1.5" /><path d="M2 6h12M6.5 6v8" /></>,
  caret: <path d="M4.5 6.5L8 10l3.5-3.5" />,
  infra: <><rect x="2.25" y="2.5" width="11.5" height="4.5" rx="1" /><rect x="2.25" y="9" width="11.5" height="4.5" rx="1" /><path strokeWidth="2" d="M4.75 4.75h.01M4.75 11.25h.01" /></>,
  card: <><rect x="1.75" y="3" width="12.5" height="10" rx="1.5" /><path d="M4.5 6.5h4M4.5 9.5h7" /></>,
  undo: <><path d="M5.5 3.5l-3 3 3 3" /><path d="M2.5 6.5h7a3.5 3.5 0 0 1 0 7H7" /></>,
  redo: <><path d="M10.5 3.5l3 3-3 3" /><path d="M13.5 6.5h-7a3.5 3.5 0 0 0 0 7H9" /></>,
  copy: <><rect x="5.25" y="5.25" width="9" height="9" rx="1.25" /><path d="M10.75 5.25V3A1.25 1.25 0 0 0 9.5 1.75H3A1.25 1.25 0 0 0 1.75 3v6.5A1.25 1.25 0 0 0 3 10.75h2.25" /></>,
  sparkle: <><path d="M8 1.75l1.3 3.45a1 1 0 0 0 .58.58L13.25 7l-3.37 1.22a1 1 0 0 0-.58.58L8 12.25 6.7 8.8a1 1 0 0 0-.58-.58L2.75 7l3.37-1.22a1 1 0 0 0 .58-.58z" /><path d="M12.5 11.5v2.5M11.25 12.75h2.5" /></>,
  panel: <><rect x="1.75" y="2.5" width="12.5" height="11" rx="1.5" /><path d="M10 2.5v11" /></>,
  shield: <><path d="M8 1.75l5 1.9v4.1c0 3-2.1 5.4-5 6.5-2.9-1.1-5-3.5-5-6.5v-4.1z" /><path d="M5.75 8l1.6 1.6 2.9-3.1" /></>,
  guide: <><path d="M8 1.75v12.5" /><path d="M8 3.25h4.25l1.5 1.5-1.5 1.5H8" /><path d="M8 8H3.75l-1.5 1.5 1.5 1.5H8" /></>,
  help: <><circle cx="8" cy="8" r="6.25" /><path d="M6.25 6.25a1.75 1.75 0 1 1 2.5 1.6c-.5.25-.75.6-.75 1.15v.25" /><path strokeWidth="2" d="M8 11.5h.01" /></>,
  settings: <><path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" /><circle cx="10" cy="4.5" r="1.5" /><circle cx="6" cy="11.5" r="1.5" /></>,
  spinner: <path d="M8 2a6 6 0 1 0 6 6" />,
  layers: <><path d="M8 2l6 3.25-6 3.25-6-3.25z" /><path d="M2 8.25l6 3.25 6-3.25" /><path d="M2 11.25l6 3.25 6-3.25" /></>,
  feedback: <><path d="M2.5 3.5h11v7.5h-6l-3 2.5v-2.5h-2z" /><path d="M5.5 6.5h5M5.5 8.5h3" /></>,
};

export function Icon({ name, size = 16, className = '' }) {
  return (
    <svg className={'ic ' + className} viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}
