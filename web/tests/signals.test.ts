import assert from "node:assert/strict";
import test from "node:test";
import { axisTick, calibrated, defaultChannel, envelope, scopePoints, findTrigger, histogram, plotPath, spectrum, statistics, type SignalSample } from "../src/signals/math.ts";
import { DEFAULT_BINARY, DEFAULT_IMAGE, imageRgba, SignalStore } from "../src/signals/store.ts";
import { defaultSettings, exportCsv, importCsv, validateSettings } from "../src/signals/files.ts";
import { parseFireWater, parseJustFloat } from "../src/protocolUtils.ts";
const sample = (index: number, ...values: number[]): SignalSample => ({ index, receivedAt: 1000 + index, values });
const utf8 = (text: string) => new TextEncoder().encode(text);
const close = (a: number, b: number, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test("FFT identifies two known tones and preserves their physical amplitudes", () => {
  const input = Array.from({ length: 1024 }, (_, index) => sample(index, 4 + 2 * Math.sin(2 * Math.PI * 64 * index / 1024) + .5 * Math.sin(2 * Math.PI * 128 * index / 1024)));
  for (const window of ["hann", "rectangular"] as const) {
    const result = spectrum(input, 0, defaultChannel(0), 1024, 1024, window);
    assert.equal(result.peakFrequency, 64); close(result.amplitudes[64]!, 2, .001); close(result.amplitudes[128]!, .5, .001);
    close(result.amplitudes[0]!, 0, .00001); assert.equal(result.resolution, 1);
  }
});
test("FFT has correct DC/Nyquist scaling, calibration, and missing-data rejection", () => {
  const config = { ...defaultChannel(0), gain: 2, offset: 3 };
  const dc = Array.from({ length: 256 }, (_, index) => sample(index, 1));
  const result = spectrum(dc, 0, config, 256, 256, "rectangular", false);
  assert.equal(result.peakFrequency, 0); close(result.amplitudes[0]!, 5);
  const nyquist = spectrum(Array.from({ length: 256 }, (_, index) => sample(index, index % 2 ? -1 : 1)), 0, defaultChannel(0), 256, 256, "rectangular");
  close(nyquist.amplitudes[128]!, 1);
  assert.throws(() => spectrum(dc.slice(1), 0, config, 256, 256, "hann"), /还需/);
  assert.throws(() => spectrum(dc, 0, config, 0, 256, "hann"), /采样率/);
  assert.throws(() => spectrum(dc, 0, config, 256, 255, "hann"), /2 次幂/);
  assert.throws(() => spectrum(dc.map((row, index) => index === 20 ? sample(index, NaN) : row), 0, config, 256, 256, "hann"), /缺失/);
  assert.throws(() => spectrum(dc.map((row, index) => index === 20 ? sample(index + .5, 1) : row), 0, config, 256, 256, "hann"), /缺失/);
});
test("statistics remain stable for a small ripple over a large offset", () => {
  const result = statistics([1e9 - 1, 1e9, 1e9 + 1, NaN, Infinity]);
  assert.equal(result.count, 3); assert.equal(result.mean, 1e9); assert.equal(result.peakToPeak, 2);
  assert.ok(Number.isFinite(result.rms)); assert.equal(histogram([1, 2, NaN, 2]).counts.reduce((a, b) => a + b, 0), 3);
  assert.equal(calibrated(sample(0, 4), 0, { ...defaultChannel(0), gain: 2, offset: -1 }), 7);
});
test("display reduction retains impulse peaks and every gap without breaking XY loops", () => {
  const points = Array.from({ length: 2000 }, (_, x) => ({ x, y: x === 1001 ? 999 : x % 17 === 0 ? NaN : Math.sin(x) }));
  const reduced = envelope(points, 30);
  assert.ok(reduced.some(point => point.y === 999));
  assert.equal(reduced.filter(point => Number.isNaN(point.y)).length, points.filter(point => Number.isNaN(point.y)).length);
  assert.ok(reduced.length < points.length);
  const path = plotPath([{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }], value => value, value => value);
  assert.equal(path.match(/M/g)?.length, 1); assert.equal(path.match(/L/g)?.length, 4);
});
test("edge trigger uses future contiguous samples and rejects crossings through gaps", () => {
  const data = [sample(0, -1), sample(1, 1), sample(2, NaN), sample(3, -1), sample(5, 1), sample(6, -1)];
  assert.equal(findTrigger(data, 0, 0, true, -1, defaultChannel(0)), 1);
  assert.equal(findTrigger(data, 0, 0, true, 1, defaultChannel(0)), null);
  assert.equal(findTrigger(data, 0, 0, false, 1, defaultChannel(0)), 6);
});
test("FireWater and JustFloat preserve invalid channel positions", () => {
  assert.deepEqual(parseFireWater("imu:1,,3\nimu:4,bad,6\n").samples.map(row => row.values), [[1, NaN, 3], [4, NaN, 6]]);
  const bytes = new Uint8Array(16); const view = new DataView(bytes.buffer);
  [1, NaN, 3].forEach((value, index) => view.setFloat32(index * 4, value, true)); bytes.set([0, 0, 128, 127], 12);
  assert.deepEqual(parseJustFloat(new Uint8Array(), bytes).samples[0]?.values, [1, NaN, 3]);
  assert.ok(parseFireWater("x".repeat(70000)).remainder.length <= 65536);
});
test("bounded signal store batches updates, evicts in order, and keeps timestamps", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const store = new SignalStore(3); store.setProtocol("firewater"); let changes = 0;
  store.subscribe(() => changes++);
  for (let index = 0; index < 10; index++) store.feed(utf8(`imu:${index},${-index}\n`), false, 3000 + index);
  assert.equal(changes, 0); context.mock.timers.runAll();
  assert.equal(changes, 1); assert.equal(store.getSnapshot().total, 10); assert.equal(store.getSnapshot().evicted, 7);
  assert.deepEqual(store.getSnapshot().samples.map(row => row.values[0]), [7, 8, 9]);
  assert.equal(store.getSnapshot().samples[0]?.receivedAt, 3007); store.dispose();
});
test("streaming decoders are invariant across every byte boundary", () => {
  for (const protocol of ["firewater", "justfloat"] as const) {
    let bytes: Uint8Array;
    if (protocol === "firewater") bytes = utf8("温度:1.5,2\n温度:3,-4\n");
    else { bytes = new Uint8Array(24); const view = new DataView(bytes.buffer); [1.5, 2].forEach((value, i) => view.setFloat32(i * 4, value, true)); bytes.set([0, 0, 128, 127], 8); [3, -4].forEach((value, i) => view.setFloat32(12 + i * 4, value, true)); bytes.set([0, 0, 128, 127], 20); }
    for (let split = 0; split <= bytes.length; split++) {
      const store = new SignalStore(); store.setProtocol(protocol); store.feed(bytes.subarray(0, split)); store.feed(bytes.subarray(split)); store.flush();
      assert.deepEqual(store.getSnapshot().samples.map(row => row.values), [[1.5, 2], [3, -4]], `${protocol} split ${split}`); store.dispose();
    }
  }
});
test("an oversized incomplete line is discarded until a newline, never parsed as a numeric suffix", () => {
  const store = new SignalStore(); store.setProtocol("firewater");
  store.feed(utf8("x".repeat(70000))); store.feed(utf8("123,456\nimu:7,8\n")); store.flush();
  const samples = store.getSnapshot().samples;
  assert.equal(samples.length, 2); assert.ok(Number.isNaN(samples[0]!.values[0])); assert.deepEqual(samples[1]?.values, [7, 8]); store.dispose();
});
test("custom binary framing resynchronizes across chunks and preserves gaps", () => {
  const store = new SignalStore(); store.configure({ type: "int16", channels: 2, littleEndian: false, header: "aa 55" }, DEFAULT_IMAGE); store.setProtocol("binary");
  store.feed(Uint8Array.of(0xaa, 0x55, 0, 1, 0xff, 0xfe)); store.feed(Uint8Array.of(0x99)); store.feed(Uint8Array.of(0xaa)); store.feed(Uint8Array.of(0x55, 0, 3, 0, 4)); store.flush();
  const data = store.getSnapshot().samples;
  assert.deepEqual(data[0]?.values, [1, -2]); assert.ok(data.some(row => Number.isNaN(row.values[0]))); assert.deepEqual(data.at(-1)?.values, [3, 4]); store.dispose();
});
test("image framing decodes exact RGB565 colors and retains only the latest complete frame", () => {
  const store = new SignalStore(); store.configure(DEFAULT_BINARY, { width: 2, height: 1, format: "rgb565le", header: "aa" }); store.setProtocol("image");
  store.feed(Uint8Array.of(0xaa, 0, 0xf8, 0xe0)); store.feed(Uint8Array.of(7)); store.flush();
  const image = store.getSnapshot().image!; assert.equal(image.count, 1);
  assert.deepEqual([...imageRgba(image)], [255, 0, 0, 255, 0, 255, 0, 255]);
  store.feed(Uint8Array.of(0xaa, 0x1f, 0, 0xff, 0xff)); store.flush(); assert.equal(store.getSnapshot().image?.count, 2);
  assert.deepEqual([...imageRgba(store.getSnapshot().image!)], [0, 0, 255, 255, 255, 255, 255, 255]); store.dispose();
});
test("CSV round trips raw values, missing positions, sparse indices, and safe headers", () => {
  const settings = defaultSettings(); settings.channels[0] = { ...settings.channels[0]!, name: '=HYPERLINK("bad")', gain: 20 };
  const data = [sample(10, 1, NaN, 3), sample(12, 4, 5, 6)];
  const csv = exportCsv(data, settings.channels, 250);
  assert.match(csv, /"'=HYPERLINK/);
  const parsed = importCsv(csv); assert.equal(parsed.sampleRate, 250); assert.deepEqual(parsed.samples, data);
  const store = new SignalStore(); store.replay(parsed.samples); store.feed(utf8("1,2,3\n")); store.flush();
  assert.equal(store.getSnapshot().source, "replay"); assert.deepEqual(store.getSnapshot().samples, data);
  store.setProtocol("justfloat"); assert.deepEqual(store.getSnapshot().samples, data); store.dispose();
  assert.throws(() => importCsv("a,b\n1,2\n3\n"), /通道数/);
  assert.throws(() => importCsv("a,b\n1,not-a-number\n"), /非法数值/);
  assert.throws(() => importCsv("#no data\n"), /没有采样/);
});
test("instrument configuration rejects invalid framing, scales, and unsupported schema fields", () => {
  const settings = defaultSettings(); assert.deepEqual(validateSettings(settings), settings);
  assert.throws(() => validateSettings({ ...settings, sampleRate: NaN }));
  assert.throws(() => validateSettings({ ...settings, image: { ...settings.image, width: 1024 } }));
  assert.throws(() => validateSettings({ ...settings, binary: { ...settings.binary, channels: 65 } }));
  assert.throws(() => validateSettings({ ...settings, binary: { ...settings.binary, header: "zz" } }));
  assert.throws(() => validateSettings({ ...settings, channels: settings.channels.map(channel => ({ ...channel, visible: true })) }), /16 条曲线/);
  settings.channels[0]!.max = settings.channels[0]!.min; assert.throws(() => validateSettings(settings));
});

test("CSV infers a uniform time base and rejects falsely uniform spectral inputs", () => {
  const header = "sample_index,time_s,received_at_ms,CH0\n";
  const parsed = importCsv(header + "10,0,0,1\n11,.002,0,2\n12,.004,0,3\n");
  assert.equal(parsed.sampleRate, 500);
  assert.throws(() => importCsv(header + "10,0,0,1\n11,.002,0,2\n12,.007,0,3\n"), /均匀采样/);
  assert.throws(() => importCsv("# sample_rate_hz=1000\n" + header + "0,0,0,1\n1,.002,0,2\n"), /均匀采样/);
});

test("replay survives instrument reconfiguration and validated settings strip unknown fields", () => {
  const store = new SignalStore(); store.replay([sample(20, 1), sample(21, 2)]);
  store.configure({ ...DEFAULT_BINARY, header: "aa" }, DEFAULT_IMAGE);
  assert.deepEqual(store.getSnapshot().samples.map(row => row.index), [20, 21]); store.dispose();
  const validated = validateSettings({ ...defaultSettings(), binary: { ...DEFAULT_BINARY, token: "do-not-export" }, image: { ...DEFAULT_IMAGE, token: "do-not-export" } });
  assert.equal(JSON.stringify(validated).includes("do-not-export"), false);
  assert.throws(() => validateSettings({ ...defaultSettings(), binary: { ...DEFAULT_BINARY, type: "constructor" } }));
});

test("direct trace reduction bounds SVG vertices for a full cache while preserving extrema", () => {
  const data = Array.from({ length: 16384 }, (_, index) => sample(index, index === 12345 ? 1000 : Math.sin(index / 3)));
  const reduced = scopePoints(data, 0, defaultChannel(0), 1000);
  assert.ok(reduced.length < 1300); assert.ok(reduced.some(point => point.y === 1000));
  const gapped = data.map((row, index) => index === 3000 || index === 3002 ? sample(index, NaN) : row);
  assert.ok(scopePoints(gapped, 0, defaultChannel(0), 1000).filter(point => Number.isNaN(point.y)).length >= 2);
});


test("axis labels distinguish adjacent ticks in a narrow time window", () => {
  const labels = Array.from({ length: 9 }, (_, index) => axisTick(17.25 + index * .03125, .03125));
  assert.equal(new Set(labels).size, 9);
  assert.equal(axisTick(-.00001, .8), "0");
  assert.notEqual(axisTick(1e-9, 1e-10), axisTick(1.1e-9, 1e-10));
});
