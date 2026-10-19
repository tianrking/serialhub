/** A bounded display queue: bursty RX must not copy the React log per packet. */
export class LogBuffer<T> {
  private readonly entries: (T | undefined)[];
  private head = 0;
  private count = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly onFlush: (batch: T[]) => void;
  private readonly delayMs: number;

  constructor(onFlush: (batch: T[]) => void, capacity = 2000, delayMs = 50) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError("Log capacity must be a positive integer");
    }
    this.entries = new Array(capacity);
    this.onFlush = onFlush;
    this.delayMs = delayMs;
  }

  push(entry: T): void {
    const index = (this.head + this.count) % this.entries.length;
    this.entries[index] = entry;
    if (this.count === this.entries.length) {
      this.head = (this.head + 1) % this.entries.length;
    } else {
      this.count++;
    }
    if (this.timer === undefined) {
      this.timer = setTimeout(() => this.flush(), this.delayMs);
    }
  }

  flush(): void {
    if (this.count === 0) return;
    const batch = Array.from(
      { length: this.count },
      (_, index) => this.entries[(this.head + index) % this.entries.length] as T,
    );
    this.clear();
    this.onFlush(batch);
  }

  clear(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.entries.fill(undefined);
    this.head = 0;
    this.count = 0;
  }
}
