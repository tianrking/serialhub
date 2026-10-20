import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DISPLAY, parseDisplayPreferences } from "../src/displayPreferences.ts";

test("untrusted display preferences cannot inject CSS or select invalid sizes", () => {
  for (const value of [null, undefined, "bad", [], { uiScale: "120", logSize: "28px; color:red" }, { uiScale: Infinity, logSize: NaN }, { uiScale: 170, logSize: 29 }, { uiScale: 75, logSize: 9 }, { uiScale: 111, logSize: 12.5 }]) {
    assert.deepEqual(parseDisplayPreferences(value), DEFAULT_DISPLAY);
  }
  assert.deepEqual(parseDisplayPreferences({ uiScale: 160, logSize: 28 }), { uiScale: 160, logSize: 28 });
  assert.deepEqual(parseDisplayPreferences({ uiScale: 80, logSize: 10 }), { uiScale: 80, logSize: 10 });
  assert.deepEqual(parseDisplayPreferences({ uiScale: 120, logSize: -1 }), { uiScale: 120, logSize: 12 });
});
