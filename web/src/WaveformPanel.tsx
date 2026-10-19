import { useMemo } from "react";
import { useSignalSnapshot } from "./signals/useSignalSnapshot";
import { SignalStore } from "./signals/store";
import { COLORS, extent, formatNumber, plotPath } from "./signals/math";
export default function WaveformPanel({ store, protocolLabel, connected, onOpen }: { connected: boolean; store: SignalStore; protocolLabel: string; onOpen(): void }) {
  const snapshot = useSignalSnapshot(store);
  const samples = useMemo(() => snapshot.samples.slice(-512), [snapshot.samples]);
  const count = Math.min(4, snapshot.channels);
  const domain = extent(samples.flatMap(sample => sample.values.slice(0, count)));
  const first = samples[0]?.index ?? 0, last = Math.max(first + 1, samples.at(-1)?.index ?? 1);
  return <section className="panel waveform-panel"><div className="log-head"><div><h2>数据波形</h2><p className="hint">{protocolLabel} · {snapshot.source === "replay" ? "CSV 离线回放" : connected && snapshot.connected ? "实时采样" : "离线缓存"} · {snapshot.samples.length.toLocaleString()} samples · {snapshot.channels} channels</p></div>
    <button type="button" className="ghost" onClick={onOpen}>打开信号仪表 ↗</button></div>
    <div className="waveform-preview-legend">{Array.from({ length: count }, (_, index) => <span key={index} style={{ color: COLORS[index] }}>CH{index} <b>{formatNumber(samples.at(-1)?.values[index])}</b></span>)}</div>
    <div className="waveform-shell">{samples.length ? <svg className="waveform" viewBox="0 0 960 220" preserveAspectRatio="none" role="img" aria-label="最近采样多通道预览">
      {Array.from({ length: count }, (_, index) => <path data-preview-channel={index} key={index} d={plotPath(samples.map(sample => ({ x: sample.index, y: sample.values[index] ?? NaN })), value => (value - first) / (last - first) * 960, value => 210 - (value - domain[0]) / (domain[1] - domain[0]) * 200)} fill="none" stroke={COLORS[index]} strokeWidth="1.7" />)}
    </svg> : <p className="muted">选择 FireWater 或 JustFloat，收到完整数据帧后显示波形。</p>}</div>
  </section>;
}
