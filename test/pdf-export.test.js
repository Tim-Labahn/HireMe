"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const PDFLib = require("../vendor/export/pdf-lib.min.js");

const source = fs.readFileSync(require.resolve("../app.js"), "utf8");
const exportCode = source.slice(source.indexOf("const MM ="), source.indexOf("function downloadBlob"));
const pdfjsPromise = import("../vendor/pdfjs/pdf.mjs");

function makeState() {
  return {
    profile: { firstName: "Max", lastName: "Muster", headline: "", street: "", city: "", email: "", phone: "", website: "", photo: "" },
    letter: { recipient: "", place: "", date: "", subject: "", salutation: "", body: "", closing: "" },
    design: { template: "modern", color: "#5a50c8", font: "Arial", photoWidth: 32, photoHeight: 40 },
    extras: [], sections: [], portfolio: { title: "Arbeitsproben", entries: [] }
  };
}
function makeRenderer(state) {
  const fieldHasContent = field => Boolean(field.label.trim() || field.value.trim());
  const entryHasContent = entry => [entry.title, entry.subtitle, entry.date, entry.description].some(value => value.trim()) || (entry.fields || []).some(fieldHasContent);
  return new Function("PDFLib", "state", "resolve", "formattedDate", "fieldHasContent", "entryHasContent", `${exportCode}\nreturn {renderPdf, renderPdfLayout};`)(
    PDFLib, state, value => value, value => value, fieldHasContent, entryHasContent
  );
}
async function exportPages(state, type) {
  const bytes = await makeRenderer(state).renderPdf(type);
  const pdfjs = await pdfjsPromise;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  try {
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i), content = await page.getTextContent();
      for (const item of content.items.filter(item => item.str.trim())) {
        const [,,,, x, y] = item.transform;
        assert.ok(x >= 0 && x + item.width <= page.view[2] + 1 && y >= 0 && y <= page.view[3], `Text außerhalb von Seite ${i}: ${item.str}`);
      }
      pages.push(content.items.map(item => item.str).join(" "));
    }
    return pages;
  } finally { await doc.destroy(); }
}

test("lange Lebenslaufeinträge werden vollständig auf Seiten mit wiederholtem Kopf verteilt", async () => {
  const state = makeState();
  const description = Array.from({ length: 180 }, (_, i) => `Zeile${i}`).join("\n");
  state.sections = [{ id: "s", title: "Erfahrung", width: 100, entries: [{ title: "Beruf", subtitle: "", date: "", description }] }];
  const pages = await exportPages(state, "resume");
  assert.ok(pages.length > 2);
  for (const [index, page] of pages.entries()) {
    assert.match(page, /Max Muster/);
    assert.ok(page.includes(`Seite ${index + 1} von ${pages.length}`));
    assert.match(page, /Zeile\d+/);
  }
  for (let i = 0; i < 180; i++) assert.match(pages.join(" "), new RegExp(`\\bZeile${i}\\b`));
});

test("Schriftanpassung ist begrenzt und spart nur bei knappem Überlauf eine Seite", async () => {
  const state = makeState(), renderer = makeRenderer(state);
  state.sections = [{ id: "s", title: "Erfahrung", width: 100, entries: [{ title: "Beruf", subtitle: "", date: "", description: "" }] }];
  let tested = false;
  for (let count = 30; count < 55; count++) {
    state.sections[0].entries[0].description = Array.from({ length: count }, (_, i) => `Zeile${i}`).join("\n");
    const normal = await renderer.renderPdfLayout("resume");
    const smaller = await renderer.renderPdfLayout("resume", 0.95);
    if (normal.pageCount > smaller.pageCount && normal.lastUsed / normal.lastCapacity < 0.08) {
      const actual = await PDFLib.PDFDocument.load(await renderer.renderPdf("resume"));
      assert.equal(actual.getPageCount(), smaller.pageCount);
      tested = true;
      break;
    }
  }
  assert.ok(tested, "Ein knapper Überlauf muss durch 5 % kleinere Schrift passen");
});

test("Schrift kann bei knapp freiem Platz um höchstens 5 % wachsen", async () => {
  const state = makeState(), renderer = makeRenderer(state);
  state.sections = [{ id: "s", title: "Erfahrung", width: 100, entries: [{ title: "Beruf", subtitle: "", date: "", description: "" }] }];
  for (let count = 25; count < 48; count++) {
    state.sections[0].entries[0].description = Array.from({ length: count }, (_, i) => `Zeile${i}`).join("\n");
    const normal = await renderer.renderPdfLayout("resume"), larger = await renderer.renderPdfLayout("resume", 1.05);
    if (normal.pageCount !== larger.pageCount || normal.lastUsed / normal.lastCapacity < 0.85 || normal.lastUsed / normal.lastCapacity > 0.95) continue;
    const pdfjs = await pdfjsPromise, doc = await pdfjs.getDocument({ data: new Uint8Array(await renderer.renderPdf("resume")), useSystemFonts: true }).promise;
    try {
      const text = await (await doc.getPage(1)).getTextContent();
      const item = text.items.find(value => value.str === "Zeile0");
      assert.ok(item);
      assert.ok(Math.abs(item.transform[0] - 10.5) < 0.01);
      return;
    } finally { await doc.destroy(); }
  }
  assert.fail("Kein Beispiel für eine Vergrößerung gefunden");
});

test("Anschreiben und Arbeitsproben behalten lange Texte und Seitenzahlen", async () => {
  const state = makeState();
  const lines = Array.from({ length: 120 }, (_, i) => `Inhalt${i}`).join("\n");
  state.letter.body = lines;
  state.portfolio.entries = [{ title: "Projekt", date: "", description: lines, link: "" }];
  for (const type of ["letter", "portfolio"]) {
    const pages = await exportPages(state, type);
    assert.ok(pages.length > 1, type);
    assert.ok(pages[0].includes(`Seite 1 von ${pages.length}`));
    for (let i = 0; i < 120; i++) assert.match(pages.join(" "), new RegExp(`\\bInhalt${i}\\b`), type);
  }
});

test("einseitige Dokumente erhalten keine Seitenzahl", async () => {
  const pages = await exportPages(makeState(), "resume");
  assert.equal(pages.length, 1);
  assert.doesNotMatch(pages[0], /Seite 1 von 1/);
});

test("lange Felder in zwei Spalten werden nicht abgeschnitten", async () => {
  const state = makeState();
  const entry = (prefix) => ({
    title: prefix, subtitle: "", date: "", description: "",
    fields: [{ label: "Zusatz", value: Array.from({ length: 100 }, (_, i) => `${prefix}${i}`).join("\n") }]
  });
  state.sections = [
    { id: "a", title: "Links", width: 50, entries: [entry("Links")] },
    { id: "b", title: "Rechts", width: 50, entries: [entry("Rechts")] }
  ];
  const pages = await exportPages(state, "resume");
  assert.ok(pages.length > 1);
  const text = pages.join(" ");
  for (const prefix of ["Links", "Rechts"]) {
    for (let i = 0; i < 100; i++) assert.match(text, new RegExp(`\\b${prefix}${i}\\b`));
  }
});
