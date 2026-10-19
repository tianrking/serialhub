import { t, number } from "../i18n/index.ts";
export type SignalSample = { index: number; receivedAt: number; values: readonly number[] };
export type Channel = { name: string; unit: string; color: string; gain: number; offset: number; min: number; max: number; visible: boolean };
export const COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#22d3ee", "#f472b6", "#a3e635"];
export function defaultChannel(index: number): Channel {
  return { name: `CH${index}`, unit: "", color: COLORS[index % COLORS.length]!, gain: 1, offset: 0, min: -1, max: 1, visible: index < 4 };
}
export function calibrated(sample: SignalSample, channel: number, config: Channel): number {
  const raw = sample.values[channel];
  return Number.isFinite(raw) ? raw! * config.gain + config.offset : Number.NaN;
}
export function formatNumber(value: number | undefined, digits = 4): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return Math.abs(value) >= 1e6 || (value !== 0 && Math.abs(value) < 0.001)
    ? number(value, { notation: "scientific", maximumFractionDigits: 2, useGrouping: false })
    : number(value, { maximumSignificantDigits: digits, useGrouping: false });
}
export function statistics(values: readonly number[]) {
  let min = Infinity, max = -Infinity, mean = 0, m2 = 0, count = 0;
  // Welford avoids catastrophic cancellation for a small ripple on a large DC level.
  for (const value of values) if (Number.isFinite(value)) {
    count++; const delta = value - mean; mean += delta / count; m2 += delta * (value - mean);
    min = Math.min(min, value); max = Math.max(max, value);
  }
  return count ? { min, max, mean, rms: Math.hypot(mean, Math.sqrt(Math.max(0, m2 / count))), peakToPeak: max - min, count }
    : { min: NaN, max: NaN, mean: NaN, rms: NaN, peakToPeak: NaN, count: 0 };
}
export function extent(values: readonly number[]): [number, number] {
  const { min, max, count } = statistics(values);
  if (!count) return [-1, 1];
  const padding = min === max ? Math.max(0.01, Math.abs(min) * .05) : (max - min) * .08;
  return [min - padding, max + padding];
}
export type PlotPoint = { x: number; y: number };
/** Min/max per bucket, preserving time order and explicit missing-data gaps. */
export function envelope(points: readonly PlotPoint[], buckets = 600): PlotPoint[] {
  if (points.length <= buckets * 2) return [...points];
  const result: PlotPoint[] = [];
  const size = Math.ceil(points.length / buckets);
  for (let start = 0; start < points.length; start += size) {
    let min = -1, max = -1;
    const gaps: number[] = [];
    for (let index = start; index < Math.min(points.length, start + size); index++) {
      const point = points[index]!;
      if (!Number.isFinite(point.y)) { gaps.push(index); continue; }
      if (min < 0 || point.y < points[min]!.y) min = index;
      if (max < 0 || point.y > points[max]!.y) max = index;
    }
    const indices = new Set([min, max, ...gaps]);
    if (gaps.length) { indices.add(start); indices.add(Math.min(points.length - 1, start + size - 1)); }
    for (const index of [...indices].filter(index => index >= 0).sort((a, b) => a - b)) result.push(points[index]!);
  }
  return result;
}
export function plotPath(points: readonly PlotPoint[], x: (value: number) => number, y: (value: number) => number): string {
  let drawing = false, result = "";
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) { drawing = false; continue; }
    // Callers insert explicit NaNs for missing time indices. XY traces may
    // run backwards in X and must remain connected.
    const px = x(point.x), py = y(point.y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) { drawing = false; continue; }
    result += `${drawing ? "L" : "M"}${px.toFixed(2)},${py.toFixed(2)} `;
    drawing = true;
  }
  return result.trim();
}
export function findTrigger(samples: readonly SignalSample[], channel: number, level: number, rising: boolean, after: number, config: Channel): number | null {
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1]!, current = samples[index]!;
    if (current.index <= after || current.index !== previous.index + 1) continue;
    const a = calibrated(previous, channel, config), b = calibrated(current, channel, config);
    if (Number.isFinite(a) && Number.isFinite(b) && (rising ? a < level && b >= level : a > level && b <= level)) return current.index;
  }
  return null;
}
export type Spectrum = { frequencies: number[]; amplitudes: number[]; db: number[]; peakFrequency: number; peakAmplitude: number; resolution: number };
/** One-sided amplitude spectrum; coherent-gain corrected, including DC/Nyquist. */
export function spectrum(samples: readonly SignalSample[], channel: number, config: Channel, sampleRate: number, size: number, window: "hann" | "rectangular", removeDC = true): Spectrum {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || sampleRate > 1e9) throw new Error(t("Set a valid device sample rate"));
  if (!Number.isInteger(size) || size < 32 || size > 4096 || (size & (size - 1)) !== 0) throw new Error(t("FFT size must be a power of two from 32 to 4096"));
  if (samples.length < size) throw new Error(t("Need {p0} more samples", { p0: String(size - samples.length) }));
  const input = samples.slice(-size);
  const values = input.map(sample => calibrated(sample, channel, config));
  if (values.some(value => !Number.isFinite(value)) || input.some((sample, index) => index > 0 && sample.index !== input[index - 1]!.index + 1)) throw new Error(t("FFT window contains gaps or invalid samples; waiting for contiguous valid data"));
  const mean = removeDC ? values.reduce((sum, value) => sum + value / size, 0) : 0;
  const real = new Float64Array(size), imag = new Float64Array(size);
  let windowSum = 0;
  for (let index = 0; index < size; index++) {
    const weight = window === "hann" ? .5 - .5 * Math.cos(2 * Math.PI * index / (size - 1)) : 1;
    real[index] = (values[index]! - mean) * weight; windowSum += weight;
  }
  for (let index = 1, reversed = 0; index < size; index++) {
    let bit = size >> 1;
    while (reversed & bit) { reversed ^= bit; bit >>= 1; }
    reversed ^= bit;
    if (index < reversed) { [real[index], real[reversed]] = [real[reversed]!, real[index]!]; }
  }
  for (let length = 2; length <= size; length *= 2) {
    const angle = -2 * Math.PI / length;
    for (let start = 0; start < size; start += length) {
      for (let offset = 0; offset < length / 2; offset++) {
        const cosine = Math.cos(angle * offset), sine = Math.sin(angle * offset);
        const a = start + offset, b = a + length / 2;
        const tr = cosine * real[b]! - sine * imag[b]!, ti = sine * real[b]! + cosine * imag[b]!;
        real[b] = real[a]! - tr; imag[b] = imag[a]! - ti;
        real[a] = real[a]! + tr; imag[a] = imag[a]! + ti;
      }
    }
  }
  const frequencies: number[] = [], amplitudes: number[] = [], db: number[] = [];
  let peak = removeDC ? 1 : 0;
  for (let bin = 0; bin <= size / 2; bin++) {
    const amplitude = Math.hypot(real[bin]!, imag[bin]!) / windowSum * (bin === 0 || bin === size / 2 ? 1 : 2);
    if (!Number.isFinite(amplitude)) throw new Error(t("Spectrum amplitude overflow; adjust channel gain"));
    frequencies.push(bin * sampleRate / size); amplitudes.push(amplitude); db.push(Math.max(-160, 20 * Math.log10(Math.max(1e-8, amplitude))));
    if ((bin > 0 || !removeDC) && amplitude > (amplitudes[peak] ?? -1)) peak = bin;
  }
  return { frequencies, amplitudes, db, peakFrequency: frequencies[peak]!, peakAmplitude: amplitudes[peak]!, resolution: sampleRate / size };
}
export function histogram(values: readonly number[], bins = 24) {
  const finite = values.filter(Number.isFinite);
  const [min, max] = extent(finite);
  const counts = new Array<number>(bins).fill(0);
  for (const value of finite) counts[Math.max(0, Math.min(bins - 1, Math.floor((value - min) / (max - min) * bins)))]!++;
  return { min, max, counts, count: finite.length };
}

/** Reduce directly from samples: do not allocate a point for every channel cell. */
export function scopePoints(samples: readonly SignalSample[], channel: number, config: Channel, sampleRate: number, buckets = 600): PlotPoint[] {
  const size = Math.max(1, Math.ceil(samples.length / buckets));
  const result: PlotPoint[] = [];
  for (let start = 0; start < samples.length; start += size) {
    let minimum = Infinity, maximum = -Infinity, minIndex = -1, maxIndex = -1;
    const gaps: { index: number; before: boolean }[] = [];
    for (let index = start; index < Math.min(samples.length, start + size); index++) {
      const value = calibrated(samples[index]!, channel, config);
      if (index > 0 && samples[index]!.index !== samples[index - 1]!.index + 1) gaps.push({ index, before: true });
      if (!Number.isFinite(value)) { gaps.push({ index, before: false }); continue; }
      if (value < minimum) { minimum = value; minIndex = index; }
      if (value > maximum) { maximum = value; maxIndex = index; }
    }
    const candidates = [...new Set([minIndex, maxIndex, ...(start === 0 ? [0] : []), ...(start + size >= samples.length ? [samples.length - 1] : [])])]
      .filter(index => index >= 0).map(index => ({ index, before: false, gap: false }));
    const events = [...candidates, ...gaps.map(item => ({ ...item, gap: true }))].sort((a, b) => a.index - b.index || Number(b.before) - Number(a.before));
    for (const event of events) result.push({ x: samples[event.index]!.index / sampleRate, y: event.gap ? NaN : calibrated(samples[event.index]!, channel, config) });
  }
  return result;
}
export function channelExtent(samples: readonly SignalSample[], selected: readonly number[], channels: readonly Channel[]): [number, number] {
  let min = Infinity, max = -Infinity;
  for (const sample of samples) for (const index of selected) {
    const value = calibrated(sample, index, channels[index]!);
    if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
  }
  if (min === Infinity) return [-1, 1];
  const padding = max === min ? Math.max(.01, Math.abs(min) * .05) : (max - min) * .08;
  return [min - padding, max + padding];
}

export function axisTick(value: number, step: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return "—";
  if (Math.abs(value) < step / 1000) return number(0);
  if (Math.abs(value) >= 1e6 || step < 1e-7) return number(value, { maximumSignificantDigits: 5, useGrouping: false });
  const digits = Math.max(0, Math.min(8, Math.ceil(-Math.log10(step)) + 1));
  return number(Number(value.toFixed(digits)), { maximumFractionDigits: digits, useGrouping: false });
}
