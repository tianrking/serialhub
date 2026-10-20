import assert from "node:assert/strict";
import test from "node:test";
import type { HubSession } from "../src/useHubConnection.ts";
import { SerialOperationGate } from "../src/workspace/serialOperationGate.ts";

function session(epoch = 1): HubSession {
  const controller = new AbortController();
  return {
    cfg: { host: "127.0.0.1", port: 8787 },
    signal: controller.signal,
    abort: () => controller.abort(),
    deviceConnected: true,
    streamOpen: true,
    deviceEpoch: epoch,
  };
}
function fixture() {
  const active = session();
  const gate = new SerialOperationGate(
    (candidate) => candidate === active && !candidate.signal.aborted,
  );
  return { active, gate };
}

test("manual, scheduled and file writes share one synchronous admission gate", () => {
  const { active, gate } = fixture();
  assert.equal(gate.begin(active, false), null);
  active.streamOpen = false;
  assert.equal(gate.begin(active, true), null);
  active.streamOpen = true;
  active.deviceConnected = false;
  assert.equal(gate.begin(active, true), null);
  active.deviceConnected = true;
  const command = gate.begin(active, true)!;
  assert(command);
  assert.equal(gate.begin(active, true), null);
  assert.equal(gate.finish(command), true);
  assert(gate.begin(active, true));
});

test("a device epoch change rejects the old ACK and stale cleanup cannot unlock a newer write", () => {
  const { active, gate } = fixture();
  const old = gate.begin(active, true)!;
  active.deviceEpoch = 2;
  assert.equal(gate.isCurrent(old), false);
  const next = gate.begin(active, true)!;
  assert(next);
  assert.equal(old.signal.aborted, true);
  assert.equal(gate.finish(old), false);
  assert.equal(gate.begin(active, true), null);
  assert.equal(gate.isCurrent(next), true);
  assert.equal(gate.finish(next), true);
});

test("network reconnection with the same device epoch still isolates old operations", () => {
  let active = session();
  const gate = new SerialOperationGate(
    (candidate) => candidate === active && !candidate.signal.aborted,
  );
  const old = gate.begin(active, true)!;
  active = session();
  const next = gate.begin(active, true)!;
  assert.equal(old.signal.aborted, true);
  assert.equal(gate.isCurrent(old), false);
  assert.equal(gate.finish(old), false);
  assert.equal(gate.isCurrent(next), true);
});

test("session abort and stream loss invalidate completion before React effects run", () => {
  const { active, gate } = fixture();
  const operation = gate.begin(active, true)!;
  active.streamOpen = false;
  assert.equal(gate.isCurrent(operation), false);
  assert.equal(gate.begin(active, true), null);
  assert.equal(operation.signal.aborted, true);
  active.streamOpen = true;
  const next = gate.begin(active, true)!;
  active.abort();
  assert.equal(next.signal.aborted, true);
  assert.equal(gate.isCurrent(next), false);
  assert.equal(gate.begin(active, true), null);
});

test("a delayed completion after cancellation neither commits a result nor releases a newer action", async () => {
  const { active, gate } = fixture();
  const old = gate.begin(active, true)!;
  let resolve!: () => void;
  const ack = new Promise<void>((done) => {
    resolve = done;
  });
  let applied = false;
  const pending = (async () => {
    await ack;
    if (gate.isCurrent(old)) applied = true;
    gate.finish(old);
  })();
  gate.invalidate(new Error("disconnected"));
  const next = gate.begin(active, true)!;
  resolve();
  await pending;
  assert.equal(applied, false);
  assert.equal(gate.isCurrent(next), true);
  assert.equal(gate.begin(active, true), null);
});

test("TX fails closed until a safe nonnegative device epoch is known", () => {
  const { active, gate } = fixture();
  for (const epoch of [
    undefined,
    -1,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    active.deviceEpoch = epoch;
    assert.equal(gate.begin(active, true), null);
    assert.equal(gate.busy, false);
  }
  active.deviceEpoch = 0;
  assert(gate.begin(active, true));
});
