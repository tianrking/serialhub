import assert from "node:assert/strict";
import test from "node:test";
import { ConsoleLogStore } from "../src/workspace/consoleLogStore.ts";
const line = (text: string) => ({ ts: "12:00:00", kind: "rx" as const, text });

test("bursty acquisition publishes once and only subscribed terminal observers are notified", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const store = new ConsoleLogStore(3);
  const initial = store.getSnapshot();
  let updates = 0;
  const unsubscribe = store.subscribe(() => updates++);
  for (let index = 0; index < 10_000; index++) store.push(line(String(index)));
  assert.equal(store.getSnapshot(), initial);
  assert.equal(updates, 0);
  context.mock.timers.tick(50);
  assert.equal(updates, 1);
  assert.deepEqual(
    store.getSnapshot().map((row) => row.text),
    ["9997", "9998", "9999"],
  );
  const previous = store.getSnapshot();
  store.push(line("next"));
  context.mock.timers.tick(50);
  assert.equal(previous.at(-1)?.text, "9999");
  assert.equal(store.getSnapshot().at(-1)?.text, "next");
  unsubscribe();
  store.push(line("unsubscribed"));
  context.mock.timers.tick(50);
  assert.equal(updates, 2);
});

test("clear cancels buffered RX so cleared lines cannot reappear, while IDs remain distinct", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const store = new ConsoleLogStore();
  store.push(line("visible"));
  context.mock.timers.tick(50);
  const oldId = store.getSnapshot()[0].id;
  store.push(line("pending"));
  store.clear();
  context.mock.timers.tick(50);
  assert.deepEqual(store.getSnapshot(), []);
  store.push(line("fresh"));
  context.mock.timers.tick(50);
  assert.equal(store.getSnapshot()[0].text, "fresh");
  assert(store.getSnapshot()[0].id > oldId);
});

test("unmount cancels pending publication and StrictMode-style reuse stays usable", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const store = new ConsoleLogStore();
  let updates = 0;
  const unsubscribe = store.subscribe(() => updates++);
  store.push(line("unmounted"));
  unsubscribe();
  store.dispose();
  context.mock.timers.tick(50);
  assert.equal(updates, 0);
  store.subscribe(() => updates++);
  store.push(line("remounted"));
  context.mock.timers.tick(50);
  assert.equal(updates, 1);
  assert.deepEqual(
    store.getSnapshot().map((row) => row.text),
    ["remounted"],
  );
});
