import { t, getFormattingLocale, localizeStatus } from "../i18n/index.ts";
import { useLocale } from "../i18n/useLocale";
import WorkspaceDialog from "../WorkspaceDialog";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  const analysisId = useId();
  const locale = useLocale();
  const snapshot = useSignalSnapshot(store, visible);
  const [settings, setSettings] = useState(loadSignalSettings);
  const [analysisPanel, setAnalysisPanel] = useState("fft");
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
  useEffect(() => { if (!canWrite && armed) { trigger.current = null; setArmed(false); setTriggerStatus(t("Device or session offline; trigger cancelled")); } }, [canWrite, armed]);
  const [waterfall, setWaterfall] = useState<number[][]>([]), lastSpectrum = useRef(-1);
  const [replayPosition, setReplayPosition] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1);
  const [frameDraft, setFrameDraft] = useState({ binary: settings.binary, image: settings.image });
  const svg = useRef<SVGSVGElement>(null), root = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const count = snapshot.channels || 4;
  useEffect(() => { setChannel(previous => Math.min(previous, count - 1)); setXChannel(previous => Math.min(previous, count - 1)); setYChannel(previous => Math.min(previous, count - 1)); }, [count]);
  const calibrationKey = `${settings.channels[channel]!.gain}/${settings.channels[channel]!.offset}/${settings.channels[channel]!.unit}`;
  useEffect(() => {
    if (trigger.current) { trigger.current = null; setArmed(false); setTriggerStatus(t("Trigger settings changed; arm the trigger again")); }
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
      if (active.pending !== null) setTriggerStatus(t("Triggered; waiting for the second half-window"));
    }
    if (active.pending !== null && (snapshot.samples.at(-1)?.index ?? -1) >= active.pending + Math.floor(span / 2)) {
      const captured = snapshot.samples.filter(sample => sample.index >= active.pending! - Math.floor(span / 2) && sample.index < active.pending! + Math.ceil(span / 2));
      if (!captured.some(sample => sample.index === active.pending)) {
        setArmed(false); trigger.current = null; setTriggerStatus(t("Triggered data was overwritten; arm again")); return;
      }
      setFrozen(captured); setOffset(0); setCursors([active.pending, null]); setCursorMode("a"); setArmed(false); trigger.current = null; setTriggerStatus(t("Captured {p0} points · trigger #{p1}{p2}", { p0: String(captured.length), p1: String(active.pending), p2: String(captured.length < span ? t("· insufficient pre-trigger history") : "") }));
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
    catch (error) { return { result: null, error: error instanceof Error ? localizeStatus(error.message, locale) : String(error) }; }
  }, [visible, fftSamples, channel, settings.sampleRate, settings.fftSize, settings.window, settings.channels, settings.layout, removeDC, protocol, snapshot.source, locale]);
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

  const analysisPanels = settings.layout === "instruments" ? [["attitude", t("Attitude")], ["control", t("Controls")]]
    : [["fft", "FFT"], ["xy", "XY"], ["waterfall", t("Waterfall")], ["histogram", t("Distribution")], ...(settings.layout === "full" ? [["attitude", t("Attitude")], ["control", t("Controls")]] : [])];
  const activePanel = analysisPanels.some(([id]) => id === analysisPanel) ? analysisPanel : analysisPanels[0]![0]!;
  if (!visible) return null;
  return <section className="signal-workbench" ref={root} aria-label={t("Signal studio workspace")}>
    <section className="signal-source-bar"><label>{t("Data protocol")} <select aria-label={t("Signal parser protocol")} value={protocol} onChange={event => onProtocol(event.target.value as StreamProtocol)}><option value="raw">{t("Disabled · RawData")}</option><option value="firewater">FireWater CSV</option><option value="justfloat">JustFloat LE</option><option value="binary">{t("Custom numeric frames")}</option><option value="image">{t("Raw image frames")}</option>{!["raw", "firewater", "justfloat", "binary", "image"].includes(protocol) && <option value={protocol}>{protocol}</option>}</select></label>
      <label title={t("Time and frequency use the device's uniform sample rate, not browser arrival times.")}>{t("Sample rate Hz")} <input aria-label={t("Device sample rate")} type="number" min={.001} max={1e9} value={settings.sampleRate} onChange={event => { const rate = Number(event.target.value); if (rate > 0 && rate <= 1e9) setSettings(previous => ({ ...previous, sampleRate: rate })); }} /></label>
      <div className={`source-pill ${snapshot.source === "replay" ? "replay" : snapshot.connected && canWrite ? "live" : "offline"}`}><span />{snapshot.source === "replay" ? t("Offline CSV replay") : snapshot.connected && canWrite ? (isMock ? t("MOCK · simulated live stream") : t("LIVE · device stream")) : t("Waiting for device connection")}</div>
      <div className="signal-import-actions"><label className="signal-file-button">{t("Import CSV")} <input type="file" accept=".csv,text/csv" aria-label={t("Import signal CSV")} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
        try { if (file.size > 8 * 1024 * 1024) throw new Error(t("CSV must not exceed 8 MiB")); const imported = importCsv(await file.text());
          setSettings(previous => ({ ...previous, sampleRate: imported.sampleRate ?? previous.sampleRate, channels: previous.channels.map((config, index) => imported.names[index] ? { ...config, name: imported.names[index]!.slice(0, 32) } : config) }));
          store.replay(imported.samples); setMessage(t("Imported {p0} samples; {p1}.", { p0: String(imported.samples.length.toLocaleString(getFormattingLocale())), p1: String(imported.sampleRate ? t("using the file's sample rate") : t("confirm the device sample rate")) }));
        } catch (error) { report(error); }
      }} /></label><button type="button" className="ghost" disabled={!snapshot.samples.length} onClick={() => exportData(true)}>{t("Export cached CSV")}</button></div>
<div className="signal-top-actions">    <WorkspaceDialog label={t("Channels & frames")} className="signal-configuration">
      <div className="signal-settings-actions"><button type="button" className="ghost" onClick={() => setSettings(previous => ({ ...previous, channels: previous.channels.map((config, index) => ({ ...config, visible: index < Math.min(4, count) })) }))}>{t("Reset visible channels")}</button><button type="button" className="ghost" onClick={() => downloadBlob(`serialhub-instruments-${Date.now()}.json`, new Blob([JSON.stringify({ format: "serialhub-signals", version: 1, settings }, null, 2)], { type: "application/json" }))}>{t("Export instrument settings")}</button>
        <label className="signal-file-button">{t("Import instrument settings")} <input type="file" accept=".json,application/json" aria-label={t("Import instrument settings")} onChange={async event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
          try { if (file.size > 128 * 1024) throw new Error(t("Instrument settings must not exceed 128 KiB")); const data = JSON.parse(await file.text()); if (data.format !== "serialhub-signals" || data.version !== 1) throw new Error(t("Invalid instrument settings version")); const next = validateSettings(data.settings); setSettings(next); setFrameDraft({ binary: next.binary, image: next.image }); setMessage(t("Instrument settings applied; no device command sent")); } catch (error) { report(error); } }} /></label></div>
      <div className="signal-channel-config">{Array.from({ length: count }, (_, index) => { const config = settings.channels[index]!; return <div className="signal-channel-row" key={index}>
        <label className="check"><input type="checkbox" aria-label={t("Show CH{p0}", { p0: String(index) })} checked={config.visible} onChange={event => { if (event.target.checked && visibleCount >= 16) { setMessage(t("Up to 16 visible traces; hide another channel first")); return; } configureChannel(index, { visible: event.target.checked }); }} /><b>CH{index}</b></label>
        <input type="color" aria-label={t("CH{p0} color", { p0: String(index) })} value={config.color} onChange={event => configureChannel(index, { color: event.target.value })} />
        <label>{t("Name")} <input aria-label={t("CH{p0} name", { p0: String(index) })} maxLength={32} value={config.name} onChange={event => configureChannel(index, { name: event.target.value || `CH${index}` })} /></label>
        <label>{t("Unit")} <input aria-label={t("CH{p0} unit", { p0: String(index) })} maxLength={16} value={config.unit} onChange={event => configureChannel(index, { unit: event.target.value })} /></label>
        {([['gain', t("Gain")], ['offset', t("Offset")], ['min', t("Range minimum")], ['max', t("Range maximum")]] as const).map(([key, title]) => <label key={key}>{title}<input aria-label={`CH${index} ${title}`} type="number" step="any" value={config[key]} onChange={event => setNumericChannel(index, key, Number(event.target.value))} /></label>)}
      </div>; })}</div><p className="signal-note">{t("Displayed = raw × gain + offset. CSV keeps raw values. Up to 64 channels and 16 visible traces.")}</p>
      <div className="signal-frame-settings"><fieldset><legend>{t("Custom numeric frames")}</legend><div className="row"><label>{t("Data type")} <select aria-label={t("Numeric frame type")} value={frameDraft.binary.type} onChange={event => setFrameDraft(previous => ({ ...previous, binary: { ...previous.binary, type: event.target.value as BinaryType } }))}>{["float32", "float64", "int16", "uint16", "int32", "uint32", "int8", "uint8"].map(type => <option key={type}>{type}</option>)}</select></label>
        <label>{t("Channels")} <input aria-label={t("Numeric frame channels")} type="number" min={1} max={64} value={frameDraft.binary.channels} onChange={event => setFrameDraft(previous => ({ ...previous, binary: { ...previous.binary, channels: Number(event.target.value) } }))} /></label>
        <label>{t("Byte order")} <select aria-label={t("Numeric frame byte order")} value={String(frameDraft.binary.littleEndian)} onChange={event => setFrameDraft(previous => ({ ...previous, binary: { ...previous.binary, littleEndian: event.target.value === "true" } }))}><option value="true">Little Endian</option><option value="false">Big Endian</option></select></label>
        <label>{t("Header Hex")} <input aria-label={t("Numeric frame header")} maxLength={47} placeholder={t("e.g. AA 55, or leave empty")} value={frameDraft.binary.header} onChange={event => setFrameDraft(previous => ({ ...previous, binary: { ...previous.binary, header: event.target.value } }))} /></label></div></fieldset>
        <fieldset><legend>{t("Raw image frames")}</legend><div className="row">{([['width', t("Width")], ['height', t("Height")]] as const).map(([key, title]) => <label key={key}>{title}<input aria-label={t("Image {p0}", { p0: String(title) })} type="number" min={1} max={512} value={frameDraft.image[key]} onChange={event => setFrameDraft(previous => ({ ...previous, image: { ...previous.image, [key]: Number(event.target.value) } }))} /></label>)}
          <label>{t("Pixel format")} <select aria-label={t("Image pixel format")} value={frameDraft.image.format} onChange={event => setFrameDraft(previous => ({ ...previous, image: { ...previous.image, format: event.target.value as ImageConfig["format"] } }))}><option value="gray8">GRAY8</option><option value="rgb565le">RGB565 LE</option><option value="rgb888">RGB888</option></select></label><label>{t("Header Hex")} <input aria-label={t("Image frame header")} maxLength={47} value={frameDraft.image.header} onChange={event => setFrameDraft(previous => ({ ...previous, image: { ...previous.image, header: event.target.value } }))} /></label></div></fieldset></div>
      <button type="button" className="ghost" onClick={() => { try { const next = validateSettings({ ...settings, ...frameDraft }); setSettings(next); setMessage(t("Frame settings applied; sample cache reset")); } catch (error) { report(error); } }}>{t("Apply frame settings")}</button><p className="signal-note">{t("Fixed-length raw frames, without escaping, checksum or compression. An empty header aligns from the first byte; clear to resync after byte loss. Headers must not occur within payloads.")}</p>
    </WorkspaceDialog>    <WorkspaceDialog label={t("Raw sample table")} className="signal-data-table"><div className="signal-table-scroll"><table><thead><tr><th>{t("Sample #")}</th><th>{t("Estimated time (s)")}</th><th>{t("Received at (ms)")}</th>{Array.from({ length: snapshot.channels }, (_, index) => <th key={index}>CH{index}</th>)}</tr></thead><tbody>{samples.slice(-50).map(sample => <tr key={sample.index}><td>{sample.index}</td><td>{formatNumber(sample.index / settings.sampleRate, 7)}</td><td>{sample.receivedAt || "—"}</td>{Array.from({ length: snapshot.channels }, (_, index) => <td key={index}>{formatNumber(sample.values[index], 7)}</td>)}</tr>)}</tbody></table></div></WorkspaceDialog><select aria-label={t("Instrument layout")} value={settings.layout} onChange={event => setSettings(previous => ({ ...previous, layout: event.target.value as typeof previous.layout }))}><option value="analysis">{t("Analysis")}</option><option value="instruments">{t("Instruments & controls")}</option><option value="full">{t("All instruments")}</option></select>
        <button type="button" className="ghost" onClick={async () => { try { if (fullscreen) await document.exitFullscreen(); else await root.current?.requestFullscreen(); } catch (error) { report(error); } }}>{fullscreen ? t("Exit fullscreen") : t("Fullscreen")}</button></div>    </section>
    <div className="signal-acquisition-stats"><span><b>{snapshot.samples.length.toLocaleString(getFormattingLocale())}</b> {t("buffered / 16,384")}</span><span><b>{snapshot.channels}</b> {t("channels")}</span><span>{t("received")} <b>{snapshot.total.toLocaleString(getFormattingLocale())}</b> {t("frames")}</span><span className={snapshot.invalid ? "warn" : ""}>{t("invalid")} <b>{snapshot.invalid}</b></span><span>{t("overwritten")} <b>{snapshot.evicted.toLocaleString(getFormattingLocale())}</b> {t("points")}</span><span>{localizeStatus(snapshot.reason)}</span><button type="button" className="ghost small" onClick={() => store.clear()}>{t("Clear sample cache")}</button></div>
    <p className="signal-timing-note">{t("Time and frequency use your device sample rate. Browser arrival time is recorded separately and is not a sampling clock.")}</p>
    {message && <div className="signal-notice" role="status"><span>{message}</span><button type="button" aria-label={t("Dismiss instrument notice")} onClick={() => setMessage("")}>×</button></div>}
    {snapshot.source === "replay" && <div className="signal-replay-bar"><button type="button" onClick={() => { setFrozen(null); if (replayPosition >= snapshot.samples.length) setReplayPosition(0); setPlaying(value => !value); }}>{playing ? t("Pause replay") : t("Play replay")}</button><button type="button" className="ghost" onClick={() => { setPlaying(false); setFrozen(null); setReplayPosition(previous => Math.min(snapshot.samples.length, previous + 1)); }}>{t("Single step")}</button>
      <input aria-label={t("Replay position")} type="range" min={0} max={snapshot.samples.length} value={replayPosition} onChange={event => { setFrozen(null); setPlaying(false); setReplayPosition(Number(event.target.value)); }} /><code>{replayPosition} / {snapshot.samples.length}</code><select aria-label={t("Replay speed")} value={speed} onChange={event => setSpeed(Number(event.target.value))}>{[.25, 1, 2, 5, 10].map(value => <option key={value} value={value}>{value}×</option>)}</select><button type="button" className="ghost" onClick={() => store.live()}>{t("Return to live acquisition")}</button></div>}



    <div className="signal-dashboard">
    {protocol === "image" && snapshot.source === "live" ? <article className="signal-card image-card"><div className="instrument-heading"><div><span className="eyebrow">{t("FRAME VIEWER")}</span><h3>{t("Image stream")}</h3></div><span className="signal-tag">{snapshot.image ? t("{p0} × {p1} · {p2} · {p3} frames", { p0: String(snapshot.image.width), p1: String(snapshot.image.height), p2: String(snapshot.image.format), p3: String(snapshot.image.count) }) : t("Waiting for a complete frame")}</span></div><FrameViewer frame={snapshot.image} /><p className="signal-note">{t("Fixed-size raw pixel frames; ordinary serial text is not detected as an image protocol.")}</p></article> : <>
      <article className="signal-card scope-card"><div className="instrument-heading"><div><span className="eyebrow">{t("MULTICHANNEL OSCILLOSCOPE")}</span><h3>{t("Multichannel scope")}</h3></div><div className="scope-status"><span className={`signal-tag ${frozen ? "frozen" : ""}`}>{frozen ? t("Frozen") : snapshot.source === "replay" ? "REPLAY" : snapshot.connected && canWrite ? "LIVE" : t("Cached data · offline")}</span><code>{samples.length.toLocaleString(getFormattingLocale())} {t("points")}</code></div></div>
        <div className="scope-toolbar"><div className="signal-segmented"><button type="button" className={!frozen ? "active" : ""} onClick={follow}>{t("Follow latest")}</button><button type="button" className={frozen ? "active" : ""} disabled={!available.length} onClick={freeze}>{t("Freeze view")}</button></div><button type="button" className="ghost" aria-label={t("Zoom waveform in")} onClick={() => zoom(.5)}>＋</button><button type="button" className="ghost" aria-label={t("Zoom waveform out")} onClick={() => zoom(2)}>−</button>
          <label>{t("Window")} <select aria-label={t("Waveform window size")} value={span} onChange={event => { setSpan(Number(event.target.value)); setOffset(0); }}>{[...new Set([32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, span])].sort((a, b) => a - b).map(value => <option key={value} value={value}>{value.toLocaleString(getFormattingLocale())} {t("points")}</option>)}</select></label>
          <label className="check"><input aria-label={t("Stacked tracks")} type="checkbox" checked={stacked} onChange={event => setStacked(event.target.checked)} /> {t("Tracks")}</label>
          <label className="check"><input type="checkbox" disabled={stacked} checked={autoY} onChange={event => setAutoY(event.target.checked)} /> {t("Auto Y")}</label>{!autoY && <><input aria-label={t("Y-axis minimum")} type="number" step="any" value={manualY[0]} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value < manualY[1]) setManualY([value, manualY[1]]); }} /><input aria-label={t("Y-axis maximum")} type="number" step="any" value={manualY[1]} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value > manualY[0]) setManualY([manualY[0], value]); }} /></>}
          <select aria-label={t("Waveform interaction")} value={cursorMode} onChange={event => setCursorMode(event.target.value as typeof cursorMode)}><option value="pan">{t("Drag to pan")}</option><option value="a">{t("Place cursor A")}</option><option value="b">{t("Place cursor B")}</option></select><button type="button" className="ghost" disabled={!samples.length} onClick={() => exportData(false)}>{t("Window CSV")}</button><button type="button" className="ghost" disabled={!samples.length} onClick={() => { if (svg.current) void exportSvgPng(svg.current, `serialhub-waveform-${Date.now()}.png`).catch(report); }}>{t("Export waveform PNG")}</button>
        </div>
        <div className="signal-legends">{Array.from({ length: count }, (_, index) => <button type="button" key={index} className={selected.includes(index) ? "selected" : ""} style={{ "--channel-color": settings.channels[index]!.color } as React.CSSProperties} onClick={() => {
          const config = settings.channels[index]!; if (!config.visible && visibleCount >= 16) { setMessage(t("Up to 16 visible traces")); return; } configureChannel(index, { visible: !config.visible });
        }}><span />{settings.channels[index]!.name}<b>{formatNumber(available.at(-1) ? calibrated(available.at(-1)!, index, settings.channels[index]!) : NaN)}</b></button>)}</div>
        <div className="scope-plot-viewport" style={{ "--scope-tracks": stacked ? selected.length : 0 } as React.CSSProperties}><ScopePlot samples={samples} channels={settings.channels} selected={selected} sampleRate={settings.sampleRate} yDomain={yDomain} stacked={stacked} cursors={cursors} mode={cursorMode} svgRef={svg}
          onCursor={index => { if (!frozen) freeze(); setCursors(previous => cursorMode === "a" ? [index, previous[1]] : [previous[0], index]); }} onPan={pan} onZoom={zoom} /></div>
        <div className="scope-bottom"><span>#{samples[0]?.index ?? "—"} → #{samples.at(-1)?.index ?? "—"} {t("· peak-preserving zoom · Ctrl + wheel")}</span><label>{t("History position")} <input aria-label={t("Waveform history position")} type="range" min={0} max={Math.max(0, available.length - span)} value={clampedOffset} onChange={event => { if (!frozen) freeze(); setOffset(Number(event.target.value)); }} /></label></div>
        <div className="signal-analysis-strip"><label>{t("Analysis channel")} <select aria-label={t("Analysis channel")} disabled={armed} value={channel} onChange={event => setChannel(Number(event.target.value))}>{channelOptions}</select></label><span>{t("Minimum value")} <b>{formatNumber(stats.min)}</b></span><span>{t("Maximum value")} <b>{formatNumber(stats.max)}</b></span><span>{t("Mean")} <b>{formatNumber(stats.mean)}</b></span><span>RMS <b>{formatNumber(stats.rms)}</b></span><span>Vpp <b>{formatNumber(stats.peakToPeak)}</b></span><span>{t("Valid")} <b>{stats.count}</b></span></div>
        <div className="signal-cursors"><span>A <b>{cursorA ? formatNumber(calibrated(cursorA, channel, settings.channels[channel]!)) : "—"}</b></span><span>B <b>{cursorB ? formatNumber(calibrated(cursorB, channel, settings.channels[channel]!)) : "—"}</b></span><span>ΔY <b>{cursorA && cursorB ? formatNumber(calibrated(cursorB, channel, settings.channels[channel]!) - calibrated(cursorA, channel, settings.channels[channel]!)) : "—"}</b></span><span>Δt <b>{formatNumber(delta)} s</b></span><span>1/Δt <b>{formatNumber(delta ? 1 / delta : NaN)} Hz</b></span><button type="button" className="ghost small" onClick={() => setCursors([null, null])}>{t("Clear cursors")}</button></div>
        <div className="signal-trigger"><strong>{t("Single trigger")}</strong><span>{t("Uses analysis channel")}</span><select aria-label={t("Trigger edge")} disabled={armed} value={String(triggerRising)} onChange={event => setTriggerRising(event.target.value === "true")}><option value="true">{t("Rising ↑")}</option><option value="false">{t("Falling ↓")}</option></select><label>{t("Level")} <input aria-label={t("Trigger level")} type="number" step="any" value={triggerLevel} disabled={armed} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) setTriggerLevel(value); }} /></label>
          <button type="button" disabled={snapshot.source !== "live" || !snapshot.connected || !canWrite} onClick={() => { if (armed) { setArmed(false); trigger.current = null; setTriggerStatus(t("Cancelled")); } else { setFrozen(null); setOffset(0); trigger.current = { after: snapshot.samples.at(-1)?.index ?? -1, pending: null, generation: snapshot.generation }; setArmed(true); setTriggerStatus(t("Waiting for new data to cross the trigger level")); } }}>{armed ? t("Cancel trigger") : t("Arm trigger")}</button><span className={armed ? "trigger-armed" : ""}>{triggerStatus || t("Half-window before and after; freezes on capture")}</span></div>
      </article>
      <MeterCards samples={samples} channels={settings.channels} selected={selected} />
      <div className="signal-instrument-grid" data-panel={activePanel}>
        <div className="analysis-tabs" role="tablist" aria-label={t("Analysis instruments")}>
          {analysisPanels.map(([id, label], index) => <button type="button" role="tab" key={id} id={`${analysisId}-analysis-tab-${id}`} aria-selected={activePanel === id} aria-controls={`${analysisId}-analysis-${id}`} tabIndex={activePanel === id ? 0 : -1}
            onClick={() => setAnalysisPanel(id!)} onKeyDown={event => {
              const next = event.key === "Home" ? 0 : event.key === "End" ? analysisPanels.length - 1 : event.key === "ArrowRight" ? (index + 1) % analysisPanels.length : event.key === "ArrowLeft" ? (index + analysisPanels.length - 1) % analysisPanels.length : -1;
              if (next >= 0) { event.preventDefault(); setAnalysisPanel(analysisPanels[next]![0]!); document.getElementById(`${analysisId}-analysis-tab-${analysisPanels[next]![0]}`)?.focus(); }
            }}>{label}</button>)}
        </div>
      {settings.layout !== "instruments" && <><article className="signal-card spectrum-card" role="tabpanel" id={`${analysisId}-analysis-fft`} aria-labelledby={`${analysisId}-analysis-tab-fft`}><div className="instrument-heading"><div><span className="eyebrow">{t("FREQUENCY DOMAIN")}</span><h3>{t("FFT spectrum")}</h3></div><span className="spectrum-peak" data-testid="spectrum-peak">{fft.result ? `${formatNumber(fft.result.peakFrequency)} Hz` : "— Hz"}<small>{t("Full-spectrum peak")}</small></span></div>
        <div className="spectrum-toolbar"><label>{t("FFT size")} <select aria-label={t("FFT size")} value={settings.fftSize} onChange={event => { const size = Number(event.target.value); setSettings(previous => ({ ...previous, fftSize: size }));  }}>{[256, 512, 1024, 2048, 4096].map(size => <option key={size}>{size}</option>)}</select></label><label>{t("Window function")} <select aria-label={t("FFT window function")} value={settings.window} onChange={event => setSettings(previous => ({ ...previous, window: event.target.value as typeof previous.window }))}><option value="hann">Hann</option><option value="rectangular">{t("Rectangular")}</option></select></label><label className="check"><input type="checkbox" checked={logarithmic} onChange={event => setLogarithmic(event.target.checked)} />dB</label><label className="check"><input type="checkbox" checked={removeDC} onChange={event => setRemoveDC(event.target.checked)} /> {t("Remove DC")}</label></div>
        <label className="spectrum-frequency-limit">{t("Frequency limit Hz (0 = Nyquist)")} <input aria-label={t("Spectrum frequency limit")} type="number" min={0} max={settings.sampleRate / 2} value={frequencyLimit} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0) setFrequencyLimit(value); }} /></label>
        <SpectrumPlot result={fft.result} maxFrequency={frequencyLimit} logarithmic={logarithmic} unit={settings.channels[channel]!.unit} /><div className="spectrum-footer">{fft.error || t("Last {p0} points · Δf {p1} Hz · peak amplitude {p2} {p3} · one-sided, window-gain corrected", { p0: String(settings.fftSize), p1: String(formatNumber(fft.result?.resolution)), p2: String(formatNumber(fft.result?.peakAmplitude)), p3: String(settings.channels[channel]!.unit) })}</div>
      </article><article className="signal-card xy-card" role="tabpanel" id={`${analysisId}-analysis-xy`} aria-labelledby={`${analysisId}-analysis-tab-xy`}><div className="instrument-heading"><div><span className="eyebrow">{t("PHASE PORTRAIT")}</span><h3>{t("XY trajectory")}</h3></div><span className="signal-tag">{t("2D phase portrait")}</span></div><div className="spectrum-toolbar"><label>{t("X axis")} <select aria-label={t("XY X channel")} value={xChannel} onChange={event => setXChannel(Number(event.target.value))}>{channelOptions}</select></label><label>{t("Y axis")} <select aria-label={t("XY Y channel")} value={yChannel} onChange={event => setYChannel(Number(event.target.value))}>{channelOptions}</select></label><span className="signal-note">{t("Same sample frame; gaps preserved")}</span></div><XYPlot samples={samples} channels={settings.channels} xChannel={xChannel} yChannel={yChannel} /></article>
      <article className="signal-card waterfall-card" role="tabpanel" id={`${analysisId}-analysis-waterfall`} aria-labelledby={`${analysisId}-analysis-tab-waterfall`}><div className="instrument-heading"><div><span className="eyebrow">{t("SPECTRAL HISTORY")}</span><h3>{t("Spectrum waterfall")}</h3></div><span className="signal-tag">{t("Latest")} {waterfall.length} {t("/ 64 windows")}</span></div><Waterfall rows={waterfall} /><div className="waterfall-legend"><span>0 Hz</span><span>−100 dB <i /> 0 dB</span><span>{formatNumber(settings.sampleRate / 2)} Hz</span></div><p className="signal-note">{t("Newest window at top; updates every ¼ FFT window with a fixed dB re 1 unit scale.")}</p></article>
      <article className="signal-card histogram-card" role="tabpanel" id={`${analysisId}-analysis-histogram`} aria-labelledby={`${analysisId}-analysis-tab-histogram`}><div className="instrument-heading"><div><span className="eyebrow">{t("DISTRIBUTION")}</span><h3>{t("Value distribution")}</h3></div><span className="signal-tag">{settings.channels[channel]!.name} {t("· 24 BINS")}</span></div><HistogramPlot values={values} /><p className="signal-note">{t("Finite values in this window; missing samples are excluded.")}</p></article></>}
      {(settings.layout === "instruments" || settings.layout === "full") && <><Attitude idPrefix={analysisId} latest={available.at(-1)} channels={settings.channels} count={count} /><ControlDeck idPrefix={analysisId} config={settings.control} onConfig={control => setSettings(previous => ({ ...previous, control }))} commands={commands} canWrite={canWrite && snapshot.source === "live"} busy={busy} onQuick={onQuick} onValue={onValue} /></>}
      </div>
    </>}

    </div>
  </section>;
}
