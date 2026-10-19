import assert from "node:assert/strict";
import test from "node:test";

import { appendHexChecksum } from "../src/checksumUtils.ts";

test("checksum helpers normalize hex and append the expected byte order", () => {
  assert.equal(appendHexChecksum("01 02 03", "none"), "01 02 03");
  assert.equal(appendHexChecksum("01,02,03", "sum8"), "01 02 03 06");
  assert.equal(appendHexChecksum("01 02 03", "xor8"), "01 02 03 00");
  assert.equal(appendHexChecksum("01 03 00 00 00 02", "crc16-modbus"), "01 03 00 00 00 02 c4 0b");
  assert.equal(appendHexChecksum("12 34", "crc16-ccitt"), "12 34 0e c9");
});

test("checksum helpers fail closed on malformed or empty input", () => {
  assert.throws(() => appendHexChecksum("abc", "none"));
  assert.throws(() => appendHexChecksum("not-hex", "none"));
  assert.throws(() => appendHexChecksum("", "sum8"));
});

test("CRC32 matches the standard check vector and ranges include only requested bytes", () => {
  assert.equal(appendHexChecksum("31 32 33 34 35 36 37 38 39", "crc32"), "31 32 33 34 35 36 37 38 39 26 39 f4 cb");
  assert.equal(appendHexChecksum("aa ff ff bb", "sum16", { start: 1, end: 3 }), "aa ff ff bb fe 01");
  assert.equal(appendHexChecksum("aa 01 02 bb", "sum8", { start: 1, end: 3 }), "aa 01 02 bb 03");
  assert.throws(() => appendHexChecksum("01 02", "crc32", { start: 1, end: 1 }));
  assert.throws(() => appendHexChecksum("01 02", "crc32", { start: 0, end: 3 }));
});
