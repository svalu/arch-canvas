// 사라질 때도 모션을 주기 위한 훅. value 가 null 이 돼도 ms 동안 마지막 값을 들고 있고, 그동안 closing=true.
//   const ex = useExit(menu, 140);  if (!ex.v) return null;  <div className={ex.closing ? 'closing' : ''}>…
import { useEffect, useState } from 'react';

export function useExit(value, ms = 160) {
  const [state, setState] = useState({ v: value, closing: false });
  useEffect(() => {
    if (value) { setState({ v: value, closing: false }); return undefined; }
    let cancelled = false;
    setState((s) => (s.v ? { ...s, closing: true } : s));
    const t = setTimeout(() => { if (!cancelled) setState({ v: null, closing: false }); }, ms);
    return () => { cancelled = true; clearTimeout(t); };
  }, [value, ms]);
  return state;
}
