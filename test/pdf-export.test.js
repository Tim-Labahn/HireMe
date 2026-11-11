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
function makeRenderer(state, resolve = value => value) {
  const fieldHasContent = field => Boolean(field.label.trim() || field.value.trim());
  const entryHasContent = entry => [entry.title, entry.subtitle, entry.date, entry.description].some(value => value.trim()) || (entry.fields || []).some(fieldHasContent);
  return new Function("PDFLib", "state", "resolve", "formattedDate", "fieldHasContent", "entryHasContent", `${exportCode}\nreturn {renderPdf, renderPdfLayout};`)(
    PDFLib, state, resolve, value => value, fieldHasContent, entryHasContent
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

async function formattedItems(state, type, resolve) {
  const { bytes } = await makeRenderer(state, resolve).renderPdfLayout(type);
  const pdfjs = await pdfjsPromise;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  try {
    const items = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i), content = await page.getTextContent();
      await page.getOperatorList();
      for (const item of content.items.filter(item => item.str.trim())) {
        items.push({ ...item, font: page.commonObjs.get(item.fontName).name });
      }
    }
    return items;
  } finally { await doc.destroy(); }
}

test("Formatierungen und Platzhalter werden mit Schriftgröße und Schriftart exportiert", async () => {
  const state = makeState();
  state.letter.place = "Ort";
  state.letter.date = "2026-01-02";
  state.letter.subject = "Normal Kursiv";
  state.letter.body = "Hallo {name} Ende";
  state.letter.closing = "Gruss";
  state.letter.format = {
    place: [{ start: 0, end: 3, size: 15 }],
    subject: [{ start: 0, end: 6, bold: false }, { start: 7, end: 13, italic: true, size: 18 }],
    body: [{ start: 6, end: 12, bold: true, underline: true, color: "#cc0000", size: 20 }],
    closing: [{ start: 0, end: 5, italic: true }]
  };
  const items = await formattedItems(state, "letter", value => value.replace("{name}", "Welt"));
  const find = value => items.find(item => item.str.trim() === value);
  assert.match(find("Ort").font, /Helvetica/);
  assert.equal(find("Ort").transform[0], 15);
  assert.ok(items.some(item => item.str.includes("2026-01-02")));
  assert.match(find("Normal").font, /Helvetica$/);
  assert.match(find("Kursiv").font, /BoldOblique/);
  assert.equal(find("Kursiv").transform[0], 18);
  assert.match(find("Welt").font, /Bold/);
  assert.equal(find("Welt").transform[0], 20);
  assert.match(find("Gruss").font, /Oblique/);
});

test("Lebenslauf und Portfolio formatieren alle eigenen Textfelder einschließlich Zusätzen", async () => {
  const state = makeState();
  const mark = value => [{ start: 0, end: value.length, size: 17, italic: true }];
  const field = { label: "Feld", value: "Wert", format: { label: mark("Feld"), value: mark("Wert") } };
  state.extras = [{ label: "Extra", value: "Inhalt", format: { label: mark("Extra"), value: mark("Inhalt") } }];
  state.sections = [{ id: "s", title: "straße", width: 100, format: { title: mark("straße") }, entries: [{
    title: "Titel", date: "Datum", subtitle: "Untertitel", description: "Beschreibung", fields: [field],
    format: { title: mark("Titel"), date: mark("Datum"), subtitle: mark("Untertitel"), description: mark("Beschreibung") }
  }] }];
  state.portfolio = { title: "Portfolio", format: { title: mark("Portfolio") }, entries: [{
    title: "Projekt", date: "Jahr", description: "Werk", link: "Link",
    format: { title: mark("Projekt"), date: mark("Jahr"), description: mark("Werk"), link: mark("Link") }
  }] };
  for (const [type, values] of [["resume", ["Extra", "Inhalt", "STRASSE", "Titel", "Datum", "Untertitel", "Beschreibung", "Feld", "Wert"]], ["portfolio", ["Portfolio", "Projekt", "Jahr", "Werk", "Link"]]]) {
    const items = await formattedItems(state, type);
    for (const value of values) {
      const item = items.find(item => item.str.includes(value));
      assert.ok(item, `${type}: ${value}`);
      assert.equal(item.transform[0], 17, value);
      assert.match(item.font, /Oblique/, value);
    }
  }
});

test("lange formatierte Texte bleiben über mehrere Seiten vollständig", async () => {
  const state = makeState();
  const lines = Array.from({ length: 120 }, (_, i) => `Lang${i}`).join("\n");
  state.letter.body = lines;
  state.letter.format = { body: [{ start: 0, end: lines.length, bold: true, size: 24, underline: true }] };
  const pages = await exportPages(state, "letter");
  assert.ok(pages.length > 2);
  for (let i = 0; i < 120; i++) assert.match(pages.join(" "), new RegExp(`\\bLang${i}\\b`));
});

test("Farbe und Unterstreichung werden als PDF-Zeichenoperationen ausgegeben", async () => {
  const state = makeState(), pdfjs = await pdfjsPromise;
  state.letter.body = "Rot Schwarz";
  state.letter.format = { body: [
    { start: 0, end: 3, color: "#cc0000", underline: true },
    { start: 4, end: 11, underline: false }
  ] };
  const { bytes } = await makeRenderer(state).renderPdfLayout("letter");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  try {
    const ops = await (await doc.getPage(1)).getOperatorList();
    const strokes = ops.fnArray.filter(op => op === pdfjs.OPS.stroke).length;
    const colors = ops.fnArray.flatMap((op, i) => op === pdfjs.OPS.setFillRGBColor ? [ops.argsArray[i]] : []);
    assert.equal(strokes, 1);
    assert.ok(colors.some(args => args[0] === 204 && args[1] === 0 && args[2] === 0), JSON.stringify(colors));
  } finally { await doc.destroy(); }
});

test("UTF-16-Offsets und umgebrochene formatierte Zweispaltentexte", async () => {
  const state = makeState(), word = "X".repeat(900);
  const entry = {
    title: "😀Titel", subtitle: "", date: "", description: word,
    format: { title: [{ start: 2, end: 7, italic: true, size: 16 }], description: [{ start: 0, end: word.length, bold: true, size: 18 }] }
  };
  state.sections = [{ id: "s", title: "Links", width: 50, entries: [entry] }];
  const items = await formattedItems(state, "resume");
  const title = items.find(item => item.str.includes("Titel"));
  assert.equal(title.transform[0], 16);
  assert.match(title.font, /BoldOblique/);
  const pages = await exportPages(state, "resume");
  assert.ok(pages.length > 1);
  assert.equal((pages.join("").match(/X/g) || []).length, word.length);
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
