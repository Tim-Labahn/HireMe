"use strict";

const STORAGE_KEY = "bewerbungsatelier-v1";
const STORAGE_CHOICE_KEY = "hireme-storage-choice-v1";
const defaultState = () => ({
  profile: { firstName: "", lastName: "", headline: "", email: "", phone: "", street: "", city: "", website: "", photo: "" },
  letter: { recipient: "", place: "", date: "", subject: "", salutation: "Sehr geehrte Damen und Herren,", body: "", closing: "Mit freundlichen Grüßen" },
  recipientDetails: null,
  vars: { company: "", job: "" },
  extras: [],
  portfolio: { title: "Arbeitsproben", entries: [] },
  design: { template: "modern", color: "#5a50c8", font: "Arial", photoWidth: 32, photoHeight: 40 },
  sections: [
    { id: "experience", title: "Berufserfahrung", width: 100, entries: [] },
    { id: "education", title: "Ausbildung", width: 100, entries: [] },
    { id: "skills", title: "Kenntnisse", width: 100, entries: [] }
  ]
});
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const uid = () => `section-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
let state = defaultState(), activeDocument = "resume", draggedId = null, saveError = "", message = "", loadBlocked = false, storageMode = "temporary", hasStarted = false;
let pdfRows = null, pdfProposal = null;
const MAX_VERSIONS = 40;
let versions = [], snapshotTimer = null;
function takeSnapshot(label = "Bearbeitung") {
  clearTimeout(snapshotTimer);
  const json = JSON.stringify(state);
  if (versions.length && versions[0].json === json) return;
  versions.unshift({ time: new Date(), label, json });
  if (versions.length > MAX_VERSIONS) versions.length = MAX_VERSIONS;
}
function scheduleSnapshot() { clearTimeout(snapshotTimer); snapshotTimer = setTimeout(() => takeSnapshot(), 1500); }

function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function parseFormat(input, values, keys) {
  if (input === undefined) return undefined;
  if (!isRecord(input)) throw new Error("Ungültige Textformatierung.");
  const result = {};
  for (const [key, runs] of Object.entries(input)) {
    if (!keys.includes(key) || !Array.isArray(runs)) throw new Error("Ungültiges Formatierungsfeld.");
    let end = 0;
    result[key] = runs.map(run => {
      if (!isRecord(run) || !Number.isInteger(run.start) || !Number.isInteger(run.end) || run.start < end || run.end <= run.start || run.end > values[key].length) throw new Error("Ungültiger Formatierungsbereich.");
      const copy = { start: run.start, end: run.end };
      for (const [name, value] of Object.entries(run)) {
        if (name === "start" || name === "end") continue;
        if (["bold", "italic", "underline"].includes(name) && typeof value === "boolean") copy[name] = value;
        else if (name === "size" && Number.isInteger(value) && value >= 6 && value <= 36) copy.size = value;
        else if (name === "color" && typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) copy.color = value.toLowerCase();
        else throw new Error("Ungültiger Textstil.");
      }
      end = run.end;
      return copy;
    });
  }
  return result;
}
function copyFormat(input, output, keys) {
  const format = parseFormat(input.format, output, keys);
  if (format) output.format = format;
  return output;
}
function parseFields(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error("Ungültige eigene Felder.");
  return list.map(field => {
    if (!isRecord(field) || typeof field.label !== "string" || typeof field.value !== "string") throw new Error("Ungültiges eigenes Feld.");
    return copyFormat(field, { label: field.label, value: field.value }, ["label", "value"]);
  });
}
function parseState(data) {
  if (!isRecord(data) || !isRecord(data.profile) || !isRecord(data.letter) || !isRecord(data.design) || !Array.isArray(data.sections)) throw new Error("Die Datei enthält keine gültige Vorlage.");
  const defaults = defaultState();
  const strings = (input, shape) => Object.fromEntries(Object.keys(shape).map(key => {
    if (typeof shape[key] !== "string") return [key, shape[key]];
    if (typeof input[key] !== "string") throw new Error(`Ungültiges Feld: ${key}`);
    return [key, input[key]];
  }));
  const profile = strings(data.profile, defaults.profile);
  if (profile.photo && !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(profile.photo)) throw new Error("Das Fotoformat wird nicht unterstützt.");
  const letter = copyFormat(data.letter, strings(data.letter, defaults.letter), ["place", "subject", "body", "closing"]), design = strings(data.design, defaults.design);
  if (!["modern", "classic", "minimal"].includes(design.template) || !["Arial", "Georgia", "Verdana"].includes(design.font) || !/^#[0-9a-f]{6}$/i.test(design.color)) throw new Error("Ungültige Designeinstellungen.");
  for (const key of ["photoWidth", "photoHeight"]) {
    if (!Number.isFinite(data.design[key]) || data.design[key] < 15 || data.design[key] > 70) throw new Error("Ungültige Fotogröße.");
    design[key] = data.design[key];
  }
  const ids = new Set();
  const sections = data.sections.map(section => {
    if (!isRecord(section) || typeof section.id !== "string" || !section.id || ids.has(section.id) || typeof section.title !== "string" || ![50, 100].includes(section.width) || !Array.isArray(section.entries)) throw new Error("Ungültiger Lebenslaufabschnitt.");
    ids.add(section.id);
    return copyFormat(section, { id: section.id, title: section.title, width: section.width, entries: section.entries.map(entry => {
      if (!isRecord(entry)) throw new Error("Ungültiger Eintrag.");
      const result = strings(entry, { title: "", subtitle: "", date: "", description: "" });
      const fields = parseFields(entry.fields);
      if (fields.length) result.fields = fields;
      if (entry.rating !== undefined && entry.rating !== null) {
        if (!isRecord(entry.rating) || ![5, 10].includes(entry.rating.max) || !Number.isInteger(entry.rating.value) || entry.rating.value < 1 || entry.rating.value > entry.rating.max) throw new Error("Ungültige Bewertung.");
        result.rating = { max: entry.rating.max, value: entry.rating.value };
      }
      return copyFormat(entry, result, ["title", "subtitle", "date", "description"]);
    }) }, ["title"]);
  });
  let portfolio = defaults.portfolio;
  if (data.portfolio !== undefined) {
    if (!isRecord(data.portfolio) || typeof data.portfolio.title !== "string" || !Array.isArray(data.portfolio.entries)) throw new Error("Ungültige Arbeitsproben.");
    portfolio = copyFormat(data.portfolio, { title: data.portfolio.title, entries: data.portfolio.entries.map(entry => {
      if (!isRecord(entry)) throw new Error("Ungültige Arbeitsprobe.");
      return copyFormat(entry, strings(entry, { title: "", date: "", description: "", link: "" }), ["title", "date", "description", "link"]);
    }) }, ["title"]);
  }
  let recipientDetails = null;
  if (data.recipientDetails !== undefined && data.recipientDetails !== null) {
    if (!isRecord(data.recipientDetails)) throw new Error("Ungültige Empfängerangaben.");
    recipientDetails = strings(data.recipientDetails, { company: "", department: "", contact: "", street: "", postal: "", city: "", country: "", salutationName: "", snapshot: "" });
  }
  let vars = defaults.vars;
  if (data.vars !== undefined) {
    if (!isRecord(data.vars) || typeof data.vars.company !== "string" || typeof data.vars.job !== "string") throw new Error("Ungültige Platzhalter.");
    vars = { company: data.vars.company, job: data.vars.job };
  }
  return { profile, letter, design, sections, portfolio, recipientDetails, vars, extras: parseFields(data.extras) };
}
function showStatus() { $("#status").textContent = [saveError, message].filter(Boolean).join(" "); }
function updateStorageIndicator() {
  $("#storage-indicator").textContent = storageMode === "local"
    ? "Speicherung: lokal in diesem Browser. Speichere regelmäßig eine Vorlage."
    : "Speicherung: nur in diesem Tab. Beim Neuladen oder Schließen gehen Änderungen verloren.";
}
function save() {
  scheduleSnapshot();
  schedulePreview();
  if (storageMode !== "local") { showStatus(); return; }
  if (loadBlocked) { showStatus(); return; }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); saveError = ""; }
  catch (error) { saveError = "Speichern im Browser fehlgeschlagen. Speichere eine Vorlage und prüfe den verfügbaren Speicherplatz."; console.error(error); }
  showStatus();
}
function loadSavedState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) state = parseState(JSON.parse(saved));
  } catch (error) {
    console.error(error); loadBlocked = true;
    saveError = "Die gespeicherten Daten konnten nicht geladen werden. Lade eine Vorlage; bis dahin werden vorhandene Browserdaten nicht überschrieben.";
  }
}
try {
  if (localStorage.getItem(STORAGE_CHOICE_KEY) === "local") {
    storageMode = "local"; hasStarted = true; loadSavedState();
  }
} catch (error) {
  console.error(error);
  saveError = "Der Browserspeicher ist nicht verfügbar. Du kannst vorübergehend ohne lokale Speicherung arbeiten.";
}

const PLAIN_KEYS = new Set(["email", "phone", "website", "date", "link"]);
function placeholderValues() {
  const p = state.profile, r = state.recipientDetails || {}, v = state.vars;
  const company = v.company || r.company || "", job = v.job, contact = r.contact || "";
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
  const date = formattedDate(state.letter.date) || new Date().toLocaleDateString("de-DE");
  return {
    company, firma: company, job_name: job, beruf: job, stelle: job, name, first_name: p.firstName, vorname: p.firstName, last_name: p.lastName, nachname: p.lastName,
    email: p.email, phone: p.phone, telefon: p.phone, city: p.city, ort: p.city, street: p.street, strasse: p.street, contact, ansprechpartner: contact, date, datum: date
  };
}
function resolve(text) {
  if (!text || !text.includes("{")) return text;
  const values = placeholderValues();
  return text.replace(/\{\s*([a-z_]+)\s*\}/gi, (match, key) => values[key.toLowerCase()] || match);
}
function formatRecord(group, section, entry, field) {
  if (group === "letter") return state.letter;
  if (group === "section") return state.sections[Number(section)];
  if (group === "entry") return state.sections[Number(section)].entries[Number(entry)];
  if (group === "entryExtra") return state.sections[Number(section)].entries[Number(entry)].fields[Number(field)];
  if (group === "extra") return state.extras[Number(field)];
  if (group === "portfolio") return state.portfolio;
  if (group === "work") return state.portfolio.entries[Number(entry)];
  return null;
}
function stylesForText(text, runs = []) {
  const styles = Array.from({ length: text.length }, () => ({}));
  for (const { start, end, ...style } of runs) for (let i = start; i < Math.min(end, text.length); i++) styles[i] = { ...style };
  return styles;
}
function runsFromStyles(styles) {
  const runs = [];
  styles.forEach((style, index) => {
    if (!Object.keys(style).length) return;
    const previous = runs[runs.length - 1];
    if (previous && previous.end === index && JSON.stringify(Object.fromEntries(Object.entries(previous).filter(([key]) => key !== "start" && key !== "end"))) === JSON.stringify(style)) previous.end++;
    else runs.push({ start: index, end: index + 1, ...style });
  });
  return runs;
}
function formattedHtml(text, runs, replacePlaceholders = true) {
  const styles = stylesForText(text, runs), pieces = [];
  const append = (value, style) => {
    const css = [];
    if (style.bold !== undefined) css.push(`font-weight:${style.bold ? "bold" : "normal"}`);
    if (style.italic !== undefined) css.push(`font-style:${style.italic ? "italic" : "normal"}`);
    if (style.underline !== undefined) css.push(`text-decoration:${style.underline ? "underline" : "none"}`);
    if (style.size !== undefined) css.push(`font-size:${style.size}pt`);
    if (style.color !== undefined) css.push(`color:${style.color}`);
    pieces.push(css.length ? `<span style="${css.join(";")}">${escapeHtml(value)}</span>` : escapeHtml(value));
  };
  for (let i = 0; i < text.length;) {
    const token = replacePlaceholders && text.slice(i).match(/^\{\s*[a-z_]+\s*\}/i);
    if (token) {
      append(resolve(token[0]), styles[i] || {});
      i += token[0].length;
      continue;
    }
    const style = styles[i] || {}, signature = JSON.stringify(style);
    let end = i + 1;
    while (end < text.length && JSON.stringify(styles[end]) === signature && !(replacePlaceholders && text[end] === "{")) end++;
    append(text.slice(i, end), style);
    i = end;
  }
  return pieces.join("");
}
function editable(group, key, placeholder, options = {}) {
  const value = options.value === undefined ? state[group][key] : options.value;
  const tag = options.tag || "span", classes = options.className || "";
  const section = options.section === undefined ? "" : ` data-section="${options.section}"`;
  const entry = options.entry === undefined ? "" : ` data-entry="${options.entry}"`;
  const field = options.field === undefined ? "" : ` data-field="${options.field}"`;
  const plain = PLAIN_KEYS.has(key);
  const record = formatRecord(group, options.section, options.entry, options.field);
  const runs = record?.format?.[key] || [];
  return `<${tag} class="${classes}" contenteditable="true" role="textbox" spellcheck="${!plain}" lang="de" autocorrect="${plain ? "off" : "on"}" autocapitalize="${plain ? "off" : "sentences"}" aria-label="${escapeHtml(placeholder)}" aria-multiline="${Boolean(options.multiline)}" data-group="${group}" data-key="${key}"${section}${entry}${field} data-placeholder="${escapeHtml(placeholder)}" data-raw="${escapeHtml(value)}"${options.optional && !value ? " hidden" : ""}>${formattedHtml(value, runs)}</${tag}>`;
}
const AUTOCORRECT = {
  nciht: "nicht", nihct: "nicht", udn: "und", dnn: "dann", fuer: "für", ueber: "über", moechte: "möchte", koennen: "können", koennte: "könnte",
  wuerde: "würde", waere: "wäre", gruesse: "grüße", grüsse: "grüße", daß: "dass", heir: "hier", wier: "wir", ihc: "ich", bewerbunng: "bewerbung"
};
function autocorrect(element, typed) {
  const selection = window.getSelection();
  if (!selection.rangeCount || !selection.isCollapsed) return;
  const node = selection.anchorNode, offset = selection.anchorOffset;
  if (!node || node.nodeType !== Node.TEXT_NODE || !element.contains(node) || offset < 1) return;
  const before = node.data.slice(0, offset - 1);
  if (typed === " " && /[ \u00A0]$/.test(before)) { node.deleteData(offset - 1, 1); return; }
  const match = before.match(/([A-Za-zÄÖÜäöüß]+)$/);
  if (!match) return;
  const word = match[1], start = before.length - word.length;
  const range = document.createRange();
  range.selectNodeContents(element); range.setEnd(node, start);
  const prefix = measureEditorText(element, range.cloneContents());
  if (/\p{L}$/u.test(prefix)) return;
  let fixed = AUTOCORRECT[word.toLowerCase()] || word;
  if (fixed !== word && word[0] !== word[0].toLowerCase()) fixed = fixed[0].toUpperCase() + fixed.slice(1);
  const sentenceStart = prefix.length === 0 || (/[.!?][ \u00A0]+$/.test(prefix) && !/(?:^|\s)\p{L}{1,2}[.!?][ \u00A0]+$/u.test(prefix));
  if (element.getAttribute("aria-multiline") === "true" && sentenceStart && /^[a-zäöüß]/.test(fixed)) fixed = fixed[0].toUpperCase() + fixed.slice(1);
  if (fixed !== word) node.replaceData(start, word.length, fixed);
}
function person(key, placeholder, options = {}) {
  const tag = options.tag || "span", value = resolve(state.profile[key]);
  return `<${tag} class="profile-value ${options.className || ""}" role="button" tabindex="0" data-open-profile data-placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(placeholder)} bearbeiten"${!value ? " hidden" : ""}>${escapeHtml(value)}</${tag}>`;
}
function letterField(key, placeholder, options = {}) {
  if (key !== "recipient" && key !== "salutation") return editable("letter", key, placeholder, options);
  const tag = options.tag || "span";
  return `<${tag} class="dialog-field ${options.className || ""}" role="button" tabindex="0" data-open-recipient data-placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(placeholder)} bearbeiten">${escapeHtml(resolve(state.letter[key]))}</${tag}>`;
}
function fieldHasContent(field) { return Boolean(field.label.trim() || field.value.trim()); }
function entryHasContent(entry) { return [entry.title, entry.subtitle, entry.date, entry.description].some(value => value.trim()) || (entry.fields || []).some(fieldHasContent); }
function customField(group, field, index, remove, options = {}) {
  return `<div class="custom-field">${editable(group, "label", "Bezeichnung", { value: field.label, field: index, className: "custom-label", ...options })}<span class="custom-colon">:</span>
    ${editable(group, "value", "Wert", { value: field.value, field: index, className: "custom-value", ...options })}
    <span class="entry-actions"><button class="icon-button" ${remove} aria-label="Feld löschen" title="Feld löschen">✕</button></span></div>`;
}
function fieldMenu(index, entryIndex, group) {
  const work = group === "work";
  return `<details class="field-menu"><summary class="icon-button" aria-label="Felder hinzufügen" title="Felder hinzufügen">+</summary><div class="field-options">
    ${work ? "" : `<button type="button" data-action="show-field" data-field="subtitle" data-group="${group}" data-index="${index}" data-entry="${entryIndex}">Untertitel</button>`}
    <button type="button" data-action="show-field" data-field="date" data-group="${group}" data-index="${index}" data-entry="${entryIndex}">Zeitraum</button>
    <button type="button" data-action="show-field" data-field="description" data-group="${group}" data-index="${index}" data-entry="${entryIndex}">Beschreibung</button>
    ${work ? "" : `<button type="button" data-action="add-entry-field" data-index="${index}" data-entry="${entryIndex}">Eigenes Feld</button>`}
    ${work ? `<button type="button" data-action="show-field" data-field="link" data-group="${group}" data-index="${index}" data-entry="${entryIndex}">Link</button>` : `<button type="button" data-action="toggle-rating" data-index="${index}" data-entry="${entryIndex}">Bewertung ein- / ausblenden</button>`}
  </div></details>`;
}
function ratingEditor(rating, section, entry) {
  if (!rating) return "";
  const dots = "●".repeat(rating.value) + "○".repeat(rating.max - rating.value);
  return `<div class="skill-rating"><span class="rating-display" aria-label="Bewertung ${rating.value} von ${rating.max}"><span class="rating-dots">${dots}</span> ${rating.value}/${rating.max}</span>
    <div class="rating-controls"><label>Skala <select data-rating="max" data-index="${section}" data-entry="${entry}" aria-label="Bewertungsskala"><option value="5"${rating.max === 5 ? " selected" : ""}>1–5</option><option value="10"${rating.max === 10 ? " selected" : ""}>1–10</option></select></label>
    <label>Wert <select data-rating="value" data-index="${section}" data-entry="${entry}" aria-label="Bewertung">${Array.from({ length: rating.max }, (_, i) => `<option value="${i + 1}"${rating.value === i + 1 ? " selected" : ""}>${i + 1}</option>`).join("")}</select></label></div></div>`;
}
function renderResume() {
  const d = state.design, p = state.profile;
  return `<header class="resume-header"><div>
    <div class="resume-name"${!p.firstName && !p.lastName ? " hidden" : ""}>${person("firstName", "Vorname")} ${person("lastName", "Nachname")}</div>
    ${person("headline", "Berufsbezeichnung / Profil", { tag: "div", className: "headline block" })}
    <div class="contact"${!["street", "city", "email", "phone", "website"].some(key => p[key]) ? " hidden" : ""}>${person("street", "Straße und Hausnummer")}${person("city", "PLZ und Ort")}${person("email", "E-Mail")}${person("phone", "Telefon")}${person("website", "Website / LinkedIn")}</div>
    <div class="extra-fields">${state.extras.map((field, i) => customField("extra", field, i, `data-action="remove-extra" data-field="${i}"`)).join("")}<button class="add-entry" data-action="add-extra">+ Feld</button></div>
    </div>${p.photo ? `<img class="photo" src="${p.photo}" alt="Bewerbungsfoto" style="width:${d.photoWidth}mm;height:${d.photoHeight}mm">` : ""}</header>
    <div class="resume-sections">${state.sections.map((section, index) => {
      const empty = !section.entries.some(entryHasContent);
      return `<section class="resume-section${empty ? " empty-section" : ""}" data-section-id="${escapeHtml(section.id)}" style="width:${section.width}%">
        <div class="section-heading">${editable("section", "title", "Abschnittstitel", { value: section.title, section: index, className: "section-title" })}
        <div class="section-actions"><span class="icon-button section-drag" draggable="true" data-index="${index}" title="Abschnitt ziehen" aria-hidden="true">⠿</span>
        <button class="icon-button" data-action="up" data-index="${index}" aria-label="Abschnitt nach oben" ${index === 0 ? "disabled" : ""}>↑</button>
        <button class="icon-button" data-action="down" data-index="${index}" aria-label="Abschnitt nach unten" ${index === state.sections.length - 1 ? "disabled" : ""}>↓</button>
        <button class="icon-button" data-action="width" data-index="${index}" aria-label="Abschnittsbreite ändern" title="Breite ändern">${section.width === 100 ? "100%" : "50%"}</button>
        <button class="icon-button" data-action="remove-section" data-index="${index}" aria-label="Abschnitt löschen">✕</button></div></div>
        ${section.entries.map((entry, entryIndex) => `<div class="resume-entry"><div class="entry-top">
          ${editable("entry", "title", "Titel", { value: entry.title, section: index, entry: entryIndex, className: "entry-title" })}
          ${editable("entry", "date", "Zeitraum", { value: entry.date, section: index, entry: entryIndex, className: "entry-date", optional: true })}
          <div class="entry-actions">${fieldMenu(index, entryIndex, "entry")}<button class="icon-button" data-action="remove-entry" data-index="${index}" data-entry="${entryIndex}" aria-label="Eintrag löschen">✕</button></div></div>
          ${editable("entry", "subtitle", "Untertitel", { value: entry.subtitle, section: index, entry: entryIndex, tag: "div", className: "entry-subtitle block", optional: true })}
          ${editable("entry", "description", "Beschreibung", { value: entry.description, section: index, entry: entryIndex, tag: "div", className: "entry-description block", multiline: true, optional: true })}
          ${(entry.fields || []).map((field, f) => customField("entryExtra", field, f, `data-action="remove-entry-field" data-index="${index}" data-entry="${entryIndex}" data-field="${f}"`, { section: index, entry: entryIndex })).join("")}
          ${ratingEditor(entry.rating, index, entryIndex)}
        </div>`).join("")}<button class="add-entry" data-action="add-entry" data-index="${index}">+ Eintrag</button></section>`;
    }).join("")}</div>`;
}
function renderPortfolio() {
  return `<header class="portfolio-header">${editable("portfolio", "title", "Überschrift", { tag: "div", className: "portfolio-title block" })}
    <div class="portfolio-name">${escapeHtml([state.profile.firstName, state.profile.lastName].filter(Boolean).join(" "))}</div></header>
    <div class="portfolio-entries">${state.portfolio.entries.map((entry, index) => `<section class="work-entry"><div class="entry-top">
      ${editable("work", "title", "Titel der Arbeitsprobe", { value: entry.title, entry: index, className: "entry-title" })}
      ${editable("work", "date", "Zeitraum", { value: entry.date, entry: index, className: "entry-date", optional: true })}
      <div class="entry-actions">${fieldMenu(0, index, "work")}<button class="icon-button" data-action="remove-work" data-entry="${index}" aria-label="Arbeitsprobe löschen">✕</button></div></div>
      ${editable("work", "description", "Beschreibung", { value: entry.description, entry: index, tag: "div", className: "entry-description block", multiline: true, optional: true })}
      ${editable("work", "link", "Link", { value: entry.link, entry: index, tag: "div", className: "work-link block", optional: true })}
    </section>`).join("")}</div><button class="add-entry" data-action="add-work">+ Arbeitsprobe</button>`;
}
function formattedDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-").reverse().join(".") : value;
}
function renderLetter() {
  return `<div class="letter-top">
    <div class="address-window">
      <div class="return-address">${person("firstName", "Vorname")} ${person("lastName", "Nachname")} · ${person("street", "Straße und Hausnummer")} · ${person("city", "PLZ und Ort")}</div>
      ${letterField("recipient", "Empfänger und Adresse", { tag: "div", className: "recipient block", multiline: true })}
    </div>
    <div class="letter-info">${person("firstName", "Vorname")} ${person("lastName", "Nachname")}
      ${person("street", "Straße und Hausnummer", { tag: "div", className: "block" })}${person("city", "PLZ und Ort", { tag: "div", className: "block" })}
      ${person("email", "E-Mail", { tag: "div", className: "block" })}${person("phone", "Telefon", { tag: "div", className: "block" })}
    </div></div>
    <div class="letter-date">${letterField("place", "Ort")}<span class="date-separator">, </span>${letterField("date", "Datum (TT.MM.JJJJ)", { value: formattedDate(state.letter.date) })}</div>
    ${letterField("subject", "Betreff", { tag: "div", className: "letter-subject block" })}
    ${letterField("salutation", "Anrede", { tag: "div", className: "letter-salutation block" })}
    ${letterField("body", "Schreibe hier dein Anschreiben …", { tag: "div", className: "letter-body block", multiline: true })}
    ${letterField("closing", "Grußformel", { tag: "div", className: "letter-closing block" })}
    <div class="letter-signature">${person("firstName", "Vorname")} ${person("lastName", "Nachname")}</div>`;
}
function render() {
  savedFormatSelection = null;
  const paper = $("#paper"), d = state.design;
  paper.className = `paper template-${d.template}${activeDocument === "letter" ? " letter-paper" : ""}`;
  paper.style.setProperty("--accent", d.color);
  paper.style.setProperty("--doc-font", `"${d.font}", ${d.font === "Georgia" ? "serif" : "sans-serif"}`);
  paper.innerHTML = activeDocument === "resume" ? renderResume() : activeDocument === "letter" ? renderLetter() : renderPortfolio();
  const header = activeDocument === "resume" ? paper.querySelector(".resume-header") : null;
  const flow = document.createElement("div");
  flow.className = "editor-flow";
  while (header ? header.nextSibling : paper.firstChild) flow.appendChild(header ? header.nextSibling : paper.firstChild);
  paper.appendChild(flow);
  document.querySelectorAll(".document-button").forEach(button => button.classList.toggle("active", button.dataset.document === activeDocument));
  for (const name of ["template", "font", "color"]) $(`#${name}`).value = d[name];
  for (const dimension of ["width", "height"]) {
    const value = d[dimension === "width" ? "photoWidth" : "photoHeight"];
    $(`#photo-${dimension}`).value = value; $(`#photo-${dimension}-value`).textContent = `${value} mm`;
  }
  for (const id of ["add-section", "photo-label", "remove-photo", "photo-width-label", "photo-height-label"]) $(`#${id}`).hidden = activeDocument !== "resume";
  $("#add-work").hidden = activeDocument !== "portfolio";
  $("#edit-recipient").hidden = activeDocument !== "letter";
  $("#edit-subject").hidden = activeDocument !== "letter";
  updateAddressWarning();
  updateEditorPages();
  schedulePreview();
}
let editorPagesFrame;
function scheduleEditorPages() {
  cancelAnimationFrame(editorPagesFrame);
  editorPagesFrame = requestAnimationFrame(updateEditorPages);
}
function updateEditorPages() {
  const paper = $("#paper"), flow = paper.querySelector(".editor-flow");
  if (!flow) return;
  const sheetWidth = parseFloat(getComputedStyle(paper).width), sheetHeight = sheetWidth * 297 / 210;
  const contentBottom = flow.offsetTop + flow.scrollHeight + parseFloat(getComputedStyle(paper).paddingBottom);
  const count = Math.max(1, Math.ceil(contentBottom / sheetHeight));
  paper.style.height = `${count * sheetHeight}px`;
  paper.parentElement.style.width = `${sheetWidth * 1.15}px`;
  paper.parentElement.style.height = `${count * sheetHeight * 1.15}px`;
  paper.querySelectorAll(".editor-page-decoration").forEach(element => element.remove());
  for (let i = 0; i < count; i++) {
    const sheet = document.createElement("div");
    sheet.className = "editor-page-decoration";
    sheet.style.top = `${i * sheetHeight}px`;
    sheet.setAttribute("aria-hidden", "true");
    if (count > 1) {
      const number = document.createElement("span");
      number.className = "editor-page-number";
      number.textContent = `Seite ${i + 1} von ${count}`;
      sheet.appendChild(number);
    }
    paper.prepend(sheet);
  }
}
function updateAddressWarning() {
  const old = document.querySelector(".address-warning");
  if (old) old.remove();
  const address = $(".address-window"), recipient = $(".recipient"), sender = $(".return-address");
  if (address && (recipient.scrollHeight > address.clientHeight - sender.clientHeight + 1 || sender.scrollHeight > sender.clientHeight + 1)) {
    const warning = document.createElement("p"); warning.className = "address-warning";
    warning.textContent = "Die Absender- oder Empfängeradresse ist zu lang für das Fenster. Bitte kürzen und die Druckvorschau kontrollieren.";
    $(".document-area").before(warning);
  }
}
function updateEmptySection(index) {
  const section = state.sections[index], node = document.querySelector(`.resume-section[data-section-id="${CSS.escape(section.id)}"]`);
  if (node) node.classList.toggle("empty-section", !section.entries.some(entryHasContent));
}
function parseEditedDate(value) {
  const match = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;
  const iso = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}
let savedFormatSelection = null;
for (const toolbar of document.querySelectorAll(".format-toolbar")) {
  toolbar.append($("#format-toolbar-template").content.cloneNode(true));
}
function supportsFormatting(element) {
  return Boolean(element && element.matches("#paper [contenteditable]") && !(element.dataset.group === "letter" && element.dataset.key === "date"));
}
function measureEditorText(element, contents) {
  const clone = element.cloneNode(false);
  clone.removeAttribute("id");
  clone.setAttribute("contenteditable", "false");
  clone.setAttribute("aria-hidden", "true");
  clone.style.cssText = "position:fixed;left:-10000px;top:0;opacity:0;pointer-events:none;white-space:pre-wrap;width:1000px;text-transform:none!important";
  clone.append(contents);
  document.body.append(clone);
  const text = clone.innerText.replace(/\r/g, "").replace(/\u00a0/g, " ");
  clone.remove();
  return text;
}
function rangeTextLength(element, node, offset) {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.setEnd(node, offset);
  return measureEditorText(element, range.cloneContents()).length;
}
function editorText(element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  return measureEditorText(element, range.cloneContents()).replace(/\n+$/, "");
}
function readInlineStyles(element, text) {
  const styles = Array.from({ length: text.length }, () => ({}));
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode, parents = [];
    for (let parent = node.parentElement; parent && parent !== element; parent = parent.parentElement) parents.unshift(parent);
    const style = {};
    for (const parent of parents) {
      if (["B", "STRONG"].includes(parent.tagName)) style.bold = true;
      if (["I", "EM"].includes(parent.tagName)) style.italic = true;
      if (parent.tagName === "U") style.underline = true;
      const css = parent.style;
      if (css.fontWeight) style.bold = css.fontWeight === "bold" || Number(css.fontWeight) >= 600;
      if (css.fontStyle) style.italic = css.fontStyle === "italic" || css.fontStyle === "oblique";
      if (css.textDecorationLine || css.textDecoration) style.underline = (css.textDecorationLine || css.textDecoration).includes("underline");
      const size = css.fontSize.match(/^(\d+)pt$/);
      if (size && Number(size[1]) >= 6 && Number(size[1]) <= 36) style.size = Number(size[1]);
      const color = css.color.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/);
      if (color) style.color = `#${color.slice(1).map(part => Number(part).toString(16).padStart(2, "0")).join("")}`;
    }
    if (!Object.keys(style).length) continue;
    const start = rangeTextLength(element, node, 0);
    const length = node.data.replace(/\r/g, "").length;
    for (let i = start; i < Math.min(start + length, styles.length); i++) styles[i] = { ...style };
  }
  return runsFromStyles(styles);
}
document.addEventListener("selectionchange", () => {
  const selection = window.getSelection();
  if (!selection.rangeCount || selection.isCollapsed) {
    if (supportsFormatting(document.activeElement)) savedFormatSelection = null;
    return;
  }
  const range = selection.getRangeAt(0), element = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement).closest("[contenteditable]");
  if (!supportsFormatting(element) || !element.contains(range.endContainer)) return;
  const start = rangeTextLength(element, range.startContainer, range.startOffset);
  const end = rangeTextLength(element, range.endContainer, range.endOffset);
  if (end > start) savedFormatSelection = { element, start, end };
});
function selectFormattedText(element, start, end) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const point = offset => {
    for (const node of nodes) {
      if (offset <= node.length) return [node, offset];
      offset -= node.length;
    }
    return nodes.length ? [nodes[nodes.length - 1], nodes[nodes.length - 1].length] : [element, 0];
  };
  const [startNode, startOffset] = point(start), [endNode, endOffset] = point(end);
  const range = document.createRange();
  range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset);
  element.focus();
  const selection = window.getSelection();
  selection.removeAllRanges(); selection.addRange(range);
}
function applyTextFormat(property, value) {
  const selected = savedFormatSelection;
  if (!selected || !selected.element.isConnected) {
    message = "Bitte zuerst Text in einem Dokumentfeld markieren."; showStatus(); return;
  }
  const element = selected.element, { group, key, section, entry, field } = element.dataset;
  const record = formatRecord(group, section, entry, field), text = element.dataset.raw;
  const styles = stylesForText(text, record.format?.[key]);
  const start = Math.min(selected.start, text.length), end = Math.min(selected.end, text.length);
  if (end <= start) { message = "Bitte zuerst Text in einem Dokumentfeld markieren."; showStatus(); return; }
  if (["bold", "italic", "underline"].includes(property)) {
    const computed = getComputedStyle(element);
    const fallback = property === "bold" ? Number(computed.fontWeight) >= 600 : property === "italic" ? computed.fontStyle === "italic" : computed.textDecorationLine.includes("underline");
    value = !(styles[start][property] ?? fallback);
  }
  for (let i = start; i < end; i++) {
    if (property === "reset") styles[i] = {};
    else styles[i][property] = value;
  }
  record.format ||= {};
  record.format[key] = runsFromStyles(styles);
  element.innerHTML = formattedHtml(text, record.format[key], false);
  selectFormattedText(element, start, end);
  savedFormatSelection = { element, start, end };
  message = ""; save(); scheduleEditorPages();
}
for (const toolbar of document.querySelectorAll(".format-toolbar")) {
  toolbar.addEventListener("mousedown", event => { if (event.target.closest("button")) event.preventDefault(); });
  toolbar.addEventListener("click", event => {
    const button = event.target.closest("[data-format]");
    if (button) applyTextFormat(button.dataset.format);
    if (event.target.closest("[data-apply-color]")) applyTextFormat("color", toolbar.querySelector("[data-format-color]").value);
  });
  toolbar.addEventListener("change", event => {
    if (event.target.matches("[data-format-size]") && event.target.value) {
      applyTextFormat("size", Number(event.target.value));
      event.target.value = "";
    }
    if (event.target.matches("[data-format-color]")) applyTextFormat("color", event.target.value);
  });
}
$("#paper").addEventListener("input", event => {
  const element = event.target.closest("[contenteditable]");
  if (!element) return;
  const { group, key, section, entry, field } = element.dataset;
  if (event.inputType === "insertText" && event.data && /^[ .,!?;:]$/.test(event.data) && !PLAIN_KEYS.has(key)) autocorrect(element, event.data);
  const value = editorText(element);
  const record = formatRecord(group, section, entry, field);
  if (record && !(group === "letter" && key === "date")) {
    const runs = readInlineStyles(element, value);
    if (runs.length || record.format?.[key]) {
      record.format ||= {};
      record.format[key] = runs;
    }
  }
  savedFormatSelection = null;
  if (!value) element.textContent = "";
  element.dataset.raw = value;
  if (group === "profile") {
    state.profile[key] = value;
    document.querySelectorAll(`[data-group="profile"][data-key="${key}"]`).forEach(other => { if (other !== element) { other.textContent = resolve(value); other.dataset.raw = value; } });
  } else if (group === "letter") {
    if (key === "date") {
      state.letter.date = parseEditedDate(value) || value;
    } else state.letter[key] = value;
  } else if (group === "section") state.sections[Number(section)][key] = value;
  else if (group === "entry") { state.sections[Number(section)].entries[Number(entry)][key] = value; updateEmptySection(Number(section)); }
  else if (group === "extra") state.extras[Number(field)][key] = value;
  else if (group === "entryExtra") { state.sections[Number(section)].entries[Number(entry)].fields[Number(field)][key] = value; updateEmptySection(Number(section)); }
  else if (group === "portfolio") state.portfolio[key] = value;
  else if (group === "work") state.portfolio.entries[Number(entry)][key] = value;
  message = group === "letter" && key === "date" && value && !parseEditedDate(value) ? "Das Datum bitte gültig im Format TT.MM.JJJJ eingeben." : "";
  save(); updateAddressWarning(); scheduleEditorPages();
});
$("#paper").addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && ["b", "i", "u"].includes(event.key.toLowerCase()) && supportsFormatting(event.target)) {
    event.preventDefault();
    applyTextFormat({ b: "bold", i: "italic", u: "underline" }[event.key.toLowerCase()]);
    return;
  }
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-open-profile], [data-open-recipient]")) {
    event.preventDefault(); event.target.click(); return;
  }
  if (event.key === "Enter" && event.shiftKey && event.target.matches('[data-group="entry"][data-key="title"]')) {
    event.preventDefault();
    const subtitle = event.target.closest(".resume-entry").querySelector('[data-key="subtitle"]');
    subtitle.hidden = false; subtitle.focus(); scheduleEditorPages();
    return;
  }
  if (event.key === "Enter" && event.target.matches('[contenteditable][aria-multiline="false"]')) event.preventDefault();
});
$("#paper").addEventListener("focusin", event => {
  const element = event.target;
  if (savedFormatSelection && savedFormatSelection.element !== element) savedFormatSelection = null;
  if (element.isContentEditable && element.dataset.raw !== undefined && resolve(element.dataset.raw) !== element.dataset.raw) {
    const record = formatRecord(element.dataset.group, element.dataset.section, element.dataset.entry, element.dataset.field);
    element.innerHTML = formattedHtml(element.dataset.raw, record?.format?.[element.dataset.key], false);
  }
});
$("#paper").addEventListener("focusout", event => {
  const element = event.target;
  if (element.isContentEditable && element.dataset.raw !== undefined) {
    const shown = resolve(element.dataset.raw);
    if (shown !== element.dataset.raw) {
      const record = formatRecord(element.dataset.group, element.dataset.section, element.dataset.entry, element.dataset.field);
      element.innerHTML = formattedHtml(element.dataset.raw, record?.format?.[element.dataset.key]);
    }
  }
  if (element.matches('[contenteditable][data-key="subtitle"], [contenteditable][data-group="entry"][data-key="date"], [contenteditable][data-group="entry"][data-key="description"], [contenteditable][data-group="work"][data-key="date"], [contenteditable][data-group="work"][data-key="description"], [contenteditable][data-group="work"][data-key="link"]') && !element.innerText.trim()) element.hidden = true;
  scheduleEditorPages();
});
$("#paper").addEventListener("change", event => {
  const control = event.target;
  if (!control.dataset.rating) return;
  const rating = state.sections[Number(control.dataset.index)].entries[Number(control.dataset.entry)].rating;
  rating[control.dataset.rating] = Number(control.value);
  if (rating.value > rating.max) rating.value = rating.max;
  save(); render();
});
$("#paper").addEventListener("paste", event => {
  if (!event.target.matches("[contenteditable]")) return;
  event.preventDefault();
  const selection = window.getSelection(), range = selection.rangeCount ? selection.getRangeAt(0) : null;
  if (!range) return;
  const multiline = event.target.getAttribute("aria-multiline") === "true";
  const text = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
  range.deleteContents(); const node = document.createTextNode(multiline ? text : text.replace(/\n+/g, " "));
  range.insertNode(node); range.setStartAfter(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
  event.target.dispatchEvent(new Event("input", { bubbles: true }));
});
$("#paper").addEventListener("click", event => {
  if (event.target.closest("[data-open-profile]")) { $("#edit-profile").click(); return; }
  if (event.target.closest("[data-open-recipient]")) { $("#edit-recipient").click(); return; }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const index = Number(button.dataset.index), action = button.dataset.action;
  if (action === "show-field") {
    const group = button.dataset.group, entry = button.dataset.entry;
    const element = button.closest(group === "work" ? ".work-entry" : ".resume-entry").querySelector(`[data-group="${group}"][data-key="${button.dataset.field}"][data-entry="${entry}"]`);
    button.closest("details").open = false; element.hidden = false; element.focus(); scheduleEditorPages(); return;
  }
  if (action === "add-extra") {
    state.extras.push({ label: "", value: "" }); message = ""; save(); render();
    const fields = document.querySelectorAll('[data-group="extra"][data-key="label"]'); fields[fields.length - 1].focus(); return;
  }
  if (action === "add-entry-field") {
    const entry = state.sections[index].entries[Number(button.dataset.entry)];
    (entry.fields ||= []).push({ label: "", value: "" }); message = ""; save(); render();
    const fields = document.querySelectorAll(`[data-group="entryExtra"][data-key="label"][data-section="${index}"][data-entry="${button.dataset.entry}"]`); fields[fields.length - 1].focus(); return;
  }
  if (action === "remove-extra") {
    const field = state.extras[Number(button.dataset.field)];
    if (fieldHasContent(field) && !confirm("Dieses Feld mit Inhalt löschen?")) return;
    state.extras.splice(Number(button.dataset.field), 1);
  } else if (action === "remove-entry-field") {
    const entry = state.sections[index].entries[Number(button.dataset.entry)], position = Number(button.dataset.field);
    if (fieldHasContent(entry.fields[position]) && !confirm("Dieses Feld mit Inhalt löschen?")) return;
    entry.fields.splice(position, 1);
    if (!entry.fields.length) delete entry.fields;
  } else if (action === "remove-section") {
    if (state.sections[index].entries.some(entryHasContent) || state.sections[index].title.trim()) { if (!confirm("Diesen Abschnitt und alle seine Einträge löschen?")) return; }
    state.sections.splice(index, 1);
  } else if (action === "remove-entry") {
    if (entryHasContent(state.sections[index].entries[Number(button.dataset.entry)]) && !confirm("Diesen Eintrag mit Inhalt löschen?")) return;
    state.sections[index].entries.splice(Number(button.dataset.entry), 1);
  }
  else if (action === "toggle-rating") {
    const entry = state.sections[index].entries[Number(button.dataset.entry)];
    if (entry.rating) delete entry.rating; else entry.rating = { max: 5, value: 3 };
  }
  else if (action === "add-work") state.portfolio.entries.push({ title: "", date: "", description: "", link: "" });
  else if (action === "remove-work") {
    if (!confirm("Diese Arbeitsprobe löschen?")) return;
    state.portfolio.entries.splice(Number(button.dataset.entry), 1);
  }
  else if (action === "add-entry") state.sections[index].entries.push({ title: "", subtitle: "", date: "", description: "" });
  else if (action === "width") state.sections[index].width = state.sections[index].width === 100 ? 50 : 100;
  else if (action === "up" || action === "down") {
    const next = index + (action === "up" ? -1 : 1);
    if (next < 0 || next >= state.sections.length) return;
    [state.sections[index], state.sections[next]] = [state.sections[next], state.sections[index]];
  }
  message = ""; save(); render();
});
$("#paper").addEventListener("dragstart", event => {
  const handle = event.target.closest(".section-drag");
  if (!handle) return;
  draggedId = state.sections[Number(handle.dataset.index)].id;
  handle.classList.add("dragging"); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", draggedId);
});
$("#paper").addEventListener("dragend", event => { event.target.classList.remove("dragging"); draggedId = null; });
$("#paper").addEventListener("dragover", event => { if (draggedId && event.target.closest(".resume-section")) event.preventDefault(); });
$("#paper").addEventListener("drop", event => {
  const target = event.target.closest(".resume-section");
  if (!target || !draggedId) return;
  event.preventDefault();
  const from = state.sections.findIndex(section => section.id === draggedId), to = state.sections.findIndex(section => section.id === target.dataset.sectionId);
  if (from < 0 || to < 0 || from === to) return;
  state.sections.splice(to, 0, state.sections.splice(from, 1)[0]); draggedId = null; save(); render();
});
document.querySelectorAll(".document-button").forEach(button => button.addEventListener("click", () => { activeDocument = button.dataset.document; render(); }));
$("#add-section").addEventListener("click", () => { state.sections.push({ id: uid(), title: "Neuer Abschnitt", width: 100, entries: [] }); save(); render(); });
$("#add-work").addEventListener("click", () => { state.portfolio.entries.push({ title: "", date: "", description: "", link: "" }); save(); render(); });
for (const name of ["template", "font", "color"]) $(`#${name}`).addEventListener("input", event => { state.design[name] = event.target.value; save(); render(); });
for (const dimension of ["width", "height"]) $(`#photo-${dimension}`).addEventListener("input", event => {
  const key = dimension === "width" ? "photoWidth" : "photoHeight";
  state.design[key] = Number(event.target.value); $(`#photo-${dimension}-value`).textContent = `${event.target.value} mm`;
  const photo = $("#paper > .resume-header .photo"); if (photo) photo.style[dimension] = `${event.target.value}mm`;
  save(); scheduleEditorPages();
});
$("#photo-input").addEventListener("change", event => {
  const file = event.target.files[0]; event.target.value = "";
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { message = "Bitte wähle ein PNG-, JPEG- oder WebP-Bild."; showStatus(); return; }
  const reader = new FileReader();
  reader.onload = () => { state.profile.photo = reader.result; message = ""; save(); render(); };
  reader.onerror = () => { message = "Das Foto konnte nicht gelesen werden."; showStatus(); };
  reader.readAsDataURL(file);
});
$("#remove-photo").addEventListener("click", () => { state.profile.photo = ""; save(); render(); });
$("#print").addEventListener("click", () => {
  updateAddressWarning();
  if (activeDocument === "letter" && state.letter.date && !parseEditedDate(formattedDate(state.letter.date)) && !confirm("Das Datum ist ungültig. Trotzdem drucken?")) return;
  if ($(".address-warning") && !confirm("Die Adresse passt möglicherweise nicht ins Fenster. Trotzdem drucken?")) return;
  window.print();
});
document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => $(`#${button.dataset.closeDialog}`).close()));
const profileKeys = ["firstName", "lastName", "headline", "email", "phone", "street", "city", "website"];
$("#edit-profile").addEventListener("click", () => {
  const form = $("#profile-form");
  for (const key of profileKeys) form.elements[key].value = state.profile[key];
  $("#profile-dialog").showModal();
});
$("#profile-form").addEventListener("submit", event => {
  event.preventDefault();
  for (const key of profileKeys) state.profile[key] = event.currentTarget.elements[key].value.trim();
  message = ""; save(); render(); $("#profile-dialog").close();
});
$("#edit-subject").addEventListener("click", () => {
  $("#subject-form").reset();
  $("#subject-form").elements.job.value = state.vars.job;
  $("#subject-dialog").showModal();
});
$("#subject-form").addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget, job = form.elements.job.value.trim();
  if (!job) { form.elements.job.setCustomValidity("Bitte einen Beruf eingeben."); form.elements.job.reportValidity(); form.elements.job.setCustomValidity(""); return; }
  if (state.letter.subject && !confirm("Den vorhandenen Betreff durch die Vorlage ersetzen?")) return;
  const kind = form.elements.kind.value;
  state.vars.job = job;
  state.letter.subject = `Bewerbung um ${kind === "Praktikum" ? "das" : "die"} ${kind} als {job_name}${form.elements.start.value ? ` ab ${formattedDate(form.elements.start.value)}` : ""}`;
  if (state.letter.format) delete state.letter.format.subject;
  message = ""; save(); render(); $("#subject-dialog").close();
});
$("#privacy-settings").addEventListener("click", () => {
  $("#welcome-status").textContent = "";
  const choice = document.querySelector(`#welcome-form input[name="storage"][value="${storageMode}"]`);
  choice.checked = true;
  $("#welcome-dialog").showModal();
});
$("#welcome-dialog").addEventListener("cancel", event => {
  if (!hasStarted) event.preventDefault();
});
$("#welcome-form").addEventListener("submit", event => {
  event.preventDefault();
  const choice = new FormData(event.currentTarget).get("storage");
  if (choice !== "local" && choice !== "temporary") return;
  if (choice === "local") {
    try {
      if (hasStarted && storageMode === "temporary" && localStorage.getItem(STORAGE_KEY) && !confirm("Vorhandene lokal gespeicherte Daten werden durch den aktuellen Stand ersetzt. Fortfahren?")) return;
      if (!hasStarted) loadSavedState();
      localStorage.setItem(STORAGE_CHOICE_KEY, "local");
      storageMode = "local";
      if (hasStarted) { loadBlocked = false; save(); }
    } catch (error) {
      console.error(error);
      $("#welcome-status").textContent = "Die lokale Speicherung ist nicht verfügbar. Bitte wähle die vorübergehende Sitzung oder prüfe deine Browsereinstellungen.";
      return;
    }
  } else {
    saveError = "";
    try { localStorage.removeItem(STORAGE_CHOICE_KEY); }
    catch (error) {
      console.error(error);
      saveError = "Die bisherige Speichereinstellung konnte nicht entfernt werden. Bei einem erneuten Besuch könnten alte Daten wieder geladen werden; prüfe die Website-Daten in deinem Browser.";
    }
    storageMode = "temporary"; loadBlocked = false;
  }
  hasStarted = true; updateStorageIndicator(); render(); showStatus();
  $("#welcome-dialog").close();
  if (event.submitter && event.submitter.value === "import") $("#pdf-file").click();
});
$("#delete-local").addEventListener("click", () => {
  if (!confirm("Lokal gespeicherte Bewerbungsdaten und Speichereinstellung dieses Browsers löschen? Der aktuelle Stand im Tab wird ebenfalls zurückgesetzt. Exportierte Dateien werden nicht gelöscht.")) return;
  try {
    localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(STORAGE_CHOICE_KEY);
    state = defaultState(); versions = []; takeSnapshot("Startstand"); storageMode = "temporary"; loadBlocked = false; saveError = ""; message = "";
    updateStorageIndicator(); render(); showStatus();
    $("#welcome-status").textContent = "Die lokalen Daten wurden gelöscht. Bitte wähle, wie du fortfahren möchtest.";
    document.querySelectorAll('#welcome-form input[name="storage"]').forEach(input => { input.checked = false; });
  } catch (error) {
    console.error(error);
    $("#welcome-status").textContent = "Die Daten konnten nicht gelöscht werden. Bitte lösche die Website-Daten in den Browsereinstellungen.";
  }
});
$("#edit-recipient").addEventListener("click", () => {
  const form = $("#recipient-form");
  form.reset();
  $("#recipient-status").textContent = "";
  const details = state.recipientDetails;
  if (details && details.snapshot === state.letter.recipient) {
    for (const key of ["company", "department", "contact", "street", "postal", "city", "country", "salutationName"]) form.elements[key].value = details[key];
  }
  form.elements.address.value = state.letter.recipient;
  form.elements.customSalutation.value = state.letter.salutation;
  form.dataset.addressEdited = "false";
  form.dataset.detailsEdited = "false";
  $("#recipient-dialog").showModal();
});
$("#recipient-form").addEventListener("input", event => {
  const form = event.currentTarget, name = event.target.name;
  if (name === "address") form.dataset.addressEdited = "true";
  if (["company", "department", "contact", "street", "postal", "city", "country"].includes(name)) form.dataset.detailsEdited = "true";
});
$("#recipient-compose").addEventListener("click", () => {
  const e = $("#recipient-form").elements;
  const address = [e.company.value, e.department.value, e.contact.value, e.street.value, [e.postal.value, e.city.value].filter(Boolean).join(" "), e.country.value].filter(Boolean).join("\n");
  if (e.address.value.trim() && e.address.value.trim() !== address && !confirm("Die vorhandene Adresse durch die Einzelfelder ersetzen?")) return;
  e.address.value = address;
  $("#recipient-form").dataset.addressEdited = "true";
  $("#recipient-form").dataset.detailsEdited = "false";
});
$("#recipient-form").addEventListener("change", event => {
  const e = event.currentTarget.elements;
  if (event.target.name !== "salutation") return;
  if (e.salutation.value === "general") e.customSalutation.value = "Sehr geehrte Damen und Herren,";
  else if (e.salutation.value === "frau") e.customSalutation.value = `Sehr geehrte Frau ${e.salutationName.value.trim()},`;
  else if (e.salutation.value === "herr") e.customSalutation.value = `Sehr geehrter Herr ${e.salutationName.value.trim()},`;
});
$("#recipient-form").addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget;
  const keys = ["company", "department", "contact", "street", "postal", "city", "country", "salutationName"];
  const details = Object.fromEntries(keys.map(key => [key, form.elements[key].value.trim().replace(/[\r\n]+/g, " ")]));
  const choice = form.elements.salutation.value;
  if (["frau", "herr"].includes(choice) && !details.salutationName) {
    form.elements.salutationName.setCustomValidity("Bitte den Namen für die Anrede eingeben.");
    form.elements.salutationName.reportValidity();
    form.elements.salutationName.setCustomValidity("");
    return;
  }
  const structured = [details.company, details.department, details.contact, details.street, [details.postal, details.city].filter(Boolean).join(" "), details.country].filter(Boolean).join("\n");
  if (form.dataset.detailsEdited === "true" && form.dataset.addressEdited === "true" && form.elements.address.value.trim() !== structured &&
      !confirm("Die Einzelfelder und die frei bearbeitete Adresse unterscheiden sich. Die Einzelfelder als Adresse übernehmen?")) return;
  state.letter.recipient = form.dataset.detailsEdited === "true" ? structured : form.elements.address.value.trim();
  state.recipientDetails = structured === state.letter.recipient ? { ...details, snapshot: state.letter.recipient } : null;
  if (choice === "frau") state.letter.salutation = `Sehr geehrte Frau ${details.salutationName},`;
  else if (choice === "herr") state.letter.salutation = `Sehr geehrter Herr ${details.salutationName},`;
  else state.letter.salutation = form.elements.customSalutation.value.trim();
  message = ""; save(); render(); $("#recipient-dialog").close();
});
function versionSummary(json) {
  const s = JSON.parse(json), parts = [[s.profile.firstName, s.profile.lastName].filter(Boolean).join(" "), s.profile.headline, s.letter.subject, (s.letter.body || "").slice(0, 40)].filter(Boolean);
  return parts.join(" · ") || "(leer)";
}
function renderVersions() {
  const list = $("#version-list"), current = JSON.stringify(state);
  list.textContent = "";
  $("#version-empty").hidden = versions.length > 0;
  versions.forEach((version, index) => {
    const item = document.createElement("li"), info = document.createElement("div"), button = document.createElement("button");
    info.innerHTML = `<strong>${escapeHtml(version.time.toLocaleTimeString("de-DE"))}</strong> – ${escapeHtml(version.label)}${version.json === current ? " (aktuell)" : ""}<br><span>${escapeHtml(versionSummary(version.json))}</span>`;
    button.type = "button"; button.className = "button secondary"; button.dataset.version = index; button.textContent = "Wiederherstellen"; button.disabled = version.json === current;
    item.append(info, button); list.append(item);
  });
}
$("#versions").addEventListener("click", () => { takeSnapshot(); renderVersions(); $("#versions-dialog").showModal(); });
$("#save-version").addEventListener("click", () => { takeSnapshot("Manuell gespeichert"); renderVersions(); });
$("#version-list").addEventListener("click", event => {
  const button = event.target.closest("[data-version]");
  if (!button) return;
  try {
    const restored = parseState(JSON.parse(versions[Number(button.dataset.version)].json));
    takeSnapshot("Vor Wiederherstellung");
    state = restored; message = ""; save(); render(); $("#versions-dialog").close();
  } catch (error) { console.error(error); message = `Wiederherstellung fehlgeschlagen: ${error.message}`; showStatus(); }
});
function openPlaceholders() {
  const form = $("#placeholder-form");
  form.elements.company.value = state.vars.company; form.elements.job.value = state.vars.job;
  form.elements.company.placeholder = (state.recipientDetails && state.recipientDetails.company) || "z. B. Beispiel GmbH";
  $("#placeholder-dialog").showModal();
}
$("#placeholders").addEventListener("click", openPlaceholders);
$("#placeholder-form").addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget;
  state.vars = { company: form.elements.company.value.trim(), job: form.elements.job.value.trim() };
  message = ""; save(); render(); $("#placeholder-dialog").close();
});
$("#export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = "hireme-vorlage.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("#import").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const imported = parseState(JSON.parse(await file.text()));
    if (!confirm("Die aktuellen Daten durch die Vorlage ersetzen?")) return;
    takeSnapshot("Vor Import"); state = imported; loadBlocked = false; message = ""; save(); render();
  } catch (error) { console.error(error); message = `Import fehlgeschlagen: ${error.message}`; showStatus(); }
  finally { event.target.value = ""; }
});
for (const label of document.querySelectorAll('label[tabindex="0"]')) label.addEventListener("keydown", event => {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $(`#${label.htmlFor}`).click(); }
});

function showProposal() {
  if (!pdfRows) return;
  const type = $("#pdf-type").value;
  pdfProposal = PdfImport[type](pdfRows);
  const profile = Object.fromEntries(Object.entries(pdfProposal.profile).filter(([, value]) => value));
  const labels = { firstName: "Vorname", lastName: "Nachname", email: "E-Mail", phone: "Telefon", city: "PLZ und Ort", street: "Straße", website: "Website", recipient: "Empfänger", place: "Ort", date: "Datum", subject: "Betreff", salutation: "Anrede", body: "Anschreiben", closing: "Grußformel" };
  const lines = Object.entries(profile).map(([key, value]) => `${labels[key] || key}: ${value}`);
  if (type === "resume") {
    for (const section of pdfProposal.sections) {
      lines.push(`\n${section.title}`);
      for (const entry of section.entries) lines.push(`  ${[entry.date, entry.title, entry.subtitle, entry.description].filter(Boolean).join(" | ")}`);
    }
  } else {
    for (const [key, value] of Object.entries(pdfProposal.letter)) if (value) lines.push(`\n${labels[key] || key}:\n${key === "date" ? formattedDate(value) : value}`);
  }
  $("#recognized").textContent = lines.join("\n") || "Keine Angaben erkannt.";
  const count = Object.keys(profile).length + (type === "resume" ? pdfProposal.sections.length : Object.values(pdfProposal.letter).filter(Boolean).length);
  $("#import-summary").textContent = count ? `${count} Felder bzw. Abschnitte erkannt. Nicht erkannte Inhalte stehen rechts zum Nachschlagen.` : "Keine Angaben sicher erkannt. Der extrahierte Text steht rechts zum manuellen Übernehmen.";
  $("#apply-import").disabled = count === 0;
}
$("#pdf-type").addEventListener("change", showProposal);
$("#pdf-import").addEventListener("click", () => $("#pdf-file").click());
let localPdfLibrary;
function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`PDF-Bibliothek konnte nicht geladen werden: ${src}`));
    document.head.appendChild(script);
  });
}
async function loadPdfLibrary() {
  if (!localPdfLibrary) {
    localPdfLibrary = (async () => {
      await loadClassicScript("vendor/pdfjs/pdf.worker.browser.js");
      await loadClassicScript("vendor/pdfjs/pdf.browser.js");
      if (!globalThis.pdfjsWorker?.WorkerMessageHandler || !globalThis.pdfjsLib?.getDocument) throw new Error("PDF-Bibliothek ist nicht verfügbar.");
      return globalThis.pdfjsLib;
    })().catch(error => { localPdfLibrary = null; throw error; });
  }
  return localPdfLibrary;
}
let pdfQueue = [], pdfQueueIndex = 0;
$("#pdf-file").addEventListener("change", async event => {
  const files = Array.from(event.target.files); event.target.value = "";
  if (!files.length) return;
  pdfQueue = files; pdfQueueIndex = 0;
  $("#pdf-import").disabled = true;
  await processNextPdf();
});
async function processNextPdf() {
  if (pdfQueueIndex >= pdfQueue.length) {
    pdfQueue = []; $("#pdf-import").disabled = false; return;
  }
  const file = pdfQueue[pdfQueueIndex];
  $("#import-file").textContent = `Datei ${pdfQueueIndex + 1} von ${pdfQueue.length}: ${file.name}`;
  pdfRows = null; pdfProposal = null;
  try {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") throw new Error("Keine PDF-Datei.");
    message = "PDF wird lokal ausgewertet …"; showStatus();
    const pdfjs = await loadPdfLibrary();
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      cMapUrl: new URL("vendor/pdfjs/cmaps/", document.baseURI).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("vendor/pdfjs/standard_fonts/", document.baseURI).href
    }).promise;
    try {
      const pages = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        pages.push({ number, width: page.getViewport({ scale: 1 }).width, items: (await page.getTextContent()).items });
      }
      pdfRows = PdfImport.rowsFromPages(pages);
    } finally { await pdf.destroy(); }
    if (!pdfRows.length) throw new Error("Die PDF enthält keinen auslesbaren Text. Gescannte Dokumente werden derzeit nicht erkannt.");
    $("#extracted").textContent = pdfRows.map(row => row.text).join("\n");
    $("#pdf-type").value = PdfImport.detect(pdfRows) || (activeDocument === "letter" ? "letter" : "resume");
    showProposal(); message = ""; showStatus(); $("#import-dialog").returnValue = ""; $("#import-dialog").showModal();
  } catch (error) {
    console.error(error);
    $("#recognized").textContent = `Diese Datei konnte nicht gelesen werden: ${error.message}`;
    $("#extracted").textContent = "";
    $("#import-summary").textContent = "Überspringe die Datei oder brich die verbleibenden Importe ab.";
    $("#apply-import").disabled = true;
    message = ""; showStatus(); $("#import-dialog").returnValue = ""; $("#import-dialog").showModal();
  }
}
$("#import-dialog").addEventListener("close", () => {
  if ($("#import-dialog").returnValue === "abort") pdfQueueIndex = pdfQueue.length;
  else pdfQueueIndex++;
  processNextPdf();
});
$("#import-dialog").addEventListener("cancel", event => {
  event.preventDefault(); $("#import-dialog").close("skip");
});
$("#apply-import").addEventListener("click", () => {
  if (!pdfProposal) return;
  if (!confirm("Erkannte Daten übernehmen? Die im Hinweis genannten bestehenden Daten werden ersetzt.")) return;
  if (loadBlocked && !confirm("Die bisherigen Browserdaten konnten nicht geladen werden und werden durch diese Daten ersetzt. Fortfahren?")) return;
  takeSnapshot("Vor PDF-Import");
  for (const [key, value] of Object.entries(pdfProposal.profile)) if (value && key in state.profile) state.profile[key] = value;
  if ($("#pdf-type").value === "resume") {
    if (pdfProposal.sections.length) state.sections = pdfProposal.sections.map(section => ({ ...section, id: uid() }));
  } else {
    for (const [key, value] of Object.entries(pdfProposal.letter)) if (value) {
      state.letter[key] = value;
      if (state.letter.format) delete state.letter.format[key];
    }
  }
  activeDocument = $("#pdf-type").value; loadBlocked = false; message = ""; save(); render(); $("#import-dialog").close("applied");
});

let exportLibrary;
let exportInProgress = false;
async function loadExportLibrary() {
  if (!exportLibrary) {
    exportLibrary = (async () => {
      await loadClassicScript("vendor/export/pdf-lib.min.js");
      await loadClassicScript("vendor/export/jszip.min.js");
      if (!globalThis.PDFLib || !globalThis.JSZip) throw new Error("Exportbibliotheken sind nicht verfügbar.");
    })().catch(error => { exportLibrary = null; throw error; });
  }
  return exportLibrary;
}
function safeFilename(value) {
  const cleaned = value.normalize("NFC").trim().replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").replace(/\s+/g, "_").replace(/[. ]+$/g, "").slice(0, 100);
  return cleaned && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned) ? cleaned : "Name";
}
const MM = 72 / 25.4, PAGE_W = 595.28, PAGE_H = 841.89, MARGIN_X = 20 * MM, MARGIN_TOP = 19 * MM, MARGIN_BOTTOM = 20 * MM, CONTENT_W = PAGE_W - 2 * MARGIN_X;
function pdfColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
async function photoJpeg(photo, widthMm, heightMm) {
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("Foto konnte nicht verarbeitet werden.")); image.src = photo; });
  const canvas = document.createElement("canvas"), scale = 12;
  canvas.width = Math.round(widthMm * scale); canvas.height = Math.round(heightMm * scale);
  const context = canvas.getContext("2d"), cover = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const w = image.naturalWidth * cover, h = image.naturalHeight * cover;
  context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  return canvas.toDataURL("image/jpeg", 0.92);
}
async function renderPdfLayout(type, fontScale = 1) {
  const pdf = await PDFLib.PDFDocument.create(), d = state.design, serif = d.font === "Georgia";
  const reg = await pdf.embedFont(serif ? PDFLib.StandardFonts.TimesRoman : PDFLib.StandardFonts.Helvetica);
  const bold = await pdf.embedFont(serif ? PDFLib.StandardFonts.TimesRomanBold : PDFLib.StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(serif ? PDFLib.StandardFonts.TimesRomanItalic : PDFLib.StandardFonts.HelveticaOblique);
  const boldItalic = await pdf.embedFont(serif ? PDFLib.StandardFonts.TimesRomanBoldItalic : PDFLib.StandardFonts.HelveticaBoldOblique);
  const accent = pdfColor(d.color), rgbHex = hex => pdfColor(hex);
  const dark = rgbHex("#30313c"), muted = rgbHex("#777777"), subtle = rgbHex("#686976"), line = rgbHex("#e5e5e9");
  const sets = new Map([reg, bold, italic, boldItalic].map(font => [font, new Set(font.getCharacterSet())]));
  const clean = (font, text) => Array.from(String(text).normalize("NFC").replace(/\t/g, "  ").replace(/[\u00A0\u2007\u202F]/g, " ").replace(/[\u2010-\u2015]/g, "-")).map(ch => (ch === "\n" || sets.get(font).has(ch.codePointAt(0)) ? ch : "?")).join("");
  const measure = (font, size, text) => font.widthOfTextAtSize(text, size);
  const wrap = (font, size, text, width) => {
    const out = [];
    for (const raw of clean(font, text).split("\n")) {
      if (!raw.trim()) { out.push(""); continue; }
      let current = "";
      for (const word of raw.split(/ +/)) {
        const candidate = current ? `${current} ${word}` : word;
        if (measure(font, size, candidate) <= width) { current = candidate; continue; }
        if (current) out.push(current);
        current = word;
        while (measure(font, size, current) > width && current.length > 1) {
          let cut = current.length - 1;
          while (cut > 1 && measure(font, size, current.slice(0, cut)) > width) cut--;
          out.push(current.slice(0, cut)); current = current.slice(cut);
        }
      }
      out.push(current);
    }
    return out;
  };
  const drawLine = (page, font, size, color, text, x, top, lineH) => {
    if (text) page.drawText(text, { x, y: PAGE_H - top - (lineH - size) / 2 - size * 0.85, size, font, color });
  };
  const gap = h => ({ h, spacer: true, draw() {} });
  const rule = (w, thickness, color) => ({ h: thickness, draw(page, x, top) { page.drawRectangle({ x, y: PAGE_H - top - thickness, width: w, height: thickness, color }); } });
  const stack = parts => {
    const items = parts.flat(Infinity).filter(Boolean);
    return { items, h: items.reduce((sum, item) => sum + item.h, 0), draw(page, x, top) { let t = top; for (const item of items) { item.draw(page, x, t); t += item.h; } } };
  };
  const richRuns = (font, size, color, text, runs, uppercase = false, suffix = "") => {
    const raw = text || "", pieces = [], pattern = /\{\s*([a-z_]+)\s*\}/gi;
    let offset = 0, match;
    const styleAt = pos => runs.find(run => run.start <= pos && pos < run.end) || {};
    const add = (value, style) => {
      const isBold = style.bold === undefined ? font === bold : style.bold;
      const face = isBold ? (style.italic ? boldItalic : bold) : (style.italic ? italic : reg);
      const pt = (Number.isInteger(style.size) && style.size >= 6 && style.size <= 36 ? style.size : size) * fontScale;
      const ink = typeof style.color === "string" && /^#[0-9a-f]{6}$/i.test(style.color) ? rgbHex(style.color) : color;
      const transformed = uppercase ? value.toUpperCase() : value;
      const cleaned = clean(face, transformed);
      if (cleaned) pieces.push({ text: cleaned, font: face, size: pt, color: ink, underline: style.underline === true });
    };
    const addRaw = (start, end) => {
      let pos = start;
      while (pos < end) {
        const style = styleAt(pos);
        let next = end;
        for (const run of runs) {
          if (run.start > pos && run.start < next) next = run.start;
          if (run.end > pos && run.end < next) next = run.end;
        }
        add(raw.slice(pos, next), style); pos = next;
      }
    };
    while ((match = pattern.exec(raw))) {
      addRaw(offset, match.index);
      add(resolve(match[0]), styleAt(match.index));
      offset = match.index + match[0].length;
    }
    addRaw(offset, raw.length);
    add(suffix, {});
    return pieces;
  };
  const richLines = (font, size, color, text, w, options) => {
    const pieces = options.pieces || richRuns(font, size, color, text, options.runs, options.uppercase, options.suffix);
    const glyphs = pieces.flatMap(piece => Array.from(piece.text, ch => ({ ...piece, text: ch, width: ch === "\n" ? 0 : measure(piece.font, piece.size, ch) })));
    const lines = []; let row = [], rowWidth = 0, word = [], wordWidth = 0, space = null;
    const pushRow = () => { lines.push(row); row = []; rowWidth = 0; };
    const flushWord = () => {
      if (!word.length) return;
      if (row.length && rowWidth + (space ? space.width : 0) + wordWidth > w) pushRow();
      if (row.length && space) { row.push(space); rowWidth += space.width; }
      for (const glyph of word) {
        if (row.length && rowWidth + glyph.width > w) pushRow();
        row.push(glyph); rowWidth += glyph.width;
      }
      word = []; wordWidth = 0; space = null;
    };
    for (const glyph of glyphs) {
      if (glyph.text === "\n") { flushWord(); pushRow(); space = null; }
      else if (glyph.text === " ") { flushWord(); if (row.length && !space) space = glyph; }
      else { word.push(glyph); wordWidth += glyph.width; }
    }
    flushWord(); pushRow();
    return lines.map(row => {
      const lineH = Math.max(options.lineH * fontScale, ...row.map(glyph => glyph.size * options.lineH / size));
      const groups = [];
      for (const glyph of row) {
        const prev = groups[groups.length - 1];
        if (prev && prev.font === glyph.font && prev.size === glyph.size && prev.color === glyph.color && prev.underline === glyph.underline) {
          prev.text += glyph.text;
        } else groups.push({ ...glyph });
      }
      for (const group of groups) group.width = measure(group.font, group.size, group.text);
      const width = groups.reduce((sum, group) => sum + group.width, 0);
      return { h: lineH, width, draw(page, x, top) {
        let cursor = options.align === "right" ? x + w - width : x;
        for (const group of groups) {
          drawLine(page, group.font, group.size, group.color, group.text, cursor, top, lineH);
          if (group.underline) {
            const y = PAGE_H - top - (lineH - group.size) / 2 - group.size * 0.85 - group.size * 0.1;
            page.drawLine({ start: { x: cursor, y }, end: { x: cursor + group.width, y }, thickness: Math.max(0.5, group.size / 16), color: group.color });
          }
          cursor += group.width;
        }
      } };
    });
  };
  const textLines = (font, size, color, text, w, { lineH = size * 1.45, align = "left", runs, uppercase = false, suffix = "" } = {}) => {
    const value = (uppercase ? resolve(text || "").toUpperCase() : resolve(text || "")) + suffix;
    if (!value.trim()) return [];
    if (runs && runs.length) return richLines(font, size, color, text, w, { lineH, align, runs, uppercase, suffix });
    size *= fontScale;
    lineH *= fontScale;
    return wrap(font, size, value, w).map(lineText => ({ h: lineH, draw(page, x, top) {
      drawLine(page, font, size, color, lineText, align === "right" ? x + w - measure(font, size, lineText) : x, top, lineH);
    } }));
  };
  const textBlock = (...args) => { const lines = textLines(...args); return lines.length ? stack(lines) : null; };
  const inline = (items, w, size, color, gapX, lineH) => {
    size *= fontScale;
    lineH *= fontScale;
    const rows = [[]]; let used = 0;
    for (const item of items) {
      const text = clean(reg, item.text), width = measure(reg, size, text) + (item.label ? measure(bold, size, clean(bold, item.label)) : 0);
      if (width > w) {
        if (used) { rows.push([]); used = 0; }
        for (const segment of wrap(reg, size, `${item.label || ""}${text}`, w)) {
          if (used) rows.push([]);
          rows[rows.length - 1].push({ text: segment, width: measure(reg, size, segment) });
          used = w;
        }
        continue;
      }
      if (used && used + width > w) { rows.push([]); used = 0; }
      rows[rows.length - 1].push({ ...item, text, width }); used += width + gapX;
    }
    return rows.filter(row => row.length).map(row => ({ h: lineH, draw(page, x, top) {
      let cursor = x;
      for (const item of row) {
        if (item.label) { drawLine(page, bold, size, color, clean(bold, item.label), cursor, top, lineH); cursor += measure(bold, size, clean(bold, item.label)); }
        drawLine(page, reg, size, color, item.text, cursor, top, lineH); cursor += item.width - (item.label ? measure(bold, size, clean(bold, item.label)) : 0) + gapX;
      }
    } }));
  };
  const customField = (field, w) => {
    const label = field.label.trim() ? field.label : "", value = field.value || "";
    if (!label && !value.trim()) return null;
    const labelRuns = field.format?.label, valueRuns = field.format?.value;
    return stack([
      labelRuns?.length ? textLines(bold, 10, dark, label, w, { runs: labelRuns, suffix: label ? ":" : "" }) : textLines(bold, 10, dark, label ? `${resolve(label)}:` : "", w),
      textLines(reg, 10, dark, valueRuns?.length ? value : resolve(value), w, { runs: valueRuns })
    ]);
  };
  const titleDateRow = (title, date, w, titleFont, titleSize, titleColor, format) => {
    const dateText = resolve(date || "");
    const dateLines = dateText ? textLines(reg, 9, muted, format?.date?.length ? date : dateText, w * 0.4, { lineH: 13, align: "right", runs: format?.date }) : [];
    const dateW = dateText ? (format?.date?.length ? Math.min(Math.max(...dateLines.map(item => item.width || 0)), w * 0.4) : Math.min(measure(reg, 9 * fontScale, clean(reg, dateText)), w * 0.4)) : 0;
    const titleLines = textLines(titleFont, titleSize, titleColor, title, w - (dateW ? dateW + 10 : 0), { lineH: titleSize * 1.45, runs: format?.title });
    return stack(Array.from({ length: Math.max(titleLines.length, dateLines.length) }, (_, i) => ({
      h: Math.max(titleLines[i]?.h || 0, dateLines[i]?.h || 0),
      draw(page, x, top) { if (titleLines[i]) titleLines[i].draw(page, x, top); if (dateLines[i]) dateLines[i].draw(page, x + w * 0.6, top); }
    })));
  };
  const ratingBlock = (rating, w) => rating ? { h: 15, draw(page, x, top) {
    for (let i = 0; i < rating.max; i++) {
      const cx = x + 4 + i * 9.5, cy = PAGE_H - top - 7.5;
      page.drawCircle({ x: cx, y: cy, size: 3.1, borderColor: accent, borderWidth: 0.8, color: i < rating.value ? accent : PDFLib.rgb(1, 1, 1) });
    }
    drawLine(page, reg, 9, muted, `${rating.value}/${rating.max}`, x + 4 + rating.max * 9.5 + 4, top, 15);
  } } : null;
  const resumeEntry = (entry, w) => stack([
    titleDateRow(entry.title, entry.date, w, bold, 10, dark, entry.format),
    textBlock(reg, 10, subtle, entry.subtitle, w, { runs: entry.format?.subtitle }),
    entry.description && entry.description.trim() ? [gap(3), textBlock(reg, 10, dark, entry.description, w, { runs: entry.format?.description })] : null,
    (entry.fields || []).map(field => customField(field, w)),
    ratingBlock(entry.rating, w),
    gap(8)
  ]);
  const sectionBlocks = (section, w) => {
    const entries = section.entries.filter(entryHasContent).map(entry => resumeEntry(entry, w));
    const size = d.template === "classic" ? 13 : 11, formatted = section.format?.title?.length;
    const title = formatted ? section.title : (d.template === "modern" ? resolve(section.title).toUpperCase() : resolve(section.title));
    const heading = stack([
      textBlock(bold, size, accent, title, w, { lineH: size * 1.45, runs: section.format?.title, uppercase: formatted && d.template === "modern" }), gap(5),
      d.template === "minimal" ? null : rule(w, 0.75, line), gap(d.template === "minimal" ? 5 : 7.5)
    ]);
    return entries.length ? [stack([heading, entries[0]]), ...entries.slice(1), gap(14)] : [];
  };
  let page = null, top = 0, startTop = 0, repeatHeader = null;
  const newPage = (first) => {
    page = pdf.addPage([PAGE_W, PAGE_H]); top = first ?? MARGIN_TOP;
    if (repeatHeader) { repeatHeader.draw(page, MARGIN_X, top); top += repeatHeader.h; }
    startTop = top;
  };
  const place = columns => {
    const queues = columns.map(column => [...column.blocks]);
    let ys = columns.map(() => top);
    for (;;) {
      columns.forEach((column, i) => {
        while (queues[i].length) {
          const block = queues[i][0];
          if (block.h > PAGE_H - MARGIN_BOTTOM - startTop) {
            if (block.items && block.items.length) { queues[i].splice(0, 1, ...block.items); continue; }
            throw new Error("Ein Inhalt ist zu groß für eine PDF-Seite. Bitte kürze ihn.");
          }
          if (ys[i] + block.h > PAGE_H - MARGIN_BOTTOM) {
            if (block.spacer) { queues[i].shift(); continue; }
            if (block.items && block.items.length && block.h > (PAGE_H - MARGIN_BOTTOM - startTop) / 2) {
              queues[i].splice(0, 1, ...block.items); continue;
            }
            if (ys[i] > startTop) break;
            throw new Error("Ein Inhalt ist zu groß für eine PDF-Seite. Bitte kürze ihn.");
          }
          queues[i].shift(); block.draw(page, column.x, ys[i]); ys[i] += block.h;
        }
      });
      if (queues.every(queue => !queue.length)) break;
      newPage(); ys = columns.map(() => top);
    }
    top = Math.max(...ys);
  };
  const full = blocks => place([{ x: MARGIN_X, blocks: blocks.flat(Infinity).filter(Boolean) }]);
  const name = [state.profile.firstName, state.profile.lastName].filter(Boolean).join(" "), p = state.profile;
  newPage(type === "letter" ? 100 * MM : MARGIN_TOP);

  if (type === "resume") {
    let photoImageRef = null;
    const photoW = p.photo ? d.photoWidth * MM : 0, photoH = p.photo ? d.photoHeight * MM : 0;
    if (p.photo) photoImageRef = await pdf.embedJpg(await photoJpeg(p.photo, d.photoWidth, d.photoHeight));
    const leftW = CONTENT_W - (p.photo ? photoW + 20 : 0);
    const extras = state.extras.filter(fieldHasContent);
    let contact;
    if (extras.some(field => field.format?.label?.length || field.format?.value?.length)) {
      const pieces = [];
      const appendGap = () => { if (pieces.length) pieces.push(...richRuns(reg, 9, muted, "   ", [])); };
      for (const text of [p.street, p.city, p.email, p.phone, p.website].filter(value => resolve(value).trim())) {
        appendGap(); pieces.push(...richRuns(reg, 9, muted, text, []));
      }
      for (const field of extras) {
        appendGap();
        if (field.label.trim()) pieces.push(...richRuns(bold, 9, muted, field.label, field.format?.label || [], false, ": "));
        pieces.push(...richRuns(reg, 9, muted, field.value, field.format?.value || []));
      }
      contact = richLines(reg, 9, muted, "", leftW, { lineH: 13, align: "left", pieces });
    } else {
      contact = inline([p.street, p.city, p.email, p.phone, p.website].map(resolve).filter(value => value.trim()).map(text => ({ text }))
        .concat(extras.map(field => ({ label: field.label.trim() ? `${resolve(field.label)}: ` : "", text: resolve(field.value) }))), leftW, 9, muted, 10.5, 13);
    }
    const left = stack([
      textBlock(bold, 26, rgbHex("#252633"), name, leftW, { lineH: 29 }), gap(4),
      textBlock(bold, 12, accent, p.headline, leftW, { lineH: 17 }),
      contact.length ? [gap(9), contact] : null
    ]);
    const headH = Math.max(left.h, photoH), hasRule = d.template !== "minimal", thick = d.template === "classic" ? 0.75 : 1.5;
    const header = { h: headH + 13.5 + (hasRule ? thick : 0) + 15, draw(pg, x, t) {
      left.draw(pg, x, t);
      if (photoImageRef) pg.drawImage(photoImageRef, { x: x + CONTENT_W - photoW, y: PAGE_H - t - photoH, width: photoW, height: photoH });
      if (hasRule) pg.drawRectangle({ x, y: PAGE_H - t - headH - 13.5 - thick, width: CONTENT_W, height: thick, color: accent });
    } };
    if (header.h > PAGE_H - MARGIN_TOP - MARGIN_BOTTOM - 30) throw new Error("Der Lebenslaufkopf ist zu groß. Bitte kürze die persönlichen Angaben.");
    full([header]);
    repeatHeader = header;
    startTop = top;
    const sections = state.sections.filter(section => section.entries.some(entryHasContent));
    for (let i = 0; i < sections.length;) {
      const half = CONTENT_W / 2;
      if (sections[i].width === 100) { full(sectionBlocks(sections[i], CONTENT_W - 10.5)); i++; continue; }
      const next = sections[i + 1] && sections[i + 1].width === 50 ? sections[i + 1] : null;
      const columns = [{ x: MARGIN_X, blocks: sectionBlocks(sections[i], half - 10.5) }];
      if (next) columns.push({ x: MARGIN_X + half, blocks: sectionBlocks(next, half - 10.5) });
      place(columns); i += next ? 2 : 1;
    }
  } else if (type === "letter") {
    const l = state.letter, sender = [name, p.street, p.city].filter(Boolean).join(" · ");
    const info = [name, p.street, p.city, p.email, p.phone].filter(Boolean).flatMap(text => textLines(reg, 9, rgbHex("#555555"), text, 65 * MM, { lineH: 13.5 }));
    const recipient = textLines(reg, 10, dark, l.recipient, 85 * MM, { lineH: 13 });
    const senderLines = textLines(reg, 7, dark, sender, 85 * MM, { lineH: 8.4 });
    if (senderLines.length > 1 || recipient.length * 13 * fontScale > 36 * MM || info.length * 13.5 * fontScale > 55 * MM) throw new Error("Die Adresse oder die Kontaktdaten sind für den Briefkopf zu lang. Bitte kürzen.");
    senderLines.forEach(item => item.draw(page, MARGIN_X, 46 * MM));
    recipient.forEach((item, i) => item.draw(page, MARGIN_X, 54 * MM + i * 13 * fontScale));
    info.forEach((item, i) => item.draw(page, PAGE_W - MARGIN_X - 65 * MM, 45 * MM + i * 13.5 * fontScale));
    const dateLine = [resolve(l.place), formattedDate(l.date)].filter(Boolean).join(", ");
    const subjectColor = d.template === "minimal" ? dark : accent;
    full([
      l.format?.place?.length
        ? textBlock(reg, 10, dark, l.place, CONTENT_W, { align: "right", runs: l.format.place, suffix: l.place && formattedDate(l.date) ? `, ${formattedDate(l.date)}` : formattedDate(l.date) || "" })
        : textBlock(reg, 10, dark, dateLine, CONTENT_W, { align: "right" }), gap(10 * MM),
      textBlock(bold, d.template === "classic" ? 11 : 10, subjectColor, l.subject, CONTENT_W, { runs: l.format?.subject }),
      d.template === "modern" && l.subject.trim() ? [gap(4), rule(CONTENT_W, 0.75, accent)] : null, gap(8 * MM),
      textBlock(reg, 10, dark, l.salutation, CONTENT_W), gap(5 * MM),
      textLines(reg, 10, dark, l.body, CONTENT_W, { lineH: 16, runs: l.format?.body }), gap(8 * MM),
      textBlock(reg, 10, dark, l.closing, CONTENT_W, { runs: l.format?.closing }), gap(12 * MM),
      textBlock(reg, 10, dark, name, CONTENT_W)
    ]);
  } else {
    const header = stack([textBlock(bold, 22, accent, state.portfolio.title, CONTENT_W, { lineH: 30, runs: state.portfolio.format?.title }), textBlock(reg, 10, muted, name, CONTENT_W), gap(10.5), rule(CONTENT_W, 1.5, accent), gap(15)]);
    full([header]);
    for (const entry of state.portfolio.entries.filter(item => [item.title, item.date, item.description, item.link].some(value => value.trim()))) {
      full([stack([
        titleDateRow(entry.title, entry.date, CONTENT_W, bold, 10, dark, entry.format),
        entry.description.trim() ? [gap(3), textBlock(reg, 10, dark, entry.description, CONTENT_W, { runs: entry.format?.description })] : null,
        textBlock(reg, 9, accent, entry.link, CONTENT_W, { runs: entry.format?.link }),
        gap(15)
      ])]);
    }
  }
  const pages = pdf.getPages();
  if (pages.length > 1) pages.forEach((current, index) => {
    const label = `Seite ${index + 1} von ${pages.length}`;
    current.drawText(label, { x: PAGE_W - MARGIN_X - measure(reg, 9, label), y: 10 * MM, size: 9, font: reg, color: muted });
  });
  return { bytes: await pdf.save(), pageCount: pages.length, lastUsed: top - startTop, lastCapacity: PAGE_H - MARGIN_BOTTOM - startTop };
}
async function renderPdf(type) {
  const normal = await renderPdfLayout(type);
  const occupancy = normal.lastUsed / normal.lastCapacity;
  if (normal.pageCount > 1 && occupancy > 0 && occupancy < 0.08) {
    const smaller = await renderPdfLayout(type, 0.95);
    if (smaller.pageCount < normal.pageCount) return smaller.bytes;
  }
  if (occupancy >= 0.85 && occupancy <= 0.95) {
    const larger = await renderPdfLayout(type, 1.05);
    if (larger.pageCount === normal.pageCount) return larger.bytes;
  }
  return normal.bytes;
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
let previewTimer, previewRevision = 0, previewRunning = false;
function schedulePreview() {
  previewRevision++;
  clearTimeout(previewTimer);
  $("#preview-status").textContent = "Seitenvorschau wird aktualisiert …";
  previewTimer = setTimeout(updatePreview, 700);
}
async function updatePreview() {
  if (previewRunning) return;
  previewRunning = true;
  const revision = previewRevision, type = activeDocument;
  let documentPdf;
  try {
    await loadExportLibrary();
    const bytes = await renderPdf(type);
    const pdfjs = await loadPdfLibrary();
    documentPdf = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      cMapUrl: new URL("vendor/pdfjs/cmaps/", document.baseURI).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("vendor/pdfjs/standard_fonts/", document.baseURI).href
    }).promise;
    const pages = document.createDocumentFragment();
    for (let number = 1; number <= documentPdf.numPages; number++) {
      if (revision !== previewRevision) return;
      const pdfPage = await documentPdf.getPage(number), viewport = pdfPage.getViewport({ scale: 0.9 });
      const figure = document.createElement("figure"), caption = document.createElement("figcaption"), canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      canvas.setAttribute("aria-label", `PDF-Vorschau Seite ${number} von ${documentPdf.numPages}`);
      caption.textContent = `Seite ${number} von ${documentPdf.numPages}`;
      await pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      figure.append(canvas, caption); pages.append(figure);
    }
    if (revision === previewRevision) {
      $("#preview-pages").replaceChildren(pages);
      $("#preview-status").textContent = `${documentPdf.numPages} ${documentPdf.numPages === 1 ? "Seite" : "Seiten"}`;
    }
  } catch (error) {
    console.error(error);
    if (revision === previewRevision) {
      $("#preview-pages").replaceChildren();
      $("#preview-status").textContent = `Seitenvorschau fehlgeschlagen: ${error.message}`;
    }
  } finally {
    if (documentPdf) await documentPdf.destroy();
    previewRunning = false;
    if (revision !== previewRevision) { clearTimeout(previewTimer); previewTimer = setTimeout(updatePreview, 700); }
  }
}
$("#pdf-download").addEventListener("click", () => {
  const form = $("#download-form");
  form.elements.name.value = [state.profile.firstName, state.profile.lastName].filter(Boolean).join("_");
  $("#download-status").textContent = "";
  $("#download-dialog").showModal();
});
$("#download-dialog").addEventListener("cancel", event => { if (exportInProgress) event.preventDefault(); });
$("#download-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget, selected = Array.from(form.querySelectorAll('input[name="documents"]:checked'), input => input.value);
  if (!selected.length) { $("#download-status").textContent = "Bitte mindestens ein Dokument auswählen."; return; }
  if (selected.includes("letter")) {
    if (state.letter.date && !parseEditedDate(formattedDate(state.letter.date)) && !confirm("Das Datum ist ungültig. Trotzdem exportieren?")) return;
  }
  const name = safeFilename(form.elements.name.value);
  const buttons = form.querySelectorAll("button");
  exportInProgress = true;
  buttons.forEach(button => { button.disabled = true; });
  try {
    await loadExportLibrary();
    const files = [];
    for (const type of selected) {
      $("#download-status").textContent = `${{ letter: "Anschreiben", resume: "Lebenslauf", portfolio: "Arbeitsproben" }[type]} wird erstellt …`;
      const bytes = await renderPdf(type);
      files.push({ type, bytes });
    }
    const zip = new JSZip();
    for (const file of files) {
      const label = { letter: "Anschreiben", resume: "Lebenslauf", portfolio: "Arbeitsproben" }[file.type];
      zip.file(`${label}_${name}.pdf`, file.bytes);
    }
    downloadBlob(await zip.generateAsync({ type: "blob" }), `bewerbung_${name}.zip`);
    $("#download-dialog").close();
  } catch (error) {
    console.error(error);
    $("#download-status").textContent = `PDF-Erstellung fehlgeschlagen: ${error.message}`;
  } finally { exportInProgress = false; buttons.forEach(button => { button.disabled = false; }); }
});
window.addEventListener("resize", updateAddressWarning);
render(); updateStorageIndicator(); showStatus(); takeSnapshot("Startstand");
if (!hasStarted) $("#welcome-dialog").showModal();
