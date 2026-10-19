import assert from "node:assert/strict";
import test from "node:test";

import { LogBuffer } from "../src/logBuffer.ts";

test("RX bursts flush once in order rather than once per packet", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const batches: number[][] = [];
  const buffer = new LogBuffer<number>((batch) => batches.push(batch));
  for (let value = 0; value < 1000; value++) buffer.push(value);
  context.mock.timers.tick(49);
  assert.equal(batches.length, 0);
  context.mock.timers.tick(1);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0], Array.from({ length: 1000 }, (_, index) => index));
  context.mock.timers.tick(100);
  assert.equal(batches.length, 1);
});

test("a stalled display retains only the newest bounded window across wraparound", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const batches: number[][] = [];
  const buffer = new LogBuffer<number>((batch) => batches.push(batch), 3);
  for (let value = 0; value < 10_000; value++) buffer.push(value);
  context.mock.timers.tick(50);
  assert.deepEqual(batches, [[9997, 9998, 9999]]);
  buffer.push(10_000);
  context.mock.timers.tick(50);
  assert.deepEqual(batches[1], [10_000]);
});

test("clearing or unmounting cancels pending data without preventing reuse", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const batches: string[][] = [];
  const buffer = new LogBuffer<string>((batch) => batches.push(batch));
  buffer.push("old");
  buffer.clear();
  context.mock.timers.tick(50);
  assert.deepEqual(batches, []);
  buffer.push("new");
  context.mock.timers.tick(50);
  assert.deepEqual(batches, [["new"]]);
});

test("explicit flush cancels the scheduled flush and accepts the next batch", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const batches: number[][] = [];
  const buffer = new LogBuffer<number>((batch) => batches.push(batch));
  buffer.push(1);
  buffer.flush();
  buffer.push(2);
  context.mock.timers.tick(50);
  assert.deepEqual(batches, [[1], [2]]);
});
