import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { CATALOGS } from "../src/i18n/index.ts";

const keys = Object.keys(CATALOGS.en).sort();
const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
for (const [locale, messages] of Object.entries(CATALOGS)) {
  assert.deepEqual(Object.keys(messages).sort(), keys, `${locale}: missing or extra keys`);
  for (const [key, value] of Object.entries(messages)) {
    assert.ok(value.trim(), `${locale}: empty translation for ${key}`);
    assert.deepEqual(placeholders(value), placeholders(key), `${locale}: placeholder mismatch for ${key}`);
  }
}
const failures: string[] = [];
async function audit(directory: string) {
  for (const file of await readdir(directory, { withFileTypes: true })) {
    const name = path.join(directory, file.name);
    if (file.isDirectory()) { if (file.name !== "i18n") await audit(name); continue; }
    if (!/\.tsx?$/.test(file.name)) continue;
    const text = await readFile(name, "utf8"), source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      let literal = "";
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) literal = node.text;
      if (ts.isTemplateExpression(node)) literal = node.head.text + node.templateSpans.map(span => span.literal.text).join("");
      if (/\p{Script=Han}/u.test(literal)) {
        const location = source.getLineAndCharacterOfPosition(node.getStart(source));
        failures.push(`${name}:${location.line + 1}: untranslated UI literal ${literal.trim().slice(0, 90)}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
await audit(fileURLToPath(new URL("../src", import.meta.url)));
assert.deepEqual(failures, [], failures.join("\n"));
console.log(`i18n OK: ${keys.length} keys × ${Object.keys(CATALOGS).length} locales; placeholders match; no hardcoded Chinese UI literals`);
