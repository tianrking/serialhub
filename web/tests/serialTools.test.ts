import assert from "node:assert/strict";
import test from "node:test";
import { RawCapture, abortableDelay, commandBytes, encodeText, decodeText, fullHex, hexBytes, parseWorkspaceBackup, workspaceBackup } from "../src/serialTools.ts";

test("UTF-8, strict ASCII, and GBK preserve actual command bytes", () => {
  assert.equal(fullHex(encodeText("中文", "utf-8")), "e4 b8 ad e6 96 87");
  assert.equal(fullHex(encodeText("中文€", "gbk")), "d6 d0 ce c4 80");
  assert.equal(fullHex(encodeText("AT\r\n", "ascii")), "41 54 0d 0a");
  assert.throws(() => encodeText("🙂", "gbk"), /无法编码/);
  assert.throws(() => encodeText("é", "ascii"), /无法编码/);
  assert.throws(() => decodeText(Uint8Array.of(0x80), "ascii"), /无法解码/);
  assert.equal(decodeText(Uint8Array.of(0xd6, 0xd0, 0xce, 0xc4), "gbk"), "中文");
  assert.deepEqual(commandBytes({ id: "x", name: "x", mode: "text", payload: "中文", lineEnding: "crlf" }, "gbk"), new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 13, 10]));
  assert.deepEqual(hexBytes("00 ff 0x7f"), new Uint8Array([0, 255, 127]));
  assert.throws(() => hexBytes("0"));
});

test("raw capture copies bytes exactly and stops before overflow or replay", async () => {
  const capture = new RawCapture(5);
  const bytes = new Uint8Array([0, 255, 13]);
  capture.start(); capture.add(bytes); bytes[0] = 45;
  capture.add(new Uint8Array([10, 128]));
  capture.add(new Uint8Array([1]));
  assert.equal(capture.bytes, 5); assert.equal(capture.active, false);
  assert.match(capture.reason, /容量上限/);
  assert.deepEqual(new Uint8Array(await capture.blob().arrayBuffer()), new Uint8Array([0, 255, 13, 10, 128]));
  capture.start(); capture.add(new Uint8Array([23]), true);
  assert.equal(capture.bytes, 0); assert.equal(capture.active, false);
  capture.start(); capture.stop("断线"); capture.add(new Uint8Array([1]));
  assert.equal(capture.bytes, 0); assert.equal(capture.reason, "断线");
});

test("backup validates the entire import and never serializes secrets", () => {
  const text = workspaceBackup([{ id: "cmd", name: "Read", mode: "hex", payload: "00 ff", lineEnding: "none", secret: "hidden" } as never],
    [{ id: "p", name: "Lab", host: "::1", port: 443, protocol: "https", bearer_token: "secret" } as never]);
  assert.equal(text.includes("secret"), false); assert.equal(text.includes("hidden"), false);
  const backup = parseWorkspaceBackup(text);
  assert.equal(backup.profiles[0]?.protocol, "https");
  assert.equal(backup.commands[0]?.payload, "00 ff");
  const badHex = JSON.parse(text); badHex.commands[0].payload = "xyz";
  assert.throws(() => parseWorkspaceBackup(JSON.stringify(badHex)));
  const badHost = JSON.parse(text); badHost.profiles[0].host = "https://bad.test/path";
  assert.throws(() => parseWorkspaceBackup(JSON.stringify(badHost)));
  assert.throws(() => parseWorkspaceBackup(JSON.stringify({ ...JSON.parse(text), version: 2 })));
  assert.throws(() => parseWorkspaceBackup("x".repeat(1024 * 1024 + 1)), /1 MiB/);
});

test("cancellation interrupts a delayed job and rejects an already stopped job", async () => {
  const controller = new AbortController();
  const waiting = abortableDelay(60000, controller.signal);
  controller.abort(new Error("stop"));
  await assert.rejects(waiting, /stop/);
  assert.throws(() => abortableDelay(0, controller.signal), /stop/);
  await abortableDelay(0, new AbortController().signal);
});

test("capture packs tiny packets into bounded slabs and crosses slab boundaries exactly", async () => {
  const capture = new RawCapture(131073);
  capture.start();
  for (let index = 0; index < 131073; index++) capture.add(Uint8Array.of(index & 255));
  capture.stop();
  const bytes = new Uint8Array(await capture.blob().arrayBuffer());
  assert.equal(bytes.length, 131073);
  for (let index = 0; index < bytes.length; index++) assert.equal(bytes[index], index & 255);
});
