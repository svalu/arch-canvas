import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import App from './App.jsx';
import { loadCatalog, CatalogContext } from './catalog.js';

// 화면 그리기 중 오류가 나도 흰 화면으로 끝나지 않게. 저장본은 그대로 있으니 다시 불러오면 된다.
class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error('Arch Canvas 화면 오류', err, info?.componentStack); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="boot error crash">
        <h3>화면을 그리는 중 오류가 났습니다.</h3>
        <p>작업 내용은 자동 저장돼 있습니다. [다시 불러오기]를 누르십시오. 같은 오류가 반복되면 마지막 동작을 되돌린 뒤 다시 불러오십시오.</p>
        <pre>{String(this.state.err?.message || this.state.err)}</pre>
        <button className="primary" onClick={() => location.reload()}>다시 불러오기</button>
      </div>
    );
  }
}

const root = createRoot(document.getElementById('root'));
root.render(<div className="boot">아이콘 불러오는 중…</div>);
loadCatalog()
  .then((catalog) => root.render(
    <ErrorBoundary>
      <CatalogContext.Provider value={catalog}>
        <App />
      </CatalogContext.Provider>
    </ErrorBoundary>,
  ))
  .catch((e) => root.render(<div className="boot error">아이콘 데이터를 읽지 못했습니다: {String(e.message || e)}</div>));
