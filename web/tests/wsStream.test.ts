import assert from "node:assert/strict";
import test from "node:test";

import { bytesToText, connectStream } from "../src/api/wsStream.ts";

test("UTF-8 text survives every possible WebSocket chunk boundary", () => {
  const text = "UART 串口🙂\r\n测试";
  const bytes = new TextEncoder().encode(text);
  for (let split = 0; split <= bytes.length; split++) {
    const decoder = new TextDecoder();
    const decoded = bytesToText(bytes.subarray(0, split), decoder)
      + bytesToText(bytes.subarray(split), decoder)
      + decoder.decode();
    assert.equal(decoded, text, `split=${split}`);
  }
  const decoder = new TextDecoder();
  assert.equal(
    Array.from(bytes, (byte) => bytesToText(Uint8Array.of(byte), decoder)).join("") + decoder.decode(),
    text,
  );
  assert.equal(bytesToText(new TextEncoder().encode("standalone")), "standalone");
});

test("Hub error text stays outside device RX and preserves first binary metadata", (context) => {
  class MockWebSocket {
    binaryType = "blob";
    onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
  }
  context.mock.method(globalThis, "WebSocket", MockWebSocket as unknown as typeof WebSocket);
  const received: { bytes: number[]; history: boolean }[] = [];
  const errors: string[] = [];
  const stream = connectStream({ host: "127.0.0.1", port: 8787 }, {
    onBytes: (data, meta) => received.push({ bytes: [...data], history: meta.isHistoryHint }),
    onServerError: (error) => errors.push(error),
  }) as unknown as MockWebSocket;
  assert.equal(stream.binaryType, "arraybuffer");
  stream.onmessage?.({ data: JSON.stringify({ type: "ohmyserial.error", ok: false, error: "write lease required" }) });
  stream.onmessage?.({ data: "non-JSON diagnostic" });
  assert.deepEqual(errors, ["write lease required", "non-JSON diagnostic"]);
  assert.deepEqual(received, []);
  stream.onmessage?.({ data: Uint8Array.of(0, 255).buffer });
  stream.onmessage?.({ data: Uint8Array.of(65).buffer });
  assert.deepEqual(received, [
    { bytes: [0, 255], history: true },
    { bytes: [65], history: false },
  ]);
});

test("live-only acknowledgement makes the first device packet recordable", context => {
  class MockWebSocket {
    binaryType = "blob";
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    url: string;
    constructor(url: string) { this.url = url; }
    onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  }
  context.mock.method(globalThis, "WebSocket", MockWebSocket as unknown as typeof WebSocket);
  const hints: boolean[] = [], errors: string[] = [];
  const stream = connectStream({ host: "localhost", port: 8787 }, {
    onBytes: (_, meta) => hints.push(meta.isHistoryHint), onServerError: error => errors.push(error),
  }, undefined, true) as unknown as MockWebSocket;
  assert.equal(stream.url, "ws://localhost:8787/v1/stream?live=true");
  stream.onmessage?.({ data: '{"type":"serialhub.stream","live_only":true}' });
  stream.onmessage?.({ data: Uint8Array.of(0, 255).buffer });
  assert.deepEqual(hints, [false]); assert.deepEqual(errors, []);
});
