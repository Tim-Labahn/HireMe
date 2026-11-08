"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const parser = require("../pdf-import.js");

function makeRows(lines) {
  const items = lines.flatMap(([y, ...cells]) => cells.map(([x, text]) => ({
    str: text, transform: [1, 0, 0, 1, x, y], width: text.length * 5
  })));
  return parser.rowsFromPages([{ number: 1, width: 595, items }]);
}

test("erkennt persönliche Daten und Lebenslaufabschnitte mit Zeiträumen", () => {
  const rows = makeRows([
    [780, [60, "Max Beispiel"]],
    [750, [60, "Kontaktdaten"], [250, "max@example.org"]],
    [720, [60, "Adresse"], [250, "Max Beispiel"]],
    [705, [250, "Musterstraße 1"]],
    [690, [250, "12345 Musterstadt"]],
    [670, [60, "Geburtsdatum"], [250, "01.01.2000"]],
    [600, [60, "Schulische Bildung"]],
    [570, [60, "2020 - 2024"], [250, "Ausbildung"]],
    [555, [250, "Abschluss"]]
  ]);
  const result = parser.resume(rows);
  assert.equal(parser.detect(rows), "resume");
  assert.equal(result.profile.email, "max@example.org");
  assert.equal(result.profile.street, "Musterstraße 1");
  assert.equal(result.sections[0].entries[0].title, "Geburtsdatum");
  assert.deepEqual(result.sections[1].entries[0], { title: "Ausbildung", subtitle: "", date: "2020 - 2024", description: "Abschluss" });
});

test("erkennt Empfänger, Datum und Absätze eines Anschreibens", () => {
  const rows = makeRows([
    [780, [60, "Max Beispiel"]],
    [715, [60, "Max Beispiel, Musterstraße 1, 12345 Musterstadt"]],
    [690, [60, "Firma Beispiel GmbH"]],
    [678, [60, "Firmenweg 2"]],
    [666, [60, "54321 Beispielstadt"]],
    [585, [370, "Musterstadt, 30. September 2026"]],
    [560, [60, "Bewerbung als Entwickler"]],
    [525, [60, "Sehr geehrte Damen und Herren,"]],
    [500, [60, "Erster Absatz."]],
    [475, [60, "Zweiter Absatz."]],
    [450, [60, "Mit freundlichen Grüßen"]]
  ]);
  const result = parser.letter(rows).letter;
  assert.equal(parser.detect(rows), "letter");
  assert.equal(result.recipient, "Firma Beispiel GmbH\nFirmenweg 2\n54321 Beispielstadt");
  assert.equal(result.date, "2026-09-30");
  assert.equal(result.place, "Musterstadt");
  assert.equal(result.body, "Erster Absatz.\n\nZweiter Absatz.");
  assert.equal(result.closing, "Mit freundlichen Grüßen");
});

test("behält alle Textzeilen für die manuelle Kontrolle", () => {
  const rows = makeRows([[700, [60, "Unbekanntes Format"]], [680, [60, "Noch eine Zeile"]]]);
  assert.equal(rows.map(row => row.text).join("\n"), "Unbekanntes Format\nNoch eine Zeile");
  assert.equal(parser.resume(rows).sections.length, 0);
  assert.equal(parser.detect(rows), null);
});
