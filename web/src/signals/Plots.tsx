import { useEffect, useRef, useState, type RefObject } from "react";
import { axisTick, calibrated, scopePoints, extent, formatNumber, histogram, plotPath, type Channel, type SignalSample, type Spectrum } from "./math";
import { downloadBlob } from "../serialTools";
import { imageRgba, type ImageFrame } from "./store";

const PLOT = { width: 1000, height: 330, left: 65, right: 24, top: 24, bottom: 40 };
export function PlotGrid({ xDomain, yDomain, xLabel = "时间 / s", yLabel = "幅值", height = PLOT.height, hideY = false }: { xDomain: [number, number]; yDomain: [number, number]; xLabel?: string; yLabel?: string; height?: number; hideY?: boolean }) {
  const { width: w, left: l, right: r, top: t, bottom: b } = PLOT;
  const h = height;
  return <g fontFamily="ui-monospace,monospace" fontSize="10" fill="#758aa9">
    <rect width={w} height={h} rx="10" fill="#0e1b2e" />
    {Array.from({ length: 9 }, (_, index) => <g key={`x${index}`}><line x1={l + index * (w - l - r) / 8} x2={l + index * (w - l - r) / 8} y1={t} y2={h - b} stroke="#24364e" strokeWidth=".6" />
      <text x={l + index * (w - l - r) / 8} y={h - 23} textAnchor="middle">{axisTick(xDomain[0] + index / 8 * (xDomain[1] - xDomain[0]), (xDomain[1] - xDomain[0]) / 8)}</text></g>)}
    {Array.from({ length: 5 }, (_, index) => <g key={`y${index}`}><line x1={l} x2={w - r} y1={t + index * (h - t - b) / 4} y2={t + index * (h - t - b) / 4} stroke="#24364e" strokeWidth=".6" />
      {!hideY && <text x={l - 10} y={t + index * (h - t - b) / 4 + 3} textAnchor="end">{axisTick(yDomain[1] - index / 4 * (yDomain[1] - yDomain[0]), (yDomain[1] - yDomain[0]) / 4)}</text>}</g>)}
    <text x={w - r} y={h - 5} textAnchor="end">{xLabel}</text><text x={l} y="13">{yLabel}</text>
  </g>;
}
function plotScales(xDomain: [number, number], yDomain: [number, number]) {
  return { x: (value: number) => PLOT.left + (value - xDomain[0]) / Math.max(Number.EPSILON, xDomain[1] - xDomain[0]) * (PLOT.width - PLOT.left - PLOT.right),
    y: (value: number) => PLOT.height - PLOT.bottom - (value - yDomain[0]) / Math.max(Number.EPSILON, yDomain[1] - yDomain[0]) * (PLOT.height - PLOT.top - PLOT.bottom) };
}
export function ScopePlot({ samples, channels, selected, sampleRate, yDomain, cursors, onCursor, onPan, onZoom, mode, svgRef, stacked }: {
  samples: readonly SignalSample[]; channels: Channel[]; selected: number[]; sampleRate: number; yDomain: [number, number];
  cursors: [number | null, number | null]; onCursor(index: number): void; onPan(amount: number): void; onZoom(amount: number): void;
  stacked: boolean; mode: "pan" | "a" | "b"; svgRef: RefObject<SVGSVGElement | null>;
}) {
  const height = stacked ? Math.max(PLOT.height, selected.length * 100 + PLOT.top + PLOT.bottom) : PLOT.height;
  const first = samples[0]?.index ?? 0, last = samples.at(-1)?.index ?? 1;
  const xDomain: [number, number] = [first / sampleRate, (last === first ? first + 1 : last) / sampleRate];
  const scale = plotScales(xDomain, yDomain), drag = useRef<number | null>(null);
  useEffect(() => {
    const node = svgRef.current; if (!node) return;
    const wheel = (event: WheelEvent) => { if (event.ctrlKey) { event.preventDefault(); onZoom(event.deltaY < 0 ? .7 : 1.4); } };
    node.addEventListener("wheel", wheel, { passive: false }); return () => node.removeEventListener("wheel", wheel);
  }, [svgRef, onZoom]);
  return <svg ref={svgRef} className={`signal-scope interaction-${mode}`} viewBox={`0 0 ${PLOT.width} ${height}`} role="img" aria-label="多通道示波图" tabIndex={0}
    onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); onPan(event.key === "ArrowLeft" ? -.2 : .2); }
      if (event.key === "+" || event.key === "=") onZoom(.5); if (event.key === "-") onZoom(2); }}
    onPointerDown={event => { if (!samples.length) return; event.currentTarget.setPointerCapture(event.pointerId);
      const rect = event.currentTarget.getBoundingClientRect(); const fraction = (event.clientX - rect.left) / rect.width;
      if (mode === "pan") drag.current = fraction;
      else onCursor(Math.round(first + Math.max(0, Math.min(1, (fraction * PLOT.width - PLOT.left) / (PLOT.width - PLOT.left - PLOT.right))) * (last - first)));
    }} onPointerUp={event => { if (drag.current !== null) { const rect = event.currentTarget.getBoundingClientRect(); onPan(drag.current - (event.clientX - rect.left) / rect.width); drag.current = null; } }}
    onPointerCancel={() => { drag.current = null; }}>
    <PlotGrid xDomain={xDomain} yDomain={yDomain} height={height} hideY={stacked} yLabel={stacked ? "分轨 · 各通道独立量程" : "幅值"} />
    <defs><clipPath id="scope-clip"><rect x={PLOT.left} y={PLOT.top} width={PLOT.width - PLOT.left - PLOT.right} height={height - PLOT.top - PLOT.bottom} /></clipPath></defs>
    <g clipPath="url(#scope-clip)">{selected.map((channel, band) => {
      const points = scopePoints(samples, channel, channels[channel]!, sampleRate);
      const domain = extent(points.map(point => point.y));
      const bandHeight = (height - PLOT.top - PLOT.bottom) / Math.max(1, selected.length);
      const bandTop = PLOT.top + band * bandHeight;
      const y = stacked ? (value: number) => bandTop + 15 + (1 - (value - domain[0]) / (domain[1] - domain[0])) * (bandHeight - 30) : scale.y;
      return <g key={channel}>{stacked && <><line x1={PLOT.left} x2={PLOT.width - PLOT.right} y1={bandTop + bandHeight} y2={bandTop + bandHeight} stroke="#283d5b" />
        <text x={PLOT.left + 6} y={bandTop + 12} fill={channels[channel]!.color} fontSize="10">{channels[channel]!.name} {channels[channel]!.unit} · {formatNumber(domain[0])} … {formatNumber(domain[1])}</text></>}
        <path data-channel={channel} d={plotPath(points, scale.x, y)} fill="none" stroke={channels[channel]!.color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" /></g>;
    })}
    {cursors.map((index, cursor) => index !== null && index >= first && index <= last && <g key={cursor}><line x1={scale.x(index / sampleRate)} x2={scale.x(index / sampleRate)} y1={PLOT.top} y2={height - PLOT.bottom} stroke={cursor ? "#fbbf24" : "#e2e8f0"} strokeDasharray="4 4" />
      <text x={scale.x(index / sampleRate) + 5} y={PLOT.top + 12} fontSize="12" fill={cursor ? "#fbbf24" : "#e2e8f0"}>{cursor ? "B" : "A"}</text></g>)}</g>
    {!samples.length && <text x="500" y="155" textAnchor="middle" fill="#7691b6" fontSize="13">选择 FireWater / JustFloat 并接收数据，或导入 CSV</text>}
  </svg>;
}
export function SpectrumPlot({ result, logarithmic, unit, maxFrequency = 0 }: { maxFrequency?: number; result: Spectrum | null; logarithmic: boolean; unit: string }) {
  const yDomain: [number, number] = logarithmic ? [-120, Math.max(0, ...result?.db ?? []) + 6] : [0, Math.max(.01, ...result?.amplitudes ?? []) * 1.12];
  const nyquist = result?.frequencies.at(-1) || 1;
  const xDomain: [number, number] = [0, maxFrequency > 0 ? Math.min(maxFrequency, nyquist) : nyquist], scale = plotScales(xDomain, yDomain);
  return <svg className="signal-spectrum" viewBox={`0 0 ${PLOT.width} ${PLOT.height}`} role="img" aria-label="FFT 单边幅度谱">
    <PlotGrid xDomain={xDomain} yDomain={yDomain} xLabel="频率 / Hz" yLabel={logarithmic ? `dB re 1 ${unit || "unit"}` : `幅值 ${unit}`} />
    <defs><clipPath id="spectrum-clip"><rect x={PLOT.left} y={PLOT.top} width={PLOT.width - PLOT.left - PLOT.right} height={PLOT.height - PLOT.top - PLOT.bottom} /></clipPath></defs>
    {result && <g clipPath="url(#spectrum-clip)"><path d={plotPath(result.frequencies.map((x, index) => ({ x, y: logarithmic ? result.db[index]! : result.amplitudes[index]! })), scale.x, scale.y)} fill="none" stroke="#a78bfa" strokeWidth="1.6" vectorEffect="non-scaling-stroke" /></g>}
  </svg>;
}
export function XYPlot({ samples, channels, xChannel, yChannel }: { samples: readonly SignalSample[]; channels: Channel[]; xChannel: number; yChannel: number }) {
  const points = samples.map(sample => ({ x: calibrated(sample, xChannel, channels[xChannel]!), y: calibrated(sample, yChannel, channels[yChannel]!) }));
  const xDomain = extent(points.map(point => point.x)), yDomain = extent(points.map(point => point.y));
  const scale = plotScales(xDomain, yDomain);
  const stride = Math.max(1, Math.ceil(points.length / 2000));
  // Keep gap sentinels when reducing XY data too.
  const reduced = points.filter((point, index) => index % stride === 0 || !Number.isFinite(point.x) || !Number.isFinite(point.y) || index === points.length - 1);
  return <svg viewBox={`0 0 ${PLOT.width} ${PLOT.height}`} role="img" aria-label="XY 轨迹图"><PlotGrid xDomain={xDomain} yDomain={yDomain} xLabel={`${channels[xChannel]!.name} ${channels[xChannel]!.unit}`} yLabel={`${channels[yChannel]!.name} ${channels[yChannel]!.unit}`} />
    <path d={plotPath(reduced, scale.x, scale.y)} fill="none" stroke="#34d399" strokeWidth="1.5" />
    {!!points.length && Number.isFinite(points.at(-1)!.x) && Number.isFinite(points.at(-1)!.y) && <circle cx={scale.x(points.at(-1)!.x)} cy={scale.y(points.at(-1)!.y)} r="4" fill="#d1fae5" />}</svg>;
}
export function HistogramPlot({ values }: { values: number[] }) {
  const result = histogram(values), maximum = Math.max(1, ...result.counts);
  return <svg viewBox="0 0 600 180" role="img" aria-label="采样值直方图"><rect width="600" height="180" rx="8" fill="#0e1b2e" />
    {result.counts.map((count, index) => <rect key={index} x={35 + index * 22} y={145 - count / maximum * 120} width="18" height={count / maximum * 120} rx="2" fill="#38bdf8" opacity=".75" />)}
    <text x="35" y="165" fill="#8096b6" fontSize="11">{formatNumber(result.min)}</text><text x="560" y="165" textAnchor="end" fill="#8096b6" fontSize="11">{formatNumber(result.max)}</text>
  </svg>;
}
export function Waterfall({ rows }: { rows: readonly number[][] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext("2d"); if (!context) return;
    const image = context.createImageData(256, 64);
    for (let row = 0; row < 64; row++) for (let column = 0; column < 256; column++) {
      const values = rows[row];
      const level = values ? Math.max(0, Math.min(1, (values[Math.floor(column / 256 * values.length)]! + 100) / 100)) : 0;
      const r = Math.round(20 + 230 * Math.pow(level, 2)), g = Math.round(30 + 180 * Math.pow(level, 1.5)), b = Math.round(50 + 160 * Math.sin(level * Math.PI));
      image.data.set([r, g, b, 255], (row * 256 + column) * 4);
    }
    context.putImageData(image, 0, 0);
  }, [rows]);
  return <canvas ref={canvas} width={256} height={64} className="waterfall-canvas" aria-label="频谱瀑布图，最新窗口在顶部" role="img" />;
}
export function FrameViewer({ frame }: { frame: ImageFrame | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [held, setHeld] = useState<ImageFrame | null>(null);
  const [fit, setFit] = useState(true);
  const shown = held ?? frame;
  useEffect(() => { if (!frame) setHeld(null); }, [frame]);
  useEffect(() => { if (shown) canvas.current?.getContext("2d")?.putImageData(new ImageData(imageRgba(shown), shown.width, shown.height), 0, 0); }, [shown]);
  return <><div className="image-viewer-tools"><button type="button" className="ghost" disabled={!frame} onClick={() => setHeld(held ? null : frame)}>{held ? "恢复图像流" : "冻结图像"}</button>
    <button type="button" className="ghost" disabled={!shown} onClick={() => canvas.current?.toBlob(blob => { if (blob) downloadBlob(`serialhub-frame-${Date.now()}.png`, blob); }, "image/png")}>保存图像 PNG</button><label className="check"><input type="checkbox" checked={fit} onChange={event => setFit(event.target.checked)} />适应画布</label><span>{held ? `冻结第 ${held.count} 帧` : "显示最新完整帧"}</span></div>
    <div className="image-frame-viewer">{shown ? <canvas className={fit ? "fit" : ""} ref={canvas} width={shown.width} height={shown.height} aria-label="收到的原始图像帧" role="img" /> : <div className="image-empty">等待完整图像帧<br /><small>GRAY8 / RGB565 LE / RGB888</small></div>}</div></>;
}
