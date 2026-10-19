import assert from "node:assert/strict";
import test from "node:test";
import { httpBase, validateConnection, wsUrl } from "../src/api/types.ts";
import { hubApi } from "../src/api/client.ts";

test("connection URLs retain legacy HTTP and support HTTPS and IPv6", () => {
  assert.equal(httpBase({ host: "127.0.0.1", port: 8787 }), "http://127.0.0.1:8787");
  assert.equal(wsUrl({ host: "hub.example.com", port: 443, protocol: "https" }), "wss://hub.example.com:443/v1/stream");
  assert.equal(httpBase({ host: "::1", port: 8787 }), "http://[::1]:8787");
  assert.equal(wsUrl({ host: "[::1]", port: 443, protocol: "https" }), "wss://[::1]:443/v1/stream");
  assert.deepEqual(validateConnection({ host: " localhost ", port: 8787 }), { host: "localhost", port: 8787, protocol: "http" });
});

test("invalid ports and host/URL confusion are rejected before connecting", () => {
  for (const host of ["", "http://localhost", "host/path", "user@host", "host name", "host#fragment", "host\\path"]) {
    assert.throws(() => validateConnection({ host, port: 8787 }));
  }
  for (const port of [0, -1, 65536, 1.5, NaN, Infinity]) {
    assert.throws(() => validateConnection({ host: "localhost", port }));
  }
});

test("HTTP failures surface the Hub reason instead of an opaque status", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response(
    JSON.stringify({ ok: false, error: "write lease is held by another client" }), { status: 409 },
  ));
  await assert.rejects(hubApi.writeText({ host: "localhost", port: 8787 }, "ping"), /409.*write lease is held/);
});

test("disconnect cancellation reaches fetch without retrying a mutation", async (context) => {
  const controller = new AbortController();
  let calls = 0;
  context.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    calls++;
    assert(init.signal);
    assert.equal(init.signal.aborted, true);
    throw new DOMException("Cancelled", "AbortError");
  });
  controller.abort();
  await assert.rejects(hubApi.writeText({ host: "localhost", port: 8787 }, "ping", { signal: controller.signal }), /Cancelled/);
  assert.equal(calls, 1);
});

test("write timeouts explicitly leave device outcome uncertain and never retry", async (context) => {
  context.mock.method(AbortSignal, "timeout", () => AbortSignal.abort());
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => { calls++; throw new DOMException("Timed out", "TimeoutError"); });
  await assert.rejects(hubApi.writeHex({ host: "localhost", port: 8787 }, "41"), /设备可能已执行/);
  assert.equal(calls, 1);
});

test("managed session URLs preserve API isolation and reject arbitrary base paths", () => {
  const basePath = "/sessions/12345678-1234-1234-1234-123456789abc";
  const cfg = validateConnection({host:"192.168.1.2",port:8787,basePath});
  assert.equal(httpBase(cfg),`http://192.168.1.2:8787${basePath}`);
  assert.equal(wsUrl(cfg),`ws://192.168.1.2:8787${basePath}/v1/stream`);
  for(const invalid of ["https://other.example/", "/sessions/../v1", "/v1", `${basePath}?token=secret`, `${basePath}/other`]) {
    assert.throws(()=>validateConnection({host:"localhost",port:8787,basePath:invalid}));
  }
});
