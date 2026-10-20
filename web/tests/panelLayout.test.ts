import assert from "node:assert/strict";
import test from "node:test";
import {
  panelGrid,
  readPanelLayout,
  resizeTracks,
} from "../src/panelLayout.ts";

test("tiling fills a single page without fixed panel counts", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((n) => panelGrid(n, { mode: "auto", count: 2 })),
    [
      { rows: 1, columns: 1 },
      { rows: 1, columns: 2 },
      { rows: 2, columns: 2 },
      { rows: 2, columns: 2 },
      { rows: 2, columns: 3 },
      { rows: 2, columns: 3 },
    ],
  );
  for (const n of [7, 17, 101, 200]) {
    const { rows, columns } = panelGrid(n, { mode: "auto", count: 2 });
    assert.ok(rows * columns >= n);
    assert.ok(rows * columns - n < columns);
  }
  assert.deepEqual(panelGrid(6, { mode: "rows", count: 3 }), {
    rows: 3,
    columns: 2,
  });
  assert.deepEqual(panelGrid(6, { mode: "columns", count: 3 }), {
    rows: 2,
    columns: 3,
  });
  assert.deepEqual(panelGrid(4, { mode: "auto", count: 2 }, true), {
    rows: 4,
    columns: 1,
  });
});

test("invalid/obsolete layout preferences recover, dimensions never create empty excess tracks", () => {
  for (const text of [
    "4",
    "null",
    "{",
    '{"mode":"rows","count":0}',
    '{"mode":"columns","count":1.5}',
  ])
    assert.deepEqual(readPanelLayout(text), { mode: "auto", count: 2 });
  assert.deepEqual(readPanelLayout('{"mode":"columns","count":20}'), {
    mode: "columns",
    count: 20,
  });
  assert.deepEqual(panelGrid(3, { mode: "columns", count: 20 }), {
    rows: 1,
    columns: 3,
  });
});

test("resizing keeps adjacent tracks positive and conserves space without mutating the original", () => {
  const original = [1, 1, 1];
  assert.deepEqual(resizeTracks(original, 0, 0.5), [1.5, 0.5, 1]);
  assert.deepEqual(original, [1, 1, 1]);
  for (const delta of [-100, 100]) {
    const result = resizeTracks(original, 1, delta);
    assert.equal(
      result.reduce((a, b) => a + b),
      3,
    );
    assert.ok(result.every((n) => n >= 0.3));
  }
  assert.deepEqual(resizeTracks(original, 5, 1), original);
});
