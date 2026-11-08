"use strict";

// Coordinates are in PDF points, with the origin at the bottom left.
const PdfImport = (() => {
  function rowsFromPages(pages) {
    const result = [];
    for (const page of pages) {
      const rows = [];
      for (const item of page.items) {
        if (typeof item.str !== "string" || !item.str.trim()) continue;
        const x = item.transform[4], y = item.transform[5];
        let row = rows.find(candidate => Math.abs(candidate.y - y) < 3);
        if (!row) { row = { y, items: [], page: page.number, pageWidth: page.width }; rows.push(row); }
        row.items.push({ x, end: x + item.width, text: item.str });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const row of rows) {
        row.items.sort((a, b) => a.x - b.x);
        row.cells = [];
        for (const item of row.items) {
          const previous = row.cells[row.cells.length - 1];
          if (!previous || item.x - previous.end > 30) row.cells.push({ x: item.x, end: item.end, text: item.text });
          else {
            const space = item.x - previous.end > 1 && !/\s$/.test(previous.text) && !/^[\s,.:;!?]/.test(item.text) ? " " : "";
            previous.text += space + item.text;
            previous.end = Math.max(previous.end, item.end);
          }
        }
        row.cells.forEach(cell => { cell.text = cell.text.trim(); });
        row.text = row.cells.map(cell => cell.text).join("  ");
        result.push(row);
      }
    }
    return result;
  }
  const clean = text => text.replace(/\s+/g, " ").trim();
  const isEmail = text => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
  const isPhone = text => /^[+()\d][\d\s/()-]{6,}$/.test(text);
  const isCity = text => /^\d{5}\s+\S/.test(text);
  const isStreet = text => /\d+[a-z]?(?:\s*[-/]\s*\d+)?$/i.test(text) && /[a-zäöüß]/i.test(text) && !isCity(text);
  const dateRange = text => /(?:\d{4}|\d{1,2}\.\d{1,2})/.test(text) && /[-–—]|(?:\bbis\b)|(?:\bheute\b)|(?:\bjetzt\b)/i.test(text);
  const isName = text => /^[A-ZÄÖÜ][a-zäöüß]+(?:[- ][A-ZÄÖÜ][a-zäöüß]+){1,3}$/.test(text);
  function assignName(profile, name) {
    const parts = clean(name).split(" ");
    if (parts.length >= 2) { profile.firstName = parts[0]; profile.lastName = parts.slice(1).join(" "); }
  }
  function contacts(rows, profile) {
    const cells = rows.flatMap(row => row.cells.map(cell => clean(cell.text)));
    if (rows[0] && isName(clean(rows[0].cells[0].text))) assignName(profile, rows[0].cells[0].text);
    profile.email = cells.find(isEmail) || "";
    profile.phone = cells.map(cell => cell.replace(/^kontaktdaten\s*/i, "")).find(isPhone) || "";
    profile.city = cells.find(isCity) || "";
    const cityIndex = cells.findIndex(isCity);
    profile.street = cityIndex > 0 && isStreet(cells[cityIndex - 1]) ? cells[cityIndex - 1] : "";
    if (!profile.street && profile.city) {
      const cityRow = rows.find(row => row.cells.some(cell => clean(cell.text) === profile.city));
      const cityCell = cityRow.cells.find(cell => clean(cell.text) === profile.city);
      const above = rows.filter(row => row.page === cityRow.page && row.y > cityRow.y && row.y - cityRow.y < 35);
      const street = above.flatMap(row => row.cells).find(cell => Math.abs(cell.x - cityCell.x) < 20 && isStreet(clean(cell.text)));
      if (street) profile.street = clean(street.text);
    }
    const websiteRow = rows.find(row => /^(websites?|websiten|homepage)$/i.test(row.cells[0].text));
    if (websiteRow) profile.website = websiteRow.cells.slice(1).map(cell => cell.text).join(" ");
  }
  function resume(rows) {
    const profile = {}, sections = [];
    contacts(rows, profile);
    let section = null, lastEntry = null;
    const personal = [];
    for (const row of rows.slice(1)) {
      const cells = row.cells, label = clean(cells[0].text), value = clean(cells.slice(1).map(cell => cell.text).join(" "));
      if (cells.length === 1 && /^(persönliche daten|berufserfahrung|berufliche erfahrung|praktika|praktika und berufliche erfahrung|schulische bildung|ausbildung|bildung|kenntnisse|fähigkeiten|qualifikationen|sprachen|interessen|hobbys?)$/i.test(label)) {
        section = { title: label, width: 100, entries: [] }; sections.push(section); lastEntry = null; continue;
      }
      if (!section) {
        if (/^(geburtsdatum|geburtsort|staatsangehörigkeit)$/i.test(label) && value) personal.push({ title: label, subtitle: "", date: "", description: value });
        continue;
      }
      if (cells.length > 1) {
        if (dateRange(label)) lastEntry = { title: value, subtitle: "", date: label, description: "" };
        else lastEntry = { title: label, subtitle: "", date: "", description: value };
        section.entries.push(lastEntry);
      } else if (lastEntry && !isName(label) && !/^\d{1,2}\.\s*[a-zäöü]+\s+\d{4}$/i.test(label)) {
        lastEntry.description = [lastEntry.description, label].filter(Boolean).join(" ");
      }
    }
    if (personal.length) {
      const existing = sections.find(item => /^persönliche daten$/i.test(item.title));
      if (existing) existing.entries.unshift(...personal);
      else sections.unshift({ title: "Persönliche Daten", width: 100, entries: personal });
    }
    return { profile, sections };
  }
  function parseDate(value) {
    const months = { januar: 1, februar: 2, märz: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12 };
    let match = value.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
    match = value.match(/(\d{1,2})\.\s*([a-zäöü]+)\s+(\d{4})/i);
    if (!match || !months[match[2].toLowerCase()]) return "";
    return `${match[3]}-${String(months[match[2].toLowerCase()]).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }
  function letter(rows) {
    const profile = {}, result = { recipient: "", place: "", date: "", subject: "", salutation: "", body: "", closing: "" };
    contacts(rows, profile);
    const subjectIndex = rows.findIndex(row => /^bewerbung\b/i.test(clean(row.cells[0].text)));
    const greetingIndex = rows.findIndex(row => /^(sehr geehrte|guten tag|liebe[rs]?\s)/i.test(clean(row.cells[0].text)));
    const closingIndex = rows.findIndex((row, i) => i > greetingIndex && /^(mit freundlichen grüßen|freundliche grüße|beste grüße|hochachtungsvoll)/i.test(clean(row.cells[0].text)));
    if (subjectIndex >= 0) result.subject = clean(rows[subjectIndex].cells[0].text);
    if (greetingIndex >= 0) result.salutation = clean(rows[greetingIndex].cells[0].text);
    if (closingIndex >= 0) result.closing = clean(rows[closingIndex].cells[0].text);
    if (greetingIndex >= 0) {
      const end = closingIndex >= 0 ? closingIndex : rows.length;
      const bodyRows = rows.slice(greetingIndex + 1, end);
      let previous = null;
      result.body = bodyRows.map(row => {
        const separator = !previous ? "" : previous.page !== row.page || previous.y - row.y > 18 ? "\n\n" : " ";
        previous = row;
        return separator + clean(row.cells.map(cell => cell.text).join(" "));
      }).join("");
    }
    const before = rows.slice(0, subjectIndex >= 0 ? subjectIndex : greetingIndex >= 0 ? greetingIndex : rows.length);
    const dateRow = before.find(row => parseDate(row.text));
    if (dateRow) {
      result.date = parseDate(dateRow.text);
      const dateText = dateRow.cells.find(cell => parseDate(cell.text)).text;
      const match = dateText.match(/^([^,]+),\s*\d/);
      if (match) result.place = clean(match[1]);
    }
    const leftCells = before.flatMap(row => row.cells.filter(cell => cell.x < row.pageWidth * 0.45).map(cell => clean(cell.text)));
    const postal = leftCells.findIndex((value, index) => isCity(value) && index > 0 && isStreet(leftCells[index - 1]));
    if (postal >= 0) {
      const start = Math.max(0, postal - 4);
      const recipient = leftCells.slice(start, postal + 1).filter(value => !value.includes(",") && !isName(value));
      result.recipient = recipient.join("\n");
    }
    return { profile, letter: result };
  }
  function detect(rows) {
    const text = rows.map(row => clean(row.text));
    const greeting = text.some(line => /^(sehr geehrte|guten tag|liebe[rs]?\s)/i.test(line));
    const subject = text.some(line => /^bewerbung\b/i.test(line));
    const closing = text.some(line => /^(mit freundlichen grüßen|freundliche grüße|beste grüße|hochachtungsvoll)/i.test(line));
    if (greeting && (subject || closing)) return "letter";
    if (resume(rows).sections.length) return "resume";
    return null;
  }
  return { rowsFromPages, resume, letter, detect };
})();

if (typeof module !== "undefined") module.exports = PdfImport;
