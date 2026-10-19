import { parseFireWater, parseJustFloat, type StreamProtocol, type WaveSample } from "../protocolUtils.ts";
import type { SignalSample } from "./math.ts";

export const SIGNAL_CAPACITY = 16384;
export type BinaryType = "float32" | "float64" | "int16" | "uint16" | "int32" | "uint32" | "int8" | "uint8";
export type BinaryConfig = { type: BinaryType; channels: number; littleEndian: boolean; header: string };
export type ImageConfig = { width: number; height: number; format: "gray8" | "rgb565le" | "rgb888"; header: string };
export type ImageFrame = { width: number; height: number; format: ImageConfig["format"]; bytes: Uint8Array<ArrayBuffer>; count: number };
export type SignalSnapshot = {
  revision: number; generation: number; protocol: StreamProtocol; source: "live" | "replay";
  samples: readonly SignalSample[]; channels: number; total: number; invalid: number; evicted: number;
  reason: string; image: ImageFrame | null; connected: boolean;
};
const BYTE_SIZES: Record<BinaryType, number> = { float32: 4, float64: 8, int16: 2, uint16: 2, int32: 4, uint32: 4, int8: 1, uint8: 1 };
export const DEFAULT_BINARY: BinaryConfig = { type: "float32", channels: 3, littleEndian: true, header: "" };
export const DEFAULT_IMAGE: ImageConfig = { width: 128, height: 128, format: "gray8", header: "" };
export function parseHeader(text: string): Uint8Array<ArrayBuffer> {
  if (typeof text !== "string") throw new Error("帧头须为 Hex 文本");
  const hex = text.replace(/\s+/g, "");
  if (!/^(?:[0-9a-f]{2}){0,16}$/i.test(hex)) throw new Error("帧头须为最多 16 字节的 Hex");
  return new Uint8Array(hex.match(/../g)?.map(byte => Number.parseInt(byte, 16)) ?? []);
}
export function validateBinary(config: BinaryConfig): BinaryConfig {
  if (!config || typeof config !== "object" || !Object.hasOwn(BYTE_SIZES, config.type) || !Number.isInteger(config.channels) || config.channels < 1 || config.channels > 64 || typeof config.littleEndian !== "boolean") throw new Error("自定义帧需要 1–64 通道和有效数据类型");
  parseHeader(config.header);
  return { type: config.type, channels: config.channels, littleEndian: config.littleEndian, header: config.header };
}
export function validateImage(config: ImageConfig): ImageConfig {
  if (!config || typeof config !== "object" || ![config.width, config.height].every(value => Number.isInteger(value) && value > 0 && value <= 512) || !["gray8", "rgb565le", "rgb888"].includes(config.format)) throw new Error("图像宽高须为 1–512，像素格式须有效");
  parseHeader(config.header); return { width: config.width, height: config.height, format: config.format, header: config.header };
}
export function imageRgba(frame: ImageFrame): Uint8ClampedArray<ArrayBuffer> {
  const output = new Uint8ClampedArray(frame.width * frame.height * 4);
  for (let pixel = 0; pixel < frame.width * frame.height; pixel++) {
    let r: number, g: number, b: number;
    if (frame.format === "gray8") r = g = b = frame.bytes[pixel]!;
    else if (frame.format === "rgb888") { r = frame.bytes[pixel * 3]!; g = frame.bytes[pixel * 3 + 1]!; b = frame.bytes[pixel * 3 + 2]!; }
    else {
      const rgb = frame.bytes[pixel * 2]! | frame.bytes[pixel * 2 + 1]! << 8;
      r = Math.round((rgb >>> 11) / 31 * 255); g = Math.round(((rgb >>> 5) & 63) / 63 * 255); b = Math.round((rgb & 31) / 31 * 255);
    }
    output.set([r, g, b, 255], pixel * 4);
  }
  return output;
}

/** One bounded store, immutable snapshots at <=20 Hz, independent of terminal pause. */
export class SignalStore {
  private ring: (SignalSample | undefined)[];
  private start = 0;
  private count = 0;
  private nextIndex = 0;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private text = "";
  private decoder = new TextDecoder();
  private overflowLine = false;
  private pendingGap = false;
  private bytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
  private binary: BinaryConfig = { ...DEFAULT_BINARY };
  private imageConfig: ImageConfig = { ...DEFAULT_IMAGE };
  private header = new Uint8Array();
  private view: SignalSnapshot;
  private meta: Omit<SignalSnapshot, "revision" | "samples">;
  readonly capacity: number;
  constructor(capacity = SIGNAL_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 65536) throw new Error("Invalid signal buffer capacity");
    this.capacity = capacity; this.ring = new Array(capacity);
    this.meta = { generation: 0, protocol: "raw", source: "live", channels: 0, total: 0, invalid: 0, evicted: 0, reason: "等待数据", image: null, connected: false };
    this.view = { ...this.meta, revision: 0, samples: [] };
  }
  getSnapshot = (): SignalSnapshot => this.view;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish = () => {
    clearTimeout(this.timer); this.timer = undefined;
    const samples = Array.from({ length: this.count }, (_, index) => this.ring[(this.start + index) % this.capacity]!);
    this.view = { ...this.meta, revision: this.view.revision + 1, samples };
    for (const listener of this.listeners) listener();
  };
  private schedule() { if (this.timer === undefined) this.timer = setTimeout(this.publish, 50); }
  private resetParser() { this.text = ""; this.decoder = new TextDecoder(); this.bytes = new Uint8Array(); this.overflowLine = false; this.pendingGap = false; }
  clear(reason = "缓存已清空") {
    this.ring.fill(undefined); this.start = this.count = this.nextIndex = 0;
    this.resetParser(); this.meta = { ...this.meta, generation: this.meta.generation + 1, channels: 0, total: 0, invalid: 0, evicted: 0, image: null, reason };
    this.publish();
  }
  setProtocol(protocol: StreamProtocol) {
    if (protocol === this.meta.protocol) return;
    this.meta.protocol = protocol; this.configureHeader();
    if (this.meta.source === "replay") { this.resetParser(); this.publish(); }
    else this.clear("解析协议已切换，等待新数据");
  }
  configure(binary: BinaryConfig, image: ImageConfig) {
    this.binary = validateBinary(binary); this.imageConfig = validateImage(image); this.configureHeader();
    if (this.meta.source === "replay") { this.resetParser(); this.publish(); }
    else this.clear("帧配置已应用，等待帧头或完整帧");
  }
  private configureHeader() { this.header = parseHeader(this.meta.protocol === "image" ? this.imageConfig.header : this.binary.header); }
  open() { this.meta.connected = true; if (this.meta.source === "live") this.clear("实时采集中"); else this.publish(); }
  close(reason = "实时流已断开") { this.meta.connected = false; this.resetParser(); if (this.meta.source === "live") { this.meta.generation++; this.meta.reason = reason; } this.publish(); }
  markGap(reason: string) {
    if (this.meta.source === "replay") return;
    this.resetParser(); this.append({ values: Array.from({ length: Math.max(1, this.meta.channels) }, () => NaN) }, Date.now());
    this.meta.reason = reason; this.schedule();
  }
  live() { this.meta.source = "live"; this.clear(this.meta.connected ? "实时采集中" : "等待连接"); }
  replay(samples: readonly SignalSample[]) {
    if (!samples.length || samples.length > this.capacity) throw new Error(`回放需要 1–${this.capacity} 个采样点`);
    this.meta.source = "replay"; this.clear("离线回放，不会发送设备命令");
    for (const sample of samples) this.append({ values: [...sample.values] }, sample.receivedAt, sample.index);
    this.publish();
  }
  private append(sample: WaveSample, receivedAt: number, sampleIndex = this.nextIndex) {
    if (!sample.values.length || sample.values.length > 64) { this.meta.invalid++; return; }
    const values = sample.values.map(value => Number.isFinite(value) ? value : NaN);
    if (values.some(value => !Number.isFinite(value))) this.meta.invalid++;
    const index = (this.start + this.count) % this.capacity;
    this.ring[index] = { index: sampleIndex, receivedAt, values }; this.nextIndex = sampleIndex + 1;
    if (this.count === this.capacity) { this.start = (this.start + 1) % this.capacity; this.meta.evicted++; } else this.count++;
    if (values.some(Number.isFinite)) this.meta.channels = Math.max(this.meta.channels, values.length); this.meta.total++;
  }
  feed(incoming: Uint8Array, history = false, receivedAt = Date.now()) {
    if (this.meta.source === "replay") return;
    if (history) { this.markGap("已忽略可能的历史数据，等待实时帧"); return; }
    const protocol = this.meta.protocol;
    if (!["firewater", "justfloat", "binary", "image"].includes(protocol)) return;
    if (protocol === "firewater") {
      let text = this.decoder.decode(incoming, { stream: true });
      if (this.overflowLine) {
        const end = text.indexOf("\n"); if (end < 0) return;
        text = text.slice(end + 1); this.overflowLine = false;
      }
      const combined = this.text + text;
      const parsed = parseFireWater(combined);
      this.text = parsed.remainder;
      // Never decode an arbitrary suffix of an oversized incomplete line.
      const suffixLength = combined.length - (combined.lastIndexOf("\n") + 1);
      if (suffixLength > 65536) { this.text = ""; this.overflowLine = true; this.meta.invalid++; this.append({ values: [NaN] }, receivedAt); }
      for (const sample of parsed.samples) this.append(sample, receivedAt);
    } else if (protocol === "justfloat") {
      const parsed = parseJustFloat(this.bytes, incoming);
      this.bytes = parsed.remainder;
      if (this.bytes.length >= 65536) { this.bytes = new Uint8Array(); this.append({ values: [NaN] }, receivedAt); }
      for (const sample of parsed.samples) this.append(sample, receivedAt);
    } else this.feedFixed(incoming, receivedAt);
    const latest = this.count ? this.ring[(this.start + this.count - 1) % this.capacity] : undefined;
    if (this.meta.connected && (latest?.values.some(Number.isFinite) || this.meta.image)) this.meta.reason = "实时采集中";
    this.schedule();
  }
  private feedFixed(incoming: Uint8Array, receivedAt: number) {
    const combined = new Uint8Array(this.bytes.length + incoming.length); combined.set(this.bytes); combined.set(incoming, this.bytes.length);
    const isImage = this.meta.protocol === "image";
    const payloadBytes = isImage ? this.imageConfig.width * this.imageConfig.height * ({ gray8: 1, rgb565le: 2, rgb888: 3 }[this.imageConfig.format]) : this.binary.channels * BYTE_SIZES[this.binary.type];
    const frameBytes = this.header.length + payloadBytes;
    let offset = 0, discarded = this.pendingGap; this.pendingGap = false;
    while (offset < combined.length) {
      if (this.header.length) {
        while (offset + this.header.length <= combined.length && !this.header.every((byte, index) => combined[offset + index] === byte)) { offset++; discarded = true; }
      }
      if (combined.length - offset < frameBytes) break;
      const payload = combined.subarray(offset + this.header.length, offset + frameBytes);
      if (isImage) {
        this.meta.image = { ...this.imageConfig, bytes: new Uint8Array(payload), count: (this.meta.image?.count ?? 0) + 1 };
      } else {
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength), values: number[] = [];
        for (let channel = 0; channel < this.binary.channels; channel++) {
          const position = channel * BYTE_SIZES[this.binary.type], little = this.binary.littleEndian;
          const value = this.binary.type === "float32" ? view.getFloat32(position, little) : this.binary.type === "float64" ? view.getFloat64(position, little)
            : this.binary.type === "int16" ? view.getInt16(position, little) : this.binary.type === "uint16" ? view.getUint16(position, little)
            : this.binary.type === "int32" ? view.getInt32(position, little) : this.binary.type === "uint32" ? view.getUint32(position, little)
            : this.binary.type === "int8" ? view.getInt8(position) : view.getUint8(position);
          values.push(value);
        }
        if (discarded) { this.append({ values: [NaN] }, receivedAt); discarded = false; }
        this.append({ values }, receivedAt);
      }
      offset += frameBytes;
    }
    this.bytes = combined.slice(offset);
    if (discarded) { this.pendingGap = true; this.meta.reason = "跳过帧头之前的字节，已重新同步"; this.meta.invalid++; }
  }
  flush() { this.publish(); }
  dispose() { clearTimeout(this.timer); this.timer = undefined; this.listeners.clear(); }
}
