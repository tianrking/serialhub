import { useEffect, useRef, useState, type RefObject } from "react";
export default function TrafficCounters({ counters }: { counters: RefObject<{ rx: number; tx: number }> }) {
  const baseline = useRef({ rx: 0, tx: 0 });
  const source = useRef(counters.current);
  const previous = useRef({ rx: 0, tx: 0, time: performance.now() });
  const [view, setView] = useState({ rx: 0, tx: 0, rxRate: 0, txRate: 0 });
  const reset = () => { baseline.current = { ...counters.current }; previous.current = { ...counters.current, time: performance.now() }; setView({ rx: 0, tx: 0, rxRate: 0, txRate: 0 }); };
  useEffect(() => {
    const timer = setInterval(() => {
      const current = counters.current, time = performance.now();
      if (source.current !== current) {
        source.current = current;
        baseline.current = { rx: 0, tx: 0 };
        previous.current = { rx: 0, tx: 0, time: time - 1000 };
      }
      const last = previous.current;
      if (current.rx < baseline.current.rx || current.tx < baseline.current.tx) baseline.current = { rx: 0, tx: 0 };
      const elapsed = Math.max(0.001, (time - last.time) / 1000);
      setView({ rx: current.rx - baseline.current.rx, tx: current.tx - baseline.current.tx,
        rxRate: Math.max(0, (current.rx - last.rx) / elapsed), txRate: Math.max(0, (current.tx - last.tx) / elapsed) });
      previous.current = { ...current, time };
    }, 1000);
    return () => clearInterval(timer);
  }, [counters]);
  return <div className="traffic-counters" aria-label="本页收发统计"><span>本页统计</span><strong>RX <b data-testid="session-rx">{view.rx.toLocaleString()}</b> B</strong><small>{view.rxRate.toFixed(0)} B/s</small>
    <strong>TX <b data-testid="session-tx">{view.tx.toLocaleString()}</b> B</strong><small>{view.txRate.toFixed(0)} B/s</small>
    <button type="button" className="ghost small" onClick={reset}>统计清零</button><span className="hint">接收含历史流；发送按主机确认计数</span></div>;
}
