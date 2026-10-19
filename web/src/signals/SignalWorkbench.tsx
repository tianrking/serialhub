import { useEffect, useMemo, useRef, useState } from "react";
import type { StreamProtocol } from "../protocolUtils";
import type { QuickCommand } from "../commandUtils";
import { downloadBlob } from "../serialTools";
import { SignalStore, type BinaryType, type ImageConfig } from "./store";
import { calibrated, channelExtent, findTrigger, formatNumber, spectrum, statistics, type Channel, type SignalSample } from "./math";
import { exportCsv, exportSvgPng, importCsv, loadSignalSettings, SIGNAL_SETTINGS_KEY, validateSettings } from "./files";
import { FrameViewer, HistogramPlot, ScopePlot, SpectrumPlot, Waterfall, XYPlot } from "./Plots";
import { Attitude, ControlDeck, MeterCards } from "./Instruments";

import { useSignalSnapshot } from "./useSignalSnapshot";
type Props = { isMock?: boolean; visible: boolean; store: SignalStore; protocol: StreamProtocol; onProtocol(protocol: StreamProtocol): void;
  canWrite: boolean; busy: boolean; commands: QuickCommand[]; onQuick(command: QuickCommand): Promise<boolean>; onValue(payload: string): Promise<boolean> };
export default function SignalWorkbench({ isMock = false, visible, store, protocol, onProtocol, canWrite, busy, commands, onQuick, onValue }: Props) {
  const snapshot = useSignalSnapshot(store, visible);
  const [settings, setSettings] = useState(loadSignalSettings);
  const [message, setMessage] = useState("");
  const [frozen, setFrozen] = useState<readonly SignalSample[] | null>(null);
  const [span, setSpan] = useState(1024), [offset, setOffset] = useState(0);
  const [channel, setChannel] = useState(0), [xChannel, setXChannel] = useState(0), [yChannel, setYChannel] = useState(1);
  const [stacked, setStacked] = useState(false);
  const [autoY, setAutoY] = useState(true), [manualY, setManualY] = useState<[number, number]>([-1, 1]);
  const [cursorMode, setCursorMode] = useState<"pan" | "a" | "b">("pan"), [cursors, setCursors] = useState<[number | null, number | null]>([null, null]);
  const [frequencyLimit, setFrequencyLimit] = useState(0);
  const [logarithmic, setLogarithmic] = useState(true), [removeDC, setRemoveDC] = useState(true);
  const [triggerLevel, setTriggerLevel] = useState(0), [triggerRising, setTriggerRising] = useState(true), [triggerStatus, setTriggerStatus] = useState("");
  const trigger = useRef<{ after: number; pending: number | null; generation: number } | null>(null);
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!canWrite && armed) { trigger.current = null; setArmed(false); setTriggerStatus("设备或会话已离线，触发已取消"); } }, [canWrite, armed]);
  const [waterfall, setWaterfall] = useState<number[][]>([]), lastSpectrum = useRef(-1);
  const [replayPosition, setReplayPosition] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1);
  const [frameDraft, setFrameDraft] = useState({ binary: settings.binary, image: settings.image });
  const svg = useRef<SVGSVGElement>(null), root = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const count = snapshot.channels || 4;
  useEffect(() => { setChannel(previous => Math.min(previous, count - 1)); setXChannel(previous => Math.min(previous, count - 1)); setYChannel(previous => Math.min(previous, count - 1)); }, [count]);
  const calibrationKey = `${settings.channels[channel]!.gain}/${settings.channels[channel]!.offset}/${settings.channels[channel]!.unit}`;
  useEffect(() => {
    if (trigger.current) { trigger.current = null; setArmed(false); setTriggerStatus("触发参数已改变，请重新等待触发"); }
  }, [channel, triggerLevel, triggerRising, span, calibrationKey]);
  const report = (error: unknown) => setMessage(error instanceof Error ? error.message : String(error));
  useEffect(() => { try { localStorage.setItem(SIGNAL_SETTINGS_KEY, JSON.stringify(validateSettings(settings))); } catch { /* Browser storage may be unavailable. */ } }, [settings]);
  useEffect(() => { store.configure(settings.binary, settings.image); }, [store, settings.binary, settings.image]);
  useEffect(() => {
    setFrozen(null); setOffset(0); setCursors([null, null]); setWaterfall([]); lastSpectrum.current = -1; setPlaying(false);
    setReplayPosition(snapshot.samples.length); trigger.current = null; setArmed(false); setTriggerStatus("");
    // Reset interactions on a source/connection generation, not on each sample.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.generation]);
  useEffect(() => { const update = () => setFullscreen(document.fullscreenElement === root.current); document.addEventListener("fullscreenchange", update); return () => document.removeEventListener("fullscreenchange", update); }, []);
  useEffect(() => {
    if (!playing || snapshot.source !== "replay" || !visible) return;
    let last = performance.now(), remainder = 0;
    const timer = setInterval(() => {
      const now = performance.now(), advance = (now - last) / 1000 * settings.sampleRate * speed + remainder;
      last = now; remainder = advance % 1;
      setReplayPosition(previous => {
        const next = Math.min(snapshot.samples.length, previous + Math.floor(advance));
        if (next >= snapshot.samples.length) setPlaying(false);
        return next;
      });
    }, 50);
    return () => clearInterval(timer);
  }, [playing, snapshot.source, snapshot.samples.length, settings.sampleRate, speed, visible]);
  useEffect(() => {
    if (!armed || !trigger.current || trigger.current.generation !== snapshot.generation) return;
    const active = trigger.current;
    if (active.pending === null) {
      active.pending = findTrigger(snapshot.samples, channel, triggerLevel, triggerRising, active.after, settings.channels[channel]!);
      active.after = snapshot.samples.at(-1)?.index ?? active.after;
      if (active.pending !== null) setTriggerStatus("已触发，等待后半窗");
    }
    if (active.pending !== null && (snapshot.samples.at(-1)?.index ?? -1) >= active.pending + Math.floor(span / 2)) {
      const captured = snapshot.samples.filter(sample => sample.index >= active.pending! - Math.floor(span / 2) && sample.index < active.pending! + Math.ceil(span / 2));
      if (!captured.some(sample => sample.index === active.pending)) {
        setArmed(false); trigger.current = null; setTriggerStatus("触发数据已被缓存覆盖，请重新等待触发"); return;
      }
      setFrozen(captured); setOffset(0); setCursors([active.pending, null]); setCursorMode("a"); setArmed(false); trigger.current = null; setTriggerStatus(`已捕获 ${captured.length} 点 · 触发点 #${active.pending}${captured.length < span ? " · 前触发数据不足" : ""}`);
    }
  }, [snapshot, armed, channel, triggerLevel, triggerRising, span, settings.channels]);

  const available = useMemo(() => frozen ?? (snapshot.source === "replay" ? snapshot.samples.slice(0, replayPosition) : snapshot.samples), [frozen, snapshot.source, snapshot.samples, replayPosition]);
  const clampedOffset = Math.min(offset, Math.max(0, available.length - span));
  const start = Math.max(0, available.length - span - clampedOffset);
  const samples = useMemo(() => available.slice(start, start + span), [available, start, span]);
  const visibleCount = settings.channels.filter(config => config.visible).length;
  const selected = useMemo(() => settings.channels.flatMap((config, index) => config.visible && index < count ? [index] : []).slice(0, 16), [settings.channels, count]);
  const values = useMemo(() => samples.map(sample => calibrated(sample, channel, settings.channels[channel]!)), [samples, channel, settings.channels]);
  const stats = useMemo(() => statistics(values), [values]);
  const yDomain = useMemo(() => autoY ? channelExtent(samples, selected, settings.channels) : manualY,
    [autoY, selected, samples, settings.channels, manualY]);
  const fftSamples = useMemo(() => { const end = Math.min(available.length, start + span); return available.slice(Math.max(0, end - settings.fftSize), end); }, [available, start, span, settings.fftSize]);
  const fft = useMemo(() => {
    if (!visible || settings.layout === "instruments" || (protocol === "image" && snapshot.source === "live")) return { result: null, error: "" };
    try { return { result: spectrum(fftSamples, channel, settings.channels[channel]!, settings.sampleRate, settings.fftSize, settings.window, removeDC), error: "" }; }
    catch (error) { return { result: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [visible, fftSamples, channel, settings.sampleRate, settings.fftSize, settings.window, settings.channels, settings.layout, removeDC, protocol, snapshot.source]);
  useEffect(() => { setWaterfall([]); lastSpectrum.current = -1; }, [settings.sampleRate, settings.fftSize, settings.window, channel, removeDC, calibrationKey]);
  useEffect(() => {
    const last = samples.at(-1)?.index ?? -1;
    if (!fft.result || !visible || !["analysis", "full"].includes(settings.layout) || last - lastSpectrum.current < Math.max(1, settings.fftSize / 4)) return;
    lastSpectrum.current = last;
    setWaterfall(previous => [fft.result!.db, ...previous].slice(0, 64));
  }, [fft.result, samples, visible, settings.layout, settings.fftSize]);
  const freeze = () => { setFrozen([...available]); setPlaying(false); };
  const follow = () => { setFrozen(null); setOffset(0); setArmed(false); trigger.current = null; setTriggerStatus(""); };
  const zoom = (amount: number) => { if (!frozen) freeze(); setSpan(previous => Math.min(16384, Math.max(32, Math.round(previous * amount)))); };
  const pan = (amount: number) => { if (!frozen) freeze(); setOffset(previous => Math.max(0, Math.min(available.length - span, previous - Math.round(amount * span)))); };
  const configureChannel = (index: number, patch: Partial<Channel>) => setSettings(previous => ({ ...previous, channels: previous.channels.map((item, position) => position === index ? { ...item, ...patch } : item) }));
  const setNumericChannel = (index: number, field: "gain" | "offset" | "min" | "max", value: number) => {
    if (!Number.isFinite(value)) return;
    const config = settings.channels[index]!;
    configureChannel(index, { [field]: value, ...(field === "min" && value >= config.max ? { max: value + 1 } : {}), ...(field === "max" && value <= config.min ? { min: value - 1 } : {}) });
  };
  const channelOptions = Array.from({ length: count }, (_, index) => <option key={index} value={index}>{settings.channels[index]!.name}</option>);
  const cursorA = samples.find(sample => sample.index === cursors[0]), cursorB = samples.find(sample => sample.index === cursors[1]);
  const delta = cursors.every(value => value !== null) ? Math.abs(cursors[1]! - cursors[0]!) / settings.sampleRate : NaN;
  const exportData = (all: boolean) => downloadBlob(`serialhub-signals-${Date.now()}.csv`, new Blob([exportCsv(all ? snapshot.samples : samples, settings.channels, settings.sampleRate)], { type: "text/csv;charset=utf-8" }));

  if (!visible) return null;
  return <section className="signal-workbench" ref={root} aria-label="信号仪表工作区">
    <div className="signal-topbar"><div className="signal-workspace-title"><span className="signal-logo">∿</span><div><span className="eyebrow">SIGNAL STUDIO</span><h2>让每一个信号清晰可见<span>.</span></h2></div></div>
      <div className="signal-top-actions"><select aria-label="仪表布局" value={settings.layout} onChange={event => setSettings(previous => ({ ...previous, layout: event.target.value as typeof previous.layout }))}><option value="analysis">分析工作台</option><option value="instruments">仪表与控制</option><option value="full">全部仪表</option></select>
        <button type="button" className="ghost" onClick={async () => { try { if (fullscreen) await document.exitFullscreen(); else await root.current?.requestFullscreen(); } catch (error) { report(error); } }}>{fullscreen ? "退出全屏" : "全屏查看"}</button></div></div>
    <section className="signal-source-bar"><label>解析协议<select aria-label="信号解析协议" value={protocol} onChange={event => onProtocol(event.target.value as StreamProtocol)}><option value="raw">未启用 · RawData</option><option value="firewater">FireWater CSV</option><option value="justfloat">JustFloat LE</option><option value="binary">自定义数值帧</option><option value="image">原始图像帧</option>{!["raw", "firewater", "justfloat", "binary", "image"].includes(protocol) && <option value={protocol}>{protocol}</option>}</select></label>
      <label>设备采样率 (Hz)<input aria-label="设备采样率" type="number" min={.001} max={1e9} value={settings.sampleRate} onChange={event => { const rate = Number(event.target.value); if (rate > 0 && rate <= 1e9) setSettings(previous => ({ ...previous, sampleRate: rate })); }} /></label>
      <div className={`source-pill ${snapshot.source === "replay" ? "replay" : snapshot.connected && canWrite ? "live" : "offline"}`}><span />{snapshot.source === "replay" ? "CSV 离线回放" : snapshot.connected && canWrite ? (isMock ? "MOCK · 模拟设备实时流" : "LIVE · 设备实时流") : "等待设备连接"}</div>
      <div className="signal-import-actions"><label className="signal-file-button">导入 CSV<input type="file" accept=".csv,text/csv" aria-label="导入信号 CSV" onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
        try { if (file.size > 8 * 1024 * 1024) throw new Error("CSV 不能超过 8 MiB"); const imported = importCsv(await file.text());
          setSettings(previous => ({ ...previous, sampleRate: imported.sampleRate ?? previous.sampleRate, channels: previous.channels.map((config, index) => imported.names[index] ? { ...config, name: imported.names[index]!.slice(0, 32) } : config) }));
          store.replay(imported.samples); setMessage(`已导入 ${imported.samples.length.toLocaleString()} 个采样点；${imported.sampleRate ? "使用文件中的采样率" : "请确认设备采样率"}。`);
        } catch (error) { report(error); }
      }} /></label><button type="button" className="ghost" disabled={!snapshot.samples.length} onClick={() => exportData(true)}>导出缓存 CSV</button></div>
    </section>
    <div className="signal-acquisition-stats"><span><b>{snapshot.samples.length.toLocaleString()}</b> 缓存点 / 16,384</span><span><b>{snapshot.channels}</b> 通道</span><span>接收 <b>{snapshot.total.toLocaleString()}</b> 帧</span><span className={snapshot.invalid ? "warn" : ""}>异常 <b>{snapshot.invalid}</b></span><span>覆盖 <b>{snapshot.evicted.toLocaleString()}</b> 点</span><span>{snapshot.reason}</span><button type="button" className="ghost small" onClick={() => store.clear()}>清空信号缓存</button></div>
    <p className="signal-timing-note">时间轴与频率根据你设置的设备采样率计算。浏览器接收时间仅用于记录，不代表硬件采样时间。</p>
    {message && <div className="signal-notice" role="status"><span>{message}</span><button type="button" aria-label="关闭仪表提示" onClick={() => setMessage("")}>×</button></div>}
    {snapshot.source === "replay" && <div className="signal-replay-bar"><button type="button" onClick={() => { setFrozen(null); if (replayPosition >= snapshot.samples.length) setReplayPosition(0); setPlaying(value => !value); }}>{playing ? "暂停回放" : "播放回放"}</button><button type="button" className="ghost" onClick={() => { setPlaying(false); setFrozen(null); setReplayPosition(previous => Math.min(snapshot.samples.length, previous + 1)); }}>单步</button>
      <input aria-label="回放位置" type="range" min={0} max={snapshot.samples.length} value={replayPosition} onChange={event => { setFrozen(null); setPlaying(false); setReplayPosition(Number(event.target.value)); }} /><code>{replayPosition} / {snapshot.samples.length}</code><select aria-label="回放速度" value={speed} onChange={event => setSpeed(Number(event.target.value))}>{[.25, 1, 2, 5, 10].map(value => <option key={value} value={value}>{value}×</option>)}</select><button type="button" className="ghost" onClick={() => store.live()}>返回实时采集</button></div>}

    <details className="signal-configuration"><summary>通道与数据帧配置 <span>名称 · 单位 · 颜色 · 换算 · 仪表量程 · 配置迁移</span></summary>
      <div className="signal-settings-actions"><button type="button" className="ghost" onClick={() => setSettings(previous => ({ ...previous, channels: previous.channels.map((config, index) => ({ ...config, visible: index < Math.min(4, count) })) }))}>重置曲线选择</button><button type="button" className="ghost" onClick={() => downloadBlob(`serialhub-instruments-${Date.now()}.json`, new Blob([JSON.stringify({ format: "serialhub-signals", version: 1, settings }, null, 2)], { type: "application/json" }))}>导出仪表配置</button>
        <label className="signal-file-button">导入仪表配置<input type="file" accept=".json,application/json" aria-label="导入仪表配置" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
          try { if (file.size > 128 * 1024) throw new Error("仪表配置不能超过 128 KiB"); const data = JSON.parse(await file.text()); if (data.format !== "serialhub-signals" || data.version !== 1) throw new Error("仪表配置版本无效"); const next = validateSettings(data.settings); setSettings(next); setFrameDraft({ binary: next.binary, image: next.image }); setMessage("仪表配置已应用，不会发送设备命令"); } catch (error) { report(error); } }} /></label></div>
      <div className="signal-channel-config">{Array.from({ length: count }, (_, index) => { const config = settings.channels[index]!; return <div className="signal-channel-row" key={index}>
        <label className="check"><input type="checkbox" aria-label={`显示 CH${index}`} checked={config.visible} onChange={event => { if (event.target.checked && visibleCount >= 16) { setMessage("同屏最多 16 条曲线，请先隐藏部分通道"); return; } configureChannel(index, { visible: event.target.checked }); }} /><b>CH{index}</b></label>
        <input type="color" aria-label={`CH${index} 颜色`} value={config.color} onChange={event => configureChannel(index, { color: event.target.value })} />
        <label>名称<input aria-label={`CH${index} 名称`} maxLength={32} value={config.name} onChange={event => configureChannel(index, { name: event.target.value || `CH${index}` })} /></label>
        <label>单位<input aria-label={`CH${index} 单位`} maxLength={16} value={config.unit} onChange={event => configureChannel(index, { unit: event.target.value })} /></label>
        {([['gain', '增益'], ['offset', '偏移'], ['min', '量程下限'], ['max', '量程上限']] as const).map(([key, title]) => <label key={key}>{title}<input aria-label={`CH${index} ${title}`} type="number" step="any" value={config[key]} onChange={event => setNumericChannel(index, key, Number(event.target.value))} /></label>)}
      </div>; })}</div><p className="signal-note">显示值 = 原始值 × 增益 + 偏移；CSV 导出始终保留原始值。最多 64 通道，同屏 16 条曲线。</p>
      <div className="signal-frame-settings"><fieldset><legend>自定义数值帧</legend><div className="row"><label>数据类型<select aria-label="数值帧类型" value={frameDraft.binary.type} onChange={event => setFrameDraft(previous => ({ ...previous, binary: { ...previous.binary, type: event.target.value as BinaryType } }))}>{["float32", "float64", "int16", "uint16", "int32", "uint32", "int8", "uint8"].map(type => <option key={type}>{type}</option>)}</select></label>
        <label>通道数<input aria-label="数值帧通道数" type="number" min={1} max={64} value={frameDraft.binary.channels} onChange={event => setFrameDraft(previous => ({ ...previous, binary: { ...previous.binary, channels: Number(event.target.value) } }))} /></label>
        <label>字节序<select aria-label="数值帧字节序" value={String(frameDraft.binary.littleEndian)} onChange={event => setFrameDraft(previous => ({ ...previous, binary: { ...previous.binary, littleEndian: event.target.value === "true" } }))}><option value="true">Little Endian</option><option value="false">Big Endian</option></select></label>
        <label>帧头 Hex<input aria-label="数值帧帧头" maxLength={47} placeholder="例如 AA 55，可留空" value={frameDraft.binary.header} onChange={event => setFrameDraft(previous => ({ ...previous, binary: { ...previous.binary, header: event.target.value } }))} /></label></div></fieldset>
        <fieldset><legend>原始图像帧</legend><div className="row">{([['width', '宽'], ['height', '高']] as const).map(([key, title]) => <label key={key}>{title}<input aria-label={`图像${title}`} type="number" min={1} max={512} value={frameDraft.image[key]} onChange={event => setFrameDraft(previous => ({ ...previous, image: { ...previous.image, [key]: Number(event.target.value) } }))} /></label>)}
          <label>像素格式<select aria-label="图像像素格式" value={frameDraft.image.format} onChange={event => setFrameDraft(previous => ({ ...previous, image: { ...previous.image, format: event.target.value as ImageConfig["format"] } }))}><option value="gray8">GRAY8</option><option value="rgb565le">RGB565 LE</option><option value="rgb888">RGB888</option></select></label><label>帧头 Hex<input aria-label="图像帧头" maxLength={47} value={frameDraft.image.header} onChange={event => setFrameDraft(previous => ({ ...previous, image: { ...previous.image, header: event.target.value } }))} /></label></div></fieldset></div>
      <button type="button" className="ghost" onClick={() => { try { const next = validateSettings({ ...settings, ...frameDraft }); setSettings(next); setMessage("帧配置已应用，采样缓存已重置"); } catch (error) { report(error); } }}>应用帧配置</button><p className="signal-note">固定长度原始帧，不带转义、校验或压缩。空帧头从首字节对齐，丢字节后须清空重同步；有帧头时，发送方须保证它不会出现在载荷中。</p>
    </details>

    {protocol === "image" && snapshot.source === "live" ? <article className="signal-card image-card"><div className="instrument-heading"><div><span className="eyebrow">FRAME VIEWER</span><h3>图像数据流</h3></div><span className="signal-tag">{snapshot.image ? `${snapshot.image.width} × ${snapshot.image.height} · ${snapshot.image.format} · ${snapshot.image.count} 帧` : "等待完整帧"}</span></div><FrameViewer frame={snapshot.image} /><p className="signal-note">原始固定长度像素帧；不会把普通串口文字当作图片协议自动识别。</p></article> : <>
      <article className="signal-card scope-card"><div className="instrument-heading"><div><span className="eyebrow">MULTICHANNEL OSCILLOSCOPE</span><h3>多通道示波</h3></div><div className="scope-status"><span className={`signal-tag ${frozen ? "frozen" : ""}`}>{frozen ? "已冻结" : snapshot.source === "replay" ? "REPLAY" : snapshot.connected && canWrite ? "LIVE" : "离线缓存"}</span><code>{samples.length.toLocaleString()} points</code></div></div>
        <div className="scope-toolbar"><div className="signal-segmented"><button type="button" className={!frozen ? "active" : ""} onClick={follow}>跟随最新</button><button type="button" className={frozen ? "active" : ""} disabled={!available.length} onClick={freeze}>冻结画面</button></div><button type="button" className="ghost" aria-label="放大波形" onClick={() => zoom(.5)}>＋</button><button type="button" className="ghost" aria-label="缩小波形" onClick={() => zoom(2)}>−</button>
          <label>窗口<select aria-label="波形窗口点数" value={span} onChange={event => { setSpan(Number(event.target.value)); setOffset(0); }}>{[...new Set([32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, span])].sort((a, b) => a - b).map(value => <option key={value} value={value}>{value.toLocaleString()} 点</option>)}</select></label>
          <label className="check"><input aria-label="分轨显示" type="checkbox" checked={stacked} onChange={event => setStacked(event.target.checked)} />分轨</label>
          <label className="check"><input type="checkbox" disabled={stacked} checked={autoY} onChange={event => setAutoY(event.target.checked)} />自动 Y</label>{!autoY && <><input aria-label="Y 轴下限" type="number" step="any" value={manualY[0]} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value < manualY[1]) setManualY([value, manualY[1]]); }} /><input aria-label="Y 轴上限" type="number" step="any" value={manualY[1]} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value > manualY[0]) setManualY([manualY[0], value]); }} /></>}
          <select aria-label="波形交互模式" value={cursorMode} onChange={event => setCursorMode(event.target.value as typeof cursorMode)}><option value="pan">拖动平移</option><option value="a">放置游标 A</option><option value="b">放置游标 B</option></select><button type="button" className="ghost" disabled={!samples.length} onClick={() => exportData(false)}>窗口 CSV</button><button type="button" className="ghost" disabled={!samples.length} onClick={() => { if (svg.current) void exportSvgPng(svg.current, `serialhub-waveform-${Date.now()}.png`).catch(report); }}>导出波形 PNG</button>
        </div>
        <div className="signal-legends">{Array.from({ length: count }, (_, index) => <button type="button" key={index} className={selected.includes(index) ? "selected" : ""} style={{ "--channel-color": settings.channels[index]!.color } as React.CSSProperties} onClick={() => {
          const config = settings.channels[index]!; if (!config.visible && visibleCount >= 16) { setMessage("同屏最多 16 条曲线"); return; } configureChannel(index, { visible: !config.visible });
        }}><span />{settings.channels[index]!.name}<b>{formatNumber(available.at(-1) ? calibrated(available.at(-1)!, index, settings.channels[index]!) : NaN)}</b></button>)}</div>
        <ScopePlot samples={samples} channels={settings.channels} selected={selected} sampleRate={settings.sampleRate} yDomain={yDomain} stacked={stacked} cursors={cursors} mode={cursorMode} svgRef={svg}
          onCursor={index => { if (!frozen) freeze(); setCursors(previous => cursorMode === "a" ? [index, previous[1]] : [previous[0], index]); }} onPan={pan} onZoom={zoom} />
        <div className="scope-bottom"><span>#{samples[0]?.index ?? "—"} → #{samples.at(-1)?.index ?? "—"} · 缩放保留峰值 · Ctrl + 滚轮</span><label>历史位置<input aria-label="波形历史位置" type="range" min={0} max={Math.max(0, available.length - span)} value={clampedOffset} onChange={event => { if (!frozen) freeze(); setOffset(Number(event.target.value)); }} /></label></div>
        <div className="signal-analysis-strip"><label>分析通道<select aria-label="分析通道" disabled={armed} value={channel} onChange={event => setChannel(Number(event.target.value))}>{channelOptions}</select></label><span>MIN <b>{formatNumber(stats.min)}</b></span><span>MAX <b>{formatNumber(stats.max)}</b></span><span>MEAN <b>{formatNumber(stats.mean)}</b></span><span>RMS <b>{formatNumber(stats.rms)}</b></span><span>Vpp <b>{formatNumber(stats.peakToPeak)}</b></span><span>有效 <b>{stats.count}</b></span></div>
        <div className="signal-cursors"><span>A <b>{cursorA ? formatNumber(calibrated(cursorA, channel, settings.channels[channel]!)) : "—"}</b></span><span>B <b>{cursorB ? formatNumber(calibrated(cursorB, channel, settings.channels[channel]!)) : "—"}</b></span><span>ΔY <b>{cursorA && cursorB ? formatNumber(calibrated(cursorB, channel, settings.channels[channel]!) - calibrated(cursorA, channel, settings.channels[channel]!)) : "—"}</b></span><span>Δt <b>{formatNumber(delta)} s</b></span><span>1/Δt <b>{formatNumber(delta ? 1 / delta : NaN)} Hz</b></span><button type="button" className="ghost small" onClick={() => setCursors([null, null])}>清除游标</button></div>
        <div className="signal-trigger"><strong>单次触发</strong><span>使用分析通道</span><select aria-label="触发边沿" disabled={armed} value={String(triggerRising)} onChange={event => setTriggerRising(event.target.value === "true")}><option value="true">上升沿 ↑</option><option value="false">下降沿 ↓</option></select><label>电平<input aria-label="触发电平" type="number" step="any" value={triggerLevel} disabled={armed} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) setTriggerLevel(value); }} /></label>
          <button type="button" disabled={snapshot.source !== "live" || !snapshot.connected || !canWrite} onClick={() => { if (armed) { setArmed(false); trigger.current = null; setTriggerStatus("已取消"); } else { setFrozen(null); setOffset(0); trigger.current = { after: snapshot.samples.at(-1)?.index ?? -1, pending: null, generation: snapshot.generation }; setArmed(true); setTriggerStatus("等待新数据跨越触发电平"); } }}>{armed ? "取消触发" : "等待触发"}</button><span className={armed ? "trigger-armed" : ""}>{triggerStatus || "前后各半窗，捕获后自动冻结"}</span></div>
      </article>
      <MeterCards samples={samples} channels={settings.channels} selected={selected} />
      <div className="signal-instrument-grid">
      {settings.layout !== "instruments" && <><article className="signal-card spectrum-card"><div className="instrument-heading"><div><span className="eyebrow">FREQUENCY DOMAIN</span><h3>FFT 频谱</h3></div><span className="spectrum-peak" data-testid="spectrum-peak">{fft.result ? `${formatNumber(fft.result.peakFrequency)} Hz` : "— Hz"}<small>全谱主峰</small></span></div>
        <div className="spectrum-toolbar"><label>FFT 点数<select aria-label="FFT 点数" value={settings.fftSize} onChange={event => { const size = Number(event.target.value); setSettings(previous => ({ ...previous, fftSize: size }));  }}>{[256, 512, 1024, 2048, 4096].map(size => <option key={size}>{size}</option>)}</select></label><label>窗函数<select aria-label="FFT 窗函数" value={settings.window} onChange={event => setSettings(previous => ({ ...previous, window: event.target.value as typeof previous.window }))}><option value="hann">Hann</option><option value="rectangular">Rectangular</option></select></label><label className="check"><input type="checkbox" checked={logarithmic} onChange={event => setLogarithmic(event.target.checked)} />dB</label><label className="check"><input type="checkbox" checked={removeDC} onChange={event => setRemoveDC(event.target.checked)} />去直流</label></div>
        <label className="spectrum-frequency-limit">频率上限 Hz（0 = Nyquist）<input aria-label="频谱频率上限" type="number" min={0} max={settings.sampleRate / 2} value={frequencyLimit} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0) setFrequencyLimit(value); }} /></label>
        <SpectrumPlot result={fft.result} maxFrequency={frequencyLimit} logarithmic={logarithmic} unit={settings.channels[channel]!.unit} /><div className="spectrum-footer">{fft.error || `最近 ${settings.fftSize} 点 · Δf ${formatNumber(fft.result?.resolution)} Hz · 主峰幅值 ${formatNumber(fft.result?.peakAmplitude)} ${settings.channels[channel]!.unit} · 单边谱，窗增益已校正`}</div>
      </article><article className="signal-card xy-card"><div className="instrument-heading"><div><span className="eyebrow">PHASE PORTRAIT</span><h3>XY 轨迹</h3></div><span className="signal-tag">二维相图</span></div><div className="spectrum-toolbar"><label>X 轴<select aria-label="XY X 通道" value={xChannel} onChange={event => setXChannel(Number(event.target.value))}>{channelOptions}</select></label><label>Y 轴<select aria-label="XY Y 通道" value={yChannel} onChange={event => setYChannel(Number(event.target.value))}>{channelOptions}</select></label><span className="signal-note">同一采样帧，保留缺口</span></div><XYPlot samples={samples} channels={settings.channels} xChannel={xChannel} yChannel={yChannel} /></article>
      <article className="signal-card waterfall-card"><div className="instrument-heading"><div><span className="eyebrow">SPECTRAL HISTORY</span><h3>频谱瀑布</h3></div><span className="signal-tag">最近 {waterfall.length} / 64 窗</span></div><Waterfall rows={waterfall} /><div className="waterfall-legend"><span>0 Hz</span><span>−100 dB <i /> 0 dB</span><span>{formatNumber(settings.sampleRate / 2)} Hz</span></div><p className="signal-note">最新窗口在顶部；每隔 ¼ FFT 窗更新，固定色标 dB re 1 unit。</p></article>
      <article className="signal-card histogram-card"><div className="instrument-heading"><div><span className="eyebrow">DISTRIBUTION</span><h3>数值分布</h3></div><span className="signal-tag">{settings.channels[channel]!.name} · 24 BINS</span></div><HistogramPlot values={values} /><p className="signal-note">当前窗口有限值的分布，缺失值不计入。</p></article></>}
      {(settings.layout === "instruments" || settings.layout === "full") && <><Attitude latest={available.at(-1)} channels={settings.channels} count={count} /><ControlDeck config={settings.control} onConfig={control => setSettings(previous => ({ ...previous, control }))} commands={commands} canWrite={canWrite && snapshot.source === "live"} busy={busy} onQuick={onQuick} onValue={onValue} /></>}
      </div>
    </>}
    <details className="signal-data-table"><summary>原始数据表 <span>最近 50 点 · 原始数值与接收时间</span></summary><div className="signal-table-scroll"><table><thead><tr><th>采样 #</th><th>推算时间 (s)</th><th>接收时间 (ms)</th>{Array.from({ length: snapshot.channels }, (_, index) => <th key={index}>CH{index}</th>)}</tr></thead><tbody>{samples.slice(-50).map(sample => <tr key={sample.index}><td>{sample.index}</td><td>{formatNumber(sample.index / settings.sampleRate, 7)}</td><td>{sample.receivedAt || "—"}</td>{Array.from({ length: snapshot.channels }, (_, index) => <td key={index}>{formatNumber(sample.values[index], 7)}</td>)}</tr>)}</tbody></table></div></details>
  </section>;
}
