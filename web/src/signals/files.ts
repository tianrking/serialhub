import { t, getFormattingLocale } from "../i18n/index.ts";
import { defaultChannel, type Channel, type SignalSample } from "./math.ts";
import { SIGNAL_CAPACITY, DEFAULT_BINARY, DEFAULT_IMAGE, validateBinary, validateImage, type BinaryConfig, type ImageConfig } from "./store.ts";
export const SIGNAL_SETTINGS_KEY = "serialhub.signals.v1";
export type ControlConfig = { template: string; min: number; max: number; step: number };
export const DEFAULT_CONTROL: ControlConfig = { template: "SET:{value}", min: 0, max: 100, step: 1 };
export type SignalSettings = { control: ControlConfig; sampleRate: number; channels: Channel[]; fftSize: number; window: "hann" | "rectangular"; binary: BinaryConfig; image: ImageConfig; layout: "analysis" | "instruments" | "full" };
export function defaultSettings(): SignalSettings { return { control: { ...DEFAULT_CONTROL }, sampleRate: 1000, channels: Array.from({ length: 64 }, (_, index) => defaultChannel(index)), fftSize: 1024, window: "hann", binary: { ...DEFAULT_BINARY }, image: { ...DEFAULT_IMAGE }, layout: "analysis" }; }
export function validateSettings(value: unknown): SignalSettings {
  if (!value || typeof value !== "object") throw new Error(t("Invalid instrument settings"));
  const data = value as SignalSettings;
  if (!Number.isFinite(data.sampleRate) || data.sampleRate <= 0 || data.sampleRate > 1e9 || ![256, 512, 1024, 2048, 4096].includes(data.fftSize)
      || !["hann", "rectangular"].includes(data.window) || !["analysis", "instruments", "full"].includes(data.layout)
      || !Array.isArray(data.channels) || data.channels.length !== 64) throw new Error(t("Invalid instrument parameters or channel count"));
  const control = data.control ?? DEFAULT_CONTROL;
  if (typeof control.template !== "string" || control.template.length > 512 || ![control.min, control.max, control.step].every(Number.isFinite)
      || control.min >= control.max || control.step <= 0 || control.step > control.max - control.min) throw new Error(t("Invalid control range or step"));
  const channels = data.channels.map((channel, index) => {
    if (!channel || typeof channel.name !== "string" || !channel.name.trim() || channel.name.length > 32 || /[\r\n]/.test(channel.name)
        || typeof channel.unit !== "string" || channel.unit.length > 16 || /[\r\n]/.test(channel.unit)
        || typeof channel.color !== "string" || !/^#[0-9a-f]{6}$/i.test(channel.color) || typeof channel.visible !== "boolean"
        || ![channel.gain, channel.offset, channel.min, channel.max].every(Number.isFinite) || channel.min >= channel.max) throw new Error(t("Invalid CH{p0} settings", { p0: String(index) }));
    return { name: channel.name, unit: channel.unit, color: channel.color, visible: channel.visible, gain: channel.gain, offset: channel.offset, min: channel.min, max: channel.max };
  });
  if (channels.filter(channel => channel.visible).length > 16) throw new Error(t("Up to 16 visible traces; reduce visible channels in settings"));
  return { control: { template: control.template, min: control.min, max: control.max, step: control.step }, sampleRate: data.sampleRate, fftSize: data.fftSize, window: data.window, layout: data.layout, channels,
    binary: validateBinary(data.binary), image: validateImage(data.image) };
}
export function loadSignalSettings(): SignalSettings {
  try { const value = localStorage.getItem(SIGNAL_SETTINGS_KEY); return value ? validateSettings(JSON.parse(value)) : defaultSettings(); }
  catch { return defaultSettings(); }
}
function csvCell(value: string): string {
  const safe = /^[\s=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function exportCsv(samples: readonly SignalSample[], channels: readonly Channel[], sampleRate: number): string {
  const count = Math.min(64, Math.max(0, ...samples.map(sample => sample.values.length)));
  const header = ["sample_index", "time_s", "received_at_ms", ...channels.slice(0, count).map((channel, index) => csvCell(`${channel.name || `CH${index}`}${channel.unit ? ` (${channel.unit})` : ""}`))].join(",");
  return `# SerialHub raw samples; sample_rate_hz=${sampleRate}; calibration=raw\n${header}\n` + samples.map(sample => [sample.index, sample.index / sampleRate, sample.receivedAt,
    ...Array.from({ length: count }, (_, index) => Number.isFinite(sample.values[index]) ? sample.values[index] : "")].join(",")).join("\n") + "\n";
}
function splitCsv(line: string): string[] {
  const cells: string[] = []; let cell = "", quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { cell += '"'; index++; } else quoted = !quoted;
    } else if (character === "," && !quoted) { cells.push(cell.trim()); cell = ""; } else cell += character;
  }
  if (quoted) throw new Error(t("CSV contains an unclosed quote"));
  cells.push(cell.trim()); return cells;
}
export type ImportedSignal = { samples: SignalSample[]; sampleRate?: number; names: string[] };
export function importCsv(text: string): ImportedSignal {
  if (text.length > 8 * 1024 * 1024) throw new Error(t("CSV must not exceed 8 MiB"));
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const samples: SignalSample[] = []; const times: number[] = []; let metadata = false, names: string[] = [], sampleRate: number | undefined, columns = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim(); if (!line) continue;
    if (line.startsWith("#")) {
      const rate = line.match(/sample_rate_hz=([\deE.+-]+)/);
      if (rate && Number.isFinite(Number(rate[1])) && Number(rate[1]) > 0 && Number(rate[1]) <= 1e9) sampleRate = Number(rate[1]);
      continue;
    }
    const cells = splitCsv(line);
    if (cells[0] === "sample_index" && cells[1] === "time_s" && cells[2] === "received_at_ms" && !samples.length) { metadata = true; names = cells.slice(3); continue; }
    if (!samples.length && !names.length && cells.some(cell => cell !== "" && !Number.isFinite(Number(cell)))) { names = cells; continue; }
    const data = metadata ? cells.slice(3) : cells;
    if (!data.length || data.length > 64 || (columns && data.length !== columns)) throw new Error(t("CSV row {p0}: channel count differs or exceeds 64", { p0: String(index + 1) }));
    columns = data.length;
    const values = data.map(cell => cell === "" ? NaN : /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(cell) && Number.isFinite(Number(cell)) ? Number(cell) : null);
    if (values.some(value => value === null)) throw new Error(t("CSV row {p0} contains an invalid number", { p0: String(index + 1) }));
    const sampleIndex = metadata ? Number(cells[0]) : samples.length;
    const receivedAt = metadata ? Number(cells[2]) : 0;
    if (metadata) { if (!Number.isFinite(Number(cells[1]))) throw new Error(t("Invalid CSV time column")); times.push(Number(cells[1])); }
    if (!Number.isSafeInteger(sampleIndex) || sampleIndex < 0 || (samples.length && sampleIndex <= samples.at(-1)!.index) || !Number.isFinite(receivedAt)) throw new Error(t("Invalid CSV sample index or receive time"));
    samples.push({ index: sampleIndex, receivedAt, values: values as number[] });
    if (samples.length > SIGNAL_CAPACITY) throw new Error(t("CSV is limited to {p0} samples; import in segments", { p0: String(SIGNAL_CAPACITY.toLocaleString(getFormattingLocale())) }));
  }
  if (!samples.length) throw new Error(t("CSV contains no samples"));
  if (metadata && times.length > 1) {
    const inferred = (samples[1]!.index - samples[0]!.index) / (times[1]! - times[0]!);
    const rate = sampleRate ?? inferred;
    if (!Number.isFinite(rate) || rate <= 0 || rate > 1e9) throw new Error(t("Cannot infer a valid sample rate from CSV times"));
    for (let index = 1; index < times.length; index++) {
      const expected = (samples[index]!.index - samples[0]!.index) / rate;
      if (Math.abs(times[index]! - times[0]! - expected) > Math.max(1e-9, Math.abs(expected) * 1e-5)) throw new Error(t("CSV times are not uniform; resample before spectral analysis"));
    }
    sampleRate = rate;
  }
  return { samples, sampleRate, names: names.slice(0, columns) };
}
export async function exportSvgPng(svg: SVGSVGElement, filename: string) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const height = Math.round(1920 * svg.viewBox.baseVal.height / svg.viewBox.baseVal.width);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg"); clone.setAttribute("width", "1920"); clone.setAttribute("height", String(height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error(t("Image export failed"))); image.src = url; });
    const canvas = document.createElement("canvas"); canvas.width = 1920; canvas.height = height;
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error(t("Image encoding failed"))), "image/png"));
    const output = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = output; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(output), 1000);
  } finally { URL.revokeObjectURL(url); }
}
