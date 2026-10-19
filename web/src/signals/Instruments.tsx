import { useEffect, useState } from "react";
import type { ControlConfig } from "./files";
import type { QuickCommand } from "../commandUtils";
import { calibrated, formatNumber, statistics, type Channel, type SignalSample } from "./math";

export function MeterCards({ samples, channels, selected }: { samples: readonly SignalSample[]; channels: Channel[]; selected: number[] }) {
  return <div className="signal-meters">{selected.slice(0, 8).map(index => {
    const channel = channels[index]!, latest = samples.at(-1), value = latest ? calibrated(latest, index, channel) : NaN;
    const stats = statistics(samples.map(sample => calibrated(sample, index, channel)));
    const ratio = Number.isFinite(value) ? Math.max(0, Math.min(1, (value - channel.min) / (channel.max - channel.min))) : 0;
    const outOfRange = Number.isFinite(value) && (value < channel.min || value > channel.max);
    return <article className={`signal-meter ${outOfRange ? "out-of-range" : ""}`} key={index} style={{ "--channel-color": channel.color } as React.CSSProperties}>
      <div className="meter-title"><span className="channel-dot" /><strong>{channel.name}</strong><span>{channel.unit || `CH${index}`}</span></div>
      <div className="meter-main"><div><strong data-testid={`meter-value-${index}`}>{formatNumber(value, 6)}</strong><small>{outOfRange ? "超出设定量程" : "最新采样"}</small></div>
        <svg viewBox="0 0 120 75" role="img" aria-label={`${channel.name} 仪表 ${formatNumber(value)}`}><path d="M15 65 A45 45 0 0 1 105 65" pathLength="100" fill="none" stroke="#e9eff8" strokeWidth="9" strokeLinecap="round" />
          <path d="M15 65 A45 45 0 0 1 105 65" pathLength="100" fill="none" stroke={channel.color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${ratio * 100} 100`} />
          <line x1="60" y1="65" x2={60 - Math.cos(ratio * Math.PI) * 34} y2={65 - Math.sin(ratio * Math.PI) * 34} stroke="#526783" strokeWidth="2" /><circle cx="60" cy="65" r="4" fill="#526783" /></svg></div>
      <div className="meter-bar"><span style={{ width: `${ratio * 100}%` }} /></div>
      <div className="meter-statistics"><span>MIN <b>{formatNumber(stats.min)}</b></span><span>MAX <b>{formatNumber(stats.max)}</b></span><span>RMS <b>{formatNumber(stats.rms)}</b></span></div>
    </article>;
  })}</div>;
}
export function Attitude({ latest, channels, count }: { latest: SignalSample | undefined; channels: Channel[]; count: number }) {
  const [mapping, setMapping] = useState([0, 1, 2]);
  const [radians, setRadians] = useState(false);
  const values = mapping.map(index => latest ? calibrated(latest, index, channels[index]!) * (radians ? 180 / Math.PI : 1) : NaN);
  const valid = values.every(Number.isFinite);
  const safe = values.map(value => Number.isFinite(value) ? value % 360 : 0);
  return <article className="signal-card attitude-card" role="tabpanel" id="analysis-attitude" aria-labelledby="analysis-tab-attitude"><div className="instrument-heading"><div><span className="eyebrow">ORIENTATION</span><h3>三轴姿态</h3></div><span className={`signal-tag ${valid ? "" : "warn"}`}>{valid ? "EULER · ZYX" : "缺少有效角度"}</span></div>
    <div className="attitude-stage" role="img" aria-label={valid ? `Roll ${formatNumber(values[0])} 度，Pitch ${formatNumber(values[1])} 度，Yaw ${formatNumber(values[2])} 度` : "等待三轴角度数据"}>
      <div className="attitude-grid" /><div className="attitude-camera"><div className="attitude-cube" style={{ transform: `rotateZ(${safe[2]}deg) rotateY(${safe[1]}deg) rotateX(${safe[0]}deg)` }}>
        {["front", "back", "left", "right", "top", "bottom"].map(face => <div key={face} className={`cube-face ${face}`}>{face === "front" ? "SERIALHUB" : face.toUpperCase()}</div>)}</div></div>
      <span className="attitude-axis x">X</span><span className="attitude-axis y">Y</span><span className="attitude-axis z">Z</span>
    </div>
    <div className="attitude-values">{["ROLL", "PITCH", "YAW"].map((name, index) => <div key={name}><small>{name}</small><strong>{formatNumber(values[index])}<span>°</span></strong><select aria-label={`${name} 通道`} value={mapping[index]} onChange={event => setMapping(previous => previous.map((value, position) => position === index ? Number(event.target.value) : value))}>
      {Array.from({ length: Math.max(3, count) }, (_, channel) => <option key={channel} value={channel}>{channels[channel]!.name}</option>)}</select></div>)}</div>
    <label className="check"><input type="checkbox" checked={radians} onChange={event => setRadians(event.target.checked)} />输入为弧度</label><p className="signal-note">直接显示输入欧拉角；不从加速度估计姿态。</p>
  </article>;
}
export function ControlDeck({ config, onConfig, commands, canWrite, busy, onQuick, onValue }: { config: ControlConfig; onConfig(config: ControlConfig): void; commands: QuickCommand[]; canWrite: boolean; busy: boolean; onQuick(command: QuickCommand): Promise<boolean>; onValue(payload: string): Promise<boolean> }) {
  const [draft, setDraft] = useState(config);
  const template = config.template;
  useEffect(() => { setDraft(config); }, [config]);
  const [value, setValue] = useState(50);
  const [result, setResult] = useState("");
  useEffect(() => { setValue(previous => Math.min(config.max, Math.max(config.min, previous))); }, [config.min, config.max]);
  return <article className="signal-card control-deck" role="tabpanel" id="analysis-control" aria-labelledby="analysis-tab-control"><div className="instrument-heading"><div><span className="eyebrow">CONTROL DECK</span><h3>参数与命令</h3></div><span className="signal-tag">手动确认发送</span></div>
    <label>发送模板（使用 {'{value}'}）<input aria-label="仪表发送模板" maxLength={512} value={template} onChange={event => onConfig({ ...config, template: event.target.value })} /></label>
    <div className="control-value"><strong>{value}</strong><input aria-label="仪表设定值" type="number" min={config.min} max={config.max} step={config.step} value={value} onChange={event => { const next = Number(event.target.value); if (Number.isFinite(next)) setValue(Math.max(config.min, Math.min(config.max, next))); }} /></div>
    <details className="control-range-settings"><summary>滑块范围与步长</summary><div className="row">{([['min', '下限'], ['max', '上限'], ['step', '步长']] as const).map(([key, title]) => <label key={key}>{title}<input aria-label={`控件${title}`} type="number" step="any" value={draft[key]} onChange={event => setDraft(previous => ({ ...previous, [key]: Number(event.target.value) }))} /></label>)}</div>
      <button type="button" className="ghost" onClick={() => {
        if (![draft.min, draft.max, draft.step].every(Number.isFinite) || draft.min >= draft.max || draft.step <= 0 || draft.step > draft.max - draft.min) { setResult("请设置有效的量程与步长"); return; }
        onConfig({ ...draft, template }); setResult("控件量程已应用，不会发送命令");
      }}>应用控件量程</button></details>
    <input className="control-slider" aria-label="参数滑块" type="range" min={config.min} max={config.max} step={config.step} value={value} onChange={event => setValue(Number(event.target.value))} />
    <button type="button" disabled={!canWrite || busy || !template.includes("{value}")} onClick={async () => { setResult("正在等待主机确认…"); setResult(await onValue(template.replaceAll("{value}", String(value))) ? `设定值 ${value} · 主机已确认；请核对设备响应` : "未确认，请检查终端日志"); }}>发送设定值</button>
    <div className="control-quick-buttons">{commands.slice(0, 8).map(command => <button key={command.id} type="button" className="ghost" disabled={!canWrite || busy} onClick={async () => { setResult("正在等待主机确认…"); setResult(await onQuick(command) ? `${command.name} · 主机已确认` : "命令未确认，请检查终端日志"); }}>{command.name}</button>)}</div>
    {result && <p className="signal-note" role="status">{result}</p>}<p className="signal-note">调整滑块不会直接发送；回放模式禁用发送。共用 Hub 写入仲裁；文本使用 UTF-8 + LF。</p>
  </article>;
}
