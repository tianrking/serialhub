import assert from "node:assert/strict";
import test from "node:test";
import { MultiSerialLog } from "../src/multiSerialLog.ts";

test("multi-port log assembles UTF-8 and CRLF across independent WS chunks", () => {
  const log = new MultiSerialLog();
  const bytes = new TextEncoder().encode("板子 ready\r\nnext");
  log.receive(bytes.subarray(0, 2), 1);
  log.receive(bytes.subarray(2, 15), 2);
  log.receive(bytes.subarray(15), 3);
  assert.deepEqual(
    log.snapshot("text").map((row) => row.text),
    ["板子 ready", "next"],
  );
  const frozen = log.snapshot("text");
  log.receive(new TextEncoder().encode("-continued\n"));
  assert.equal(frozen[1].text, "next");
  assert.equal(log.snapshot("text")[1].text, "next-continued");
  assert.equal(log.rxBytes, bytes.length + "-continued\n".length);
});

test("multi-port log bounds long lines and bursts while hex keeps byte identity", () => {
  const log = new MultiSerialLog(3);
  const binary = new Uint8Array([0, 127, 128, 255]);
  log.receive(binary);
  assert.equal(log.snapshot("hex")[0].text, "00 7f 80 ff");
  log.clear();
  log.receive(new TextEncoder().encode("x".repeat(100_000)));
  assert.equal(log.snapshot("text")[0].text.length, 2048);
  assert.equal(log.snapshot("text")[0].truncated, true);
  for (let i = 0; i < 1000; i++)
    log.receive(new TextEncoder().encode(`\n${i}`));
  assert.equal(log.snapshot("text").length, 3);
  assert.deepEqual(
    log.snapshot("text").map((row) => row.text),
    ["997", "998", "999"],
  );
  assert.equal(log.snapshot("hex").length, 3);
});

test("clear and new device generations discard incomplete decoder state, not other logs", () => {
  const log = new MultiSerialLog();
  const other = new MultiSerialLog();
  other.receive(new TextEncoder().encode("other-port\n"));
  log.receive(new Uint8Array([0xe6, 0xb5]));
  log.clear();
  log.receive(new TextEncoder().encode("fresh"));
  assert.equal(log.snapshot("text")[0].text, "fresh");
  log.resetDecoder();
  log.notice("tx", "command", "63 6d 64");
  assert.equal(log.snapshot("hex").at(-1)?.text, "63 6d 64");
  assert.equal(other.snapshot("text")[0].text, "other-port");
});
