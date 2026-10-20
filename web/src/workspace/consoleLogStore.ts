import { LogBuffer } from "../logBuffer.ts";

export interface LogLine {
  id: number;
  ts: string;
  kind: "rx" | "sys" | "tx" | "err";
  text: string;
  hex?: string;
}
export type LogInput = Omit<LogLine, "id" | "ts"> & { ts?: string };
export type PushLog = (line: LogInput) => void;

/** Only terminal subscribers rerender on RX; the workspace does not observe this store. */
export class ConsoleLogStore {
  private entries: readonly LogLine[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly buffer: LogBuffer<LogLine>;
  private readonly capacity: number;
  private sequence = 0;

  constructor(capacity = 2000) {
    this.capacity = capacity;
    this.buffer = new LogBuffer((batch) => {
      this.entries = [...this.entries, ...batch].slice(-this.capacity);
      this.emit();
    }, capacity);
  }
  readonly getSnapshot = () => this.entries;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  push(line: Omit<LogLine, "id">) {
    this.buffer.push({ ...line, id: ++this.sequence });
  }
  clear() {
    this.buffer.clear();
    if (!this.entries.length) return;
    this.entries = [];
    this.emit();
  }
  dispose() {
    this.buffer.clear();
  }
  private emit() {
    for (const listener of this.listeners) listener();
  }
}
