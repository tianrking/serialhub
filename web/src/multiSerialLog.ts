/** Bounded recent display, independent of React and WebSocket packet boundaries. */
export type PanelEntry = {
  id: number;
  time: number;
  kind: "rx" | "tx" | "sys" | "err";
  text: string;
  truncated: boolean;
};
export type PanelDisplay = "text" | "hex";
export const PANEL_LOG_LIMIT = 400;
const MAX_LINE = 2048;
const HEX_PREVIEW = 128;

export class MultiSerialLog {
  private text: PanelEntry[] = [];
  private hex: PanelEntry[] = [];
  private partial: PanelEntry | null = null;
  private decoder = new TextDecoder("utf-8");
  private skipLF = false;
  private sequence = 0;
  rxBytes = 0;
  discarded = 0;

  readonly capacity: number;
  constructor(capacity = PANEL_LOG_LIMIT) {
    this.capacity = capacity;
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new RangeError("Invalid capacity");
  }
  resetDecoder(encoding = "utf-8") {
    this.decoder = new TextDecoder(encoding);
    this.partial = null;
    this.skipLF = false;
  }
  private append(rows: PanelEntry[], entry: PanelEntry) {
    rows.push(entry);
    if (rows.length > this.capacity) {
      rows.shift();
      this.discarded++;
    }
  }
  receive(bytes: Uint8Array, time = Date.now()) {
    this.rxBytes += bytes.byteLength;
    const hex = Array.from(bytes.subarray(0, HEX_PREVIEW), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(" ");
    this.append(this.hex, {
      id: ++this.sequence,
      time,
      kind: "rx",
      text: hex,
      truncated: bytes.length > HEX_PREVIEW,
    });
    for (const character of this.decoder.decode(bytes, { stream: true })) {
      if (this.skipLF && character === "\n") {
        this.skipLF = false;
        continue;
      }
      this.skipLF = character === "\r";
      if (!this.partial) {
        this.partial = {
          id: ++this.sequence,
          time,
          kind: "rx",
          text: "",
          truncated: false,
        };
        this.append(this.text, this.partial);
      }
      if (character === "\r" || character === "\n") this.partial = null;
      else if (this.partial.text.length + character.length <= MAX_LINE)
        this.partial.text += character;
      else this.partial.truncated = true;
    }
  }
  notice(kind: "tx" | "sys" | "err", text: string, hex = text) {
    this.partial = null;
    const entry = {
      id: ++this.sequence,
      time: Date.now(),
      kind,
      text: text.slice(0, MAX_LINE),
      truncated: text.length > MAX_LINE,
    };
    this.append(this.text, entry);
    this.append(this.hex, {
      ...entry,
      text: hex.slice(0, MAX_LINE),
      truncated: hex.length > MAX_LINE,
    });
  }
  snapshot(display: PanelDisplay): PanelEntry[] {
    // Copies keep paused snapshots immutable while the live store continues.
    return (display === "text" ? this.text : this.hex).map((entry) => ({
      ...entry,
    }));
  }
  clear() {
    this.text = [];
    this.hex = [];
    this.partial = null;
    this.skipLF = false;
    this.discarded = 0;
    // RX count is session observation, independent of clearing the display.
    this.decoder.decode();
  }
}
