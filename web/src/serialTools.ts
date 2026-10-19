import { t } from "./i18n/index.ts";
import { appendLineEnding, type QuickCommand, type ConnectionProfile } from "./commandUtils.ts";
import { appendHexChecksum, type HexChecksum, type ChecksumRange } from "./checksumUtils.ts";
import { validateConnection } from "./api/types.ts";

export type TextEncoding = "utf-8" | "gbk" | "ascii";
let gbkMap: Map<string, number[]> | undefined;

// Use the browser's WHATWG GBK table in reverse. Unrepresentable characters
// are errors, rather than silently replacing a command byte with '?'.
export function encodeText(text: string, encoding: TextEncoding): Uint8Array {
  if (encoding === "utf-8") return new TextEncoder().encode(text);
  if (encoding === "gbk" && !gbkMap) {
    const map = new Map<string, number[]>();
    const decoder = new TextDecoder("gbk", { fatal: true });
    for (let lead = 0x81; lead <= 0xfe; lead++) {
      for (let trail = 0x40; trail <= 0xfe; trail++) {
        if (trail === 0x7f) continue;
        try {
          const character = decoder.decode(new Uint8Array([lead, trail]));
          if ([...character].length === 1 && !map.has(character)) map.set(character, [lead, trail]);
        } catch { /* Unassigned code point. */ }
      }
    }
    map.set("€", [0x80]);
    gbkMap = map;
  }
  const bytes: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (code <= 0x7f) bytes.push(code);
    else {
      const encoded = encoding === "gbk" ? gbkMap?.get(character) : undefined;
      if (!encoded) throw new Error(t("{p0} cannot encode {p1}; choose UTF-8 or Hex", { p0: String(encoding.toUpperCase()), p1: String(character) }));
      bytes.push(...encoded);
    }
  }
  return new Uint8Array(bytes);
}

export function decodeText(bytes: Uint8Array, encoding: TextEncoding): string {
  if (encoding === "ascii" && bytes.some(byte => byte > 0x7f)) throw new Error(t("ASCII cannot decode bytes above 7F"));
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

export function hexBytes(hex: string): Uint8Array {
  const normalized = appendHexChecksum(hex, "none");
  return normalized ? new Uint8Array(normalized.split(" ").map(byte => Number.parseInt(byte, 16))) : new Uint8Array();
}
export function fullHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(" ");
}
export function commandBytes(command: QuickCommand, encoding: TextEncoding, checksum: HexChecksum = "none", range?: ChecksumRange): Uint8Array {
  return command.mode === "text" ? encodeText(appendLineEnding(command.payload, command.lineEnding), encoding)
    : hexBytes(appendHexChecksum(command.payload, checksum, range));
}

export const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
export const MAX_SEND_FILE_BYTES = 64 * 1024 * 1024;
export class RawCapture {
  private chunks: Uint8Array<ArrayBuffer>[] = [];
  bytes = 0;
  active = false;
  reason = t("Not started");
  readonly limit: number;
  constructor(limit = MAX_CAPTURE_BYTES) { this.limit = limit; }
  start() { this.chunks = []; this.bytes = 0; this.reason = t("Recording"); this.active = true; }
  stop(reason = t("Stopped")) { if (this.active) { this.active = false; this.reason = reason; } }
  add(bytes: Uint8Array, history = false) {
    if (!this.active) return;
    if (history) { this.stop(t("Possible historical data received; recording stopped")); return; }
    if (this.bytes + bytes.byteLength > this.limit) { this.stop(t("Capacity reached; oversized packet was not saved")); return; }
    let offset = 0;
    while (offset < bytes.length) {
      const position = this.bytes % 65536;
      if (position === 0) this.chunks.push(new Uint8Array(Math.min(65536, this.limit - this.bytes)));
      const chunk = this.chunks[this.chunks.length - 1]!;
      const count = Math.min(chunk.length - position, bytes.length - offset);
      chunk.set(bytes.subarray(offset, offset + count), position);
      offset += count;
      this.bytes += count;
    }
  }
  blob() {
    return new Blob(this.chunks.map((chunk, index) => index === this.chunks.length - 1
      ? chunk.subarray(0, this.bytes - index * 65536) : chunk), { type: "application/octet-stream" });
  }
}

export interface SerialJobContext {
  signal: AbortSignal;
  write(bytes: Uint8Array): Promise<void>;
  pause(ms: number): Promise<void>;
}
export type RunSerialJob = (name: string, task: (context: SerialJobContext) => Promise<void>) => Promise<void>;
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); signal.removeEventListener("abort", aborted); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, ms);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

export interface WorkspaceBackup { format: "serialhub-workspace"; version: 1; commands: QuickCommand[]; profiles: ConnectionProfile[] }
export function workspaceBackup(commands: QuickCommand[], profiles: ConnectionProfile[]): string {
  // Explicit allowlist: credentials, arbitrary properties, and active sessions never leave memory.
  return JSON.stringify({ format: "serialhub-workspace", version: 1,
    commands: commands.map(({ id, name, mode, payload, lineEnding, enabled, delayMs }) => ({ id, name, mode, payload, lineEnding, enabled, delayMs })),
    profiles: profiles.map(({ id, name, host, port, protocol }) => ({ id, name, host, port, protocol })),
  }, null, 2);
}
export function parseWorkspaceBackup(text: string): WorkspaceBackup {
  if (text.length > 1024 * 1024) throw new Error(t("Settings file must not exceed 1 MiB"));
  const value = JSON.parse(text);
  if (!value || value.format !== "serialhub-workspace" || value.version !== 1 || !Array.isArray(value.commands)
      || !Array.isArray(value.profiles) || value.commands.length > 200 || value.profiles.length > 50) throw new Error(t("Invalid settings format or count (max. 200 commands, 50 profiles)"));
  const commands: QuickCommand[] = value.commands.map((item: QuickCommand, index: number) => {
    if (!item || typeof item.name !== "string" || !item.name.trim() || item.name.length > 128
        || typeof item.payload !== "string" || !item.payload.length || item.payload.length > 65536
        || !["text", "hex"].includes(item.mode) || !["none", "lf", "cr", "crlf"].includes(item.lineEnding)) throw new Error(t("Command {p0} has an invalid format", { p0: String(index + 1) }));
    if ((item.enabled !== undefined && typeof item.enabled !== "boolean") || (item.delayMs !== undefined && (!Number.isInteger(item.delayMs) || item.delayMs < 50 || item.delayMs > 60000))) throw new Error(t("Invalid sequence settings"));
    if (item.mode === "hex") hexBytes(item.payload);
    return { id: `import-command-${index}`, name: item.name, mode: item.mode, payload: item.payload, lineEnding: item.lineEnding, ...(item.enabled !== undefined ? { enabled: item.enabled } : {}), ...(item.delayMs !== undefined ? { delayMs: item.delayMs } : {}) };
  });
  const profiles: ConnectionProfile[] = value.profiles.map((item: ConnectionProfile, index: number) => {
    if (!item || typeof item.name !== "string" || !item.name.trim() || item.name.length > 128) throw new Error(t("Invalid connection profile name"));
    const cfg = validateConnection(item);
    return { id: `import-profile-${index}`, name: item.name, ...cfg };
  });
  return { format: "serialhub-workspace", version: 1, commands, profiles };
}
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
