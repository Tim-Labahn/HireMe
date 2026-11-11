"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync(require.resolve("../app.js"), "utf8");
const parseCode = source.slice(source.indexOf("function isRecord("), source.indexOf("function parseFields("));
const helpers = source.slice(source.indexOf("function stylesForText("), source.indexOf("function editable("));
const { parseFormat, stylesForText, runsFromStyles, formattedHtml } = new Function(
  "escapeHtml", "resolve",
  `${parseCode}\n${helpers}\nreturn { parseFormat, stylesForText, runsFromStyles, formattedHtml };`
)(
  value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]),
  value => value.replace("{company}", "Beispiel GmbH")
);

test("Formatierungsbereiche werden validiert und kopiert", () => {
  const format = { body: [{ start: 0, end: 4, bold: true, italic: false, size: 18, color: "#AABBCC" }] };
  assert.deepEqual(parseFormat(format, { body: "Text" }, ["body"]), { body: [{ start: 0, end: 4, bold: true, italic: false, size: 18, color: "#aabbcc" }] });
  assert.throws(() => parseFormat({ body: [{ start: 0, end: 5 }] }, { body: "Text" }, ["body"]));
  assert.throws(() => parseFormat({ body: [{ start: 0, end: 1, color: "red" }] }, { body: "Text" }, ["body"]));
  assert.throws(() => parseFormat({ body: [{ start: 0, end: 3 }, { start: 2, end: 4 }] }, { body: "Text" }, ["body"]));
});

test("Formatierungsbereiche bleiben beim Umwandeln erhalten", () => {
  const runs = [{ start: 6, end: 10, bold: true }];
  assert.deepEqual(runsFromStyles(stylesForText("Hallo Welt", runs)), runs);
});

test("Darstellung ersetzt Platzhalter und maskiert Text", () => {
  assert.equal(formattedHtml("Hallo {company} <x>", [{ start: 6, end: 15, italic: true }]), 'Hallo <span style="font-style:italic">Beispiel GmbH</span> &lt;x&gt;');
  assert.equal(formattedHtml("{company}", [{ start: 0, end: 9, bold: false }], false), '<span style="font-weight:normal">{company}</span>');
});
