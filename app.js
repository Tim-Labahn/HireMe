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
function parseFields(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error("Ungültige eigene Felder.");
  return list.map(field => {
    if (!isRecord(field) || typeof field.label !== "string" || typeof field.value !== "string") throw new Error("Ungültiges eigenes Feld.");
    return { label: field.label, value: field.value };
  });
}
function parseState(data) {
  if (!isRecord(data) || !isRecord(data.profile) || !isRecord(data.letter) || !isRecord(data.design) || !Array.isArray(data.sections)) throw new Error("Die Datei enthält keine gültige Sicherung.");
  const defaults = defaultState();
  const strings = (input, shape) => Object.fromEntries(Object.keys(shape).map(key => {
    if (typeof shape[key] !== "string") return [key, shape[key]];
    if (typeof input[key] !== "string") throw new Error(`Ungültiges Feld: ${key}`);
    return [key, input[key]];
  }));
  const profile = strings(data.profile, defaults.profile);
  if (profile.photo && !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(profile.photo)) throw new Error("Das Fotoformat wird nicht unterstützt.");
  const letter = strings(data.letter, defaults.letter), design = strings(data.design, defaults.design);
  if (!["modern", "classic", "minimal"].includes(design.template) || !["Arial", "Georgia", "Verdana"].includes(design.font) || !/^#[0-9a-f]{6}$/i.test(design.color)) throw new Error("Ungültige Designeinstellungen.");
  for (const key of ["photoWidth", "photoHeight"]) {
    if (!Number.isFinite(data.design[key]) || data.design[key] < 15 || data.design[key] > 70) throw new Error("Ungültige Fotogröße.");
    design[key] = data.design[key];
  }
  const ids = new Set();
  const sections = data.sections.map(section => {
    if (!isRecord(section) || typeof section.id !== "string" || !section.id || ids.has(section.id) || typeof section.title !== "string" || ![50, 100].includes(section.width) || !Array.isArray(section.entries)) throw new Error("Ungültiger Lebenslaufabschnitt.");
    ids.add(section.id);
    return { id: section.id, title: section.title, width: section.width, entries: section.entries.map(entry => {
      if (!isRecord(entry)) throw new Error("Ungültiger Eintrag.");
      const result = strings(entry, { title: "", subtitle: "", date: "", description: "" });
      const fields = parseFields(entry.fields);
      if (fields.length) result.fields = fields;
      if (entry.rating !== undefined && entry.rating !== null) {
        if (!isRecord(entry.rating) || ![5, 10].includes(entry.rating.max) || !Number.isInteger(entry.rating.value) || entry.rating.value < 1 || entry.rating.value > entry.rating.max) throw new Error("Ungültige Bewertung.");
        result.rating = { max: entry.rating.max, value: entry.rating.value };
      }
      return result;
    }) };
  });
  let portfolio = defaults.portfolio;
  if (data.portfolio !== undefined) {
    if (!isRecord(data.portfolio) || typeof data.portfolio.title !== "string" || !Array.isArray(data.portfolio.entries)) throw new Error("Ungültige Arbeitsproben.");
    portfolio = { title: data.portfolio.title, entries: data.portfolio.entries.map(entry => {
      if (!isRecord(entry)) throw new Error("Ungültige Arbeitsprobe.");
      return strings(entry, { title: "", date: "", description: "", link: "" });
    }) };
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
    ? "Speicherung: lokal in diesem Browser. Erstelle regelmäßig eine Sicherung."
    : "Speicherung: nur in diesem Tab. Beim Neuladen oder Schließen gehen Änderungen verloren.";
}
function save() {
  scheduleSnapshot();
  if (storageMode !== "local") { showStatus(); return; }
  if (loadBlocked) { showStatus(); return; }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); saveError = ""; }
  catch (error) { saveError = "Speichern im Browser fehlgeschlagen. Exportiere eine Sicherung und prüfe den verfügbaren Speicherplatz."; console.error(error); }
  showStatus();
}
function loadSavedState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) state = parseState(JSON.parse(saved));
  } catch (error) {
    console.error(error); loadBlocked = true;
    saveError = "Die gespeicherten Daten konnten nicht geladen werden. Importiere eine Sicherung; bis dahin werden vorhandene Browserdaten nicht überschrieben.";
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
function editable(group, key, placeholder, options = {}) {
  const value = options.value === undefined ? state[group][key] : options.value;
  const tag = options.tag || "span", classes = options.className || "";
  const section = options.section === undefined ? "" : ` data-section="${options.section}"`;
  const entry = options.entry === undefined ? "" : ` data-entry="${options.entry}"`;
  const field = options.field === undefined ? "" : ` data-field="${options.field}"`;
  const plain = PLAIN_KEYS.has(key);
  return `<${tag} class="${classes}" contenteditable="true" role="textbox" spellcheck="${!plain}" lang="de" autocorrect="${plain ? "off" : "on"}" autocapitalize="${plain ? "off" : "sentences"}" aria-label="${escapeHtml(placeholder)}" aria-multiline="${Boolean(options.multiline)}" data-group="${group}" data-key="${key}"${section}${entry}${field} data-placeholder="${escapeHtml(placeholder)}" data-raw="${escapeHtml(value)}"${options.optional && !value ? " hidden" : ""}>${escapeHtml(resolve(value))}</${tag}>`;
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
  const word = match[1], start = before.length - word.length, prefix = before.slice(0, start);
  let fixed = AUTOCORRECT[word.toLowerCase()] || word;
  if (fixed !== word && word[0] !== word[0].toLowerCase()) fixed = fixed[0].toUpperCase() + fixed.slice(1);
  const sentenceStart = start === 0 || (/[.!?][ \u00A0]+$/.test(prefix) && !/(?:^|\s)\p{L}{1,2}[.!?][ \u00A0]+$/u.test(prefix));
  if (element.getAttribute("aria-multiline") === "true" && sentenceStart && /^[a-zäöüß]/.test(fixed)) fixed = fixed[0].toUpperCase() + fixed.slice(1);
  if (fixed !== word) node.replaceData(start, word.length, fixed);
}
function person(key, placeholder, options) { return editable("profile", key, placeholder, options); }
function letterField(key, placeholder, options) { return editable("letter", key, placeholder, options); }
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
    <div class="resume-name">${person("firstName", "Vorname")} ${person("lastName", "Nachname")}</div>
    ${person("headline", "Berufsbezeichnung / Profil", { tag: "div", className: "headline block" })}
    <div class="contact">${person("street", "Straße und Hausnummer")}${person("city", "PLZ und Ort")}${person("email", "E-Mail")}${person("phone", "Telefon")}${person("website", "Website / LinkedIn")}</div>
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
  const paper = $("#paper"), d = state.design;
  paper.className = `paper template-${d.template}${activeDocument === "letter" ? " letter-paper" : ""}`;
  paper.style.setProperty("--accent", d.color);
  paper.style.setProperty("--doc-font", `"${d.font}", ${d.font === "Georgia" ? "serif" : "sans-serif"}`);
  paper.innerHTML = activeDocument === "resume" ? renderResume() : activeDocument === "letter" ? renderLetter() : renderPortfolio();
  document.querySelectorAll(".document-button").forEach(button => button.classList.toggle("active", button.dataset.document === activeDocument));
  for (const name of ["template", "font", "color"]) $(`#${name}`).value = d[name];
  for (const dimension of ["width", "height"]) {
    const value = d[dimension === "width" ? "photoWidth" : "photoHeight"];
    $(`#photo-${dimension}`).value = value; $(`#photo-${dimension}-value`).textContent = `${value} mm`;
  }
  for (const id of ["add-section", "photo-label", "remove-photo", "photo-width-label", "photo-height-label"]) $(`#${id}`).hidden = activeDocument !== "resume";
  $("#add-work").hidden = activeDocument !== "portfolio";
  $("#edit-recipient").hidden = activeDocument !== "letter";
  updateAddressWarning();
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
$("#paper").addEventListener("input", event => {
  const element = event.target.closest("[contenteditable]");
  if (!element) return;
  const { group, key, section, entry, field } = element.dataset;
  if (event.inputType === "insertText" && event.data && /^[ .,!?;:]$/.test(event.data) && !PLAIN_KEYS.has(key)) autocorrect(element, event.data);
  const value = element.innerText.replace(/\r/g, "").replace(/\u00A0/g, " ").replace(/\n+$/, "");
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
  save(); updateAddressWarning();
});
$("#paper").addEventListener("keydown", event => {
  if (event.key === "Enter" && event.shiftKey && event.target.matches('[data-group="entry"][data-key="title"]')) {
    event.preventDefault();
    const subtitle = event.target.closest(".resume-entry").querySelector('[data-key="subtitle"]');
    subtitle.hidden = false; subtitle.focus();
    return;
  }
  if (event.key === "Enter" && event.target.matches('[contenteditable][aria-multiline="false"]')) event.preventDefault();
});
$("#paper").addEventListener("focusin", event => {
  const element = event.target;
  if (element.isContentEditable && element.dataset.raw !== undefined && element.textContent !== element.dataset.raw) element.textContent = element.dataset.raw;
});
$("#paper").addEventListener("focusout", event => {
  const element = event.target;
  if (element.isContentEditable && element.dataset.raw !== undefined) {
    const shown = resolve(element.dataset.raw);
    if (element.textContent !== shown) element.textContent = shown;
    document.querySelectorAll('[contenteditable][data-raw*="{"]').forEach(other => { if (other !== element) { const text = resolve(other.dataset.raw); if (other.textContent !== text) other.textContent = text; } });
  }
  if (element.matches('[contenteditable][data-key="subtitle"], [contenteditable][data-group="entry"][data-key="date"], [contenteditable][data-group="entry"][data-key="description"], [contenteditable][data-group="work"][data-key="date"], [contenteditable][data-group="work"][data-key="description"], [contenteditable][data-group="work"][data-key="link"]') && !element.innerText.trim()) element.hidden = true;
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
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const index = Number(button.dataset.index), action = button.dataset.action;
  if (action === "show-field") {
    const group = button.dataset.group, entry = button.dataset.entry;
    const element = button.closest(group === "work" ? ".work-entry" : ".resume-entry").querySelector(`[data-group="${group}"][data-key="${button.dataset.field}"][data-entry="${entry}"]`);
    button.closest("details").open = false; element.hidden = false; element.focus(); return;
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
  const photo = $(".photo"); if (photo) photo.style[dimension] = `${event.target.value}mm`;
  save();
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
  $("#current-recipient").textContent = state.letter.recipient || "(noch leer)";
  $("#recipient-dialog").showModal();
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
  const lines = [details.company, details.department, details.contact, details.street, [details.postal, details.city].filter(Boolean).join(" "), details.country].filter(Boolean);
  if (!lines.length) { $("#recipient-status").textContent = "Bitte mindestens eine Empfängerangabe eintragen."; return; }
  if (state.letter.recipient && state.letter.recipient !== lines.join("\n") && !confirm("Das bestehende Empfängerfeld durch diese Angaben ersetzen?")) return;
  state.letter.recipient = lines.join("\n");
  state.recipientDetails = { ...details, snapshot: state.letter.recipient };
  if (choice === "frau") state.letter.salutation = `Sehr geehrte Frau ${details.salutationName},`;
  else if (choice === "herr") state.letter.salutation = `Sehr geehrter Herr ${details.salutationName},`;
  else if (choice === "general") state.letter.salutation = "Sehr geehrte Damen und Herren,";
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
  link.href = url; link.download = "hireme-sicherung.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("#import").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const imported = parseState(JSON.parse(await file.text()));
    if (!confirm("Die aktuellen Daten durch die Sicherung ersetzen?")) return;
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
    for (const [key, value] of Object.entries(pdfProposal.letter)) if (value) state.letter[key] = value;
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
async function renderPdf(type) {
  const pdf = await PDFLib.PDFDocument.create(), d = state.design, serif = d.font === "Georgia";
  const reg = await pdf.embedFont(serif ? PDFLib.StandardFonts.TimesRoman : PDFLib.StandardFonts.Helvetica);
  const bold = await pdf.embedFont(serif ? PDFLib.StandardFonts.TimesRomanBold : PDFLib.StandardFonts.HelveticaBold);
  const accent = pdfColor(d.color), rgbHex = hex => pdfColor(hex);
  const dark = rgbHex("#30313c"), muted = rgbHex("#777777"), subtle = rgbHex("#686976"), line = rgbHex("#e5e5e9");
  const sets = new Map([[reg, new Set(reg.getCharacterSet())], [bold, new Set(bold.getCharacterSet())]]);
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
  const gap = h => ({ h, draw() {} });
  const rule = (w, thickness, color) => ({ h: thickness, draw(page, x, top) { page.drawRectangle({ x, y: PAGE_H - top - thickness, width: w, height: thickness, color }); } });
  const stack = parts => {
    const items = parts.flat(Infinity).filter(Boolean);
    return { h: items.reduce((sum, item) => sum + item.h, 0), draw(page, x, top) { let t = top; for (const item of items) { item.draw(page, x, t); t += item.h; } } };
  };
  const textLines = (font, size, color, text, w, { lineH = size * 1.45, align = "left" } = {}) => {
    const value = resolve(text || "");
    if (!value.trim()) return [];
    return wrap(font, size, value, w).map(lineText => ({ h: lineH, draw(page, x, top) {
      drawLine(page, font, size, color, lineText, align === "right" ? x + w - measure(font, size, lineText) : x, top, lineH);
    } }));
  };
  const textBlock = (...args) => { const lines = textLines(...args); return lines.length ? stack(lines) : null; };
  const inline = (items, w, size, color, gapX, lineH) => {
    const rows = [[]]; let used = 0;
    for (const item of items) {
      const text = clean(reg, item.text), width = measure(reg, size, text) + (item.label ? measure(bold, size, clean(bold, item.label)) : 0);
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
    const label = field.label.trim() ? `${resolve(field.label)}:` : "", value = resolve(field.value || "");
    if (!label && !value.trim()) return null;
    const labelW = label ? measure(bold, 10, clean(bold, label)) + 4 : 0, valueW = Math.max(w - labelW, w * 0.4);
    const lines = wrap(reg, 10, value, valueW), count = Math.max(lines.length, 1);
    return { h: count * 14.5, draw(page, x, top) {
      drawLine(page, bold, 10, dark, clean(bold, label), x, top, 14.5);
      lines.forEach((text, i) => drawLine(page, reg, 10, dark, text, x + labelW, top + i * 14.5, 14.5));
    } };
  };
  const titleDateRow = (title, date, w, titleFont, titleSize, titleColor) => {
    const dateText = resolve(date || ""), dateW = dateText ? Math.min(measure(reg, 9, clean(reg, dateText)), w * 0.4) : 0;
    const titleLines = textLines(titleFont, titleSize, titleColor, title, w - (dateW ? dateW + 10 : 0), { lineH: titleSize * 1.45 });
    const dateLines = dateW ? textLines(reg, 9, muted, dateText, w * 0.4, { lineH: 13, align: "right" }) : [];
    const titleBlock = titleLines.length ? stack(titleLines) : null, dateBlock = dateLines.length ? stack(dateLines) : null;
    const h = Math.max(titleBlock ? titleBlock.h : 0, dateBlock ? dateBlock.h : 0);
    if (!h) return null;
    return { h, draw(page, x, top) { if (titleBlock) titleBlock.draw(page, x, top); if (dateBlock) dateBlock.draw(page, x + w * 0.6, top); } };
  };
  const ratingBlock = (rating, w) => rating ? { h: 15, draw(page, x, top) {
    for (let i = 0; i < rating.max; i++) {
      const cx = x + 4 + i * 9.5, cy = PAGE_H - top - 7.5;
      page.drawCircle({ x: cx, y: cy, size: 3.1, borderColor: accent, borderWidth: 0.8, color: i < rating.value ? accent : PDFLib.rgb(1, 1, 1) });
    }
    drawLine(page, reg, 9, muted, `${rating.value}/${rating.max}`, x + 4 + rating.max * 9.5 + 4, top, 15);
  } } : null;
  const resumeEntry = (entry, w) => stack([
    titleDateRow(entry.title, entry.date, w, bold, 10, dark),
    textBlock(reg, 10, subtle, entry.subtitle, w),
    entry.description && entry.description.trim() ? [gap(3), textBlock(reg, 10, dark, entry.description, w)] : null,
    (entry.fields || []).map(field => customField(field, w)),
    ratingBlock(entry.rating, w),
    gap(8)
  ]);
  const sectionBlocks = (section, w) => {
    const entries = section.entries.filter(entryHasContent).map(entry => resumeEntry(entry, w));
    const size = d.template === "classic" ? 13 : 11, title = d.template === "modern" ? resolve(section.title).toUpperCase() : resolve(section.title);
    const heading = stack([
      textBlock(bold, size, accent, title, w, { lineH: size * 1.45 }), gap(5),
      d.template === "minimal" ? null : rule(w, 0.75, line), gap(d.template === "minimal" ? 5 : 7.5)
    ]);
    return entries.length ? [stack([heading, entries[0]]), ...entries.slice(1), gap(14)] : [];
  };
  let page = null, top = 0, startTop = 0;
  const newPage = (first) => { page = pdf.addPage([PAGE_W, PAGE_H]); top = first ?? MARGIN_TOP; startTop = top; };
  const place = columns => {
    const queues = columns.map(column => [...column.blocks]);
    let ys = columns.map(() => top);
    for (;;) {
      columns.forEach((column, i) => {
        while (queues[i].length) {
          const block = queues[i][0];
          if (ys[i] + block.h > PAGE_H - MARGIN_BOTTOM && ys[i] > startTop) break;
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
    const contact = inline([p.street, p.city, p.email, p.phone, p.website].map(resolve).filter(value => value.trim()).map(text => ({ text }))
      .concat(state.extras.filter(fieldHasContent).map(field => ({ label: field.label.trim() ? `${resolve(field.label)}: ` : "", text: resolve(field.value) }))), leftW, 9, muted, 10.5, 13);
    const left = stack([
      textBlock(bold, 26, rgbHex("#252633"), name, leftW, { lineH: 29 }), gap(4),
      textBlock(bold, 12, accent, p.headline, leftW, { lineH: 17 }),
      contact.length ? [gap(9), contact] : null
    ]);
    const headH = Math.max(left.h, photoH), hasRule = d.template !== "minimal", thick = d.template === "classic" ? 0.75 : 1.5;
    full([{ h: headH + 13.5 + (hasRule ? thick : 0) + 15, draw(pg, x, t) {
      left.draw(pg, x, t);
      if (photoImageRef) pg.drawImage(photoImageRef, { x: x + CONTENT_W - photoW, y: PAGE_H - t - photoH, width: photoW, height: photoH });
      if (hasRule) pg.drawRectangle({ x, y: PAGE_H - t - headH - 13.5 - thick, width: CONTENT_W, height: thick, color: accent });
    } }]);
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
    textLines(reg, 7, dark, sender, 85 * MM, { lineH: 8.4 }).slice(0, 1).forEach(item => item.draw(page, MARGIN_X, 46 * MM));
    recipient.slice(0, 9).forEach((item, i) => item.draw(page, MARGIN_X, 54 * MM + i * 13));
    info.forEach((item, i) => item.draw(page, PAGE_W - MARGIN_X - 65 * MM, 45 * MM + i * 13.5));
    const dateLine = [resolve(l.place), formattedDate(l.date)].filter(Boolean).join(", ");
    full([
      textBlock(reg, 10, dark, dateLine, CONTENT_W, { align: "right" }), gap(10 * MM),
      textBlock(bold, 10, dark, l.subject, CONTENT_W), gap(8 * MM),
      textBlock(reg, 10, dark, l.salutation, CONTENT_W), gap(5 * MM),
      textLines(reg, 10, dark, l.body, CONTENT_W, { lineH: 16 }), gap(8 * MM),
      textBlock(reg, 10, dark, l.closing, CONTENT_W), gap(12 * MM),
      textBlock(reg, 10, dark, name, CONTENT_W)
    ]);
  } else {
    const header = stack([textBlock(bold, 22, accent, state.portfolio.title, CONTENT_W, { lineH: 30 }), textBlock(reg, 10, muted, name, CONTENT_W), gap(10.5), rule(CONTENT_W, 1.5, accent), gap(15)]);
    full([header]);
    for (const entry of state.portfolio.entries.filter(item => [item.title, item.date, item.description, item.link].some(value => value.trim()))) {
      full([stack([
        titleDateRow(entry.title, entry.date, CONTENT_W, bold, 10, dark),
        entry.description.trim() ? [gap(3), textBlock(reg, 10, dark, entry.description, CONTENT_W)] : null,
        textBlock(reg, 9, accent, entry.link, CONTENT_W),
        gap(15)
      ])]);
    }
  }
  return pdf.save();
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
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
    if (form.elements.mode.value === "combined") {
      const combined = await PDFLib.PDFDocument.create();
      for (const file of files) {
        const source = await PDFLib.PDFDocument.load(file.bytes);
        const pages = await combined.copyPages(source, source.getPageIndices());
        pages.forEach(page => combined.addPage(page));
      }
      downloadBlob(new Blob([await combined.save()], { type: "application/pdf" }), `bewerbung_${name}.pdf`);
    } else {
      const zip = new JSZip();
      for (const file of files) {
        const label = { letter: "Anschreiben", resume: "Lebenslauf", portfolio: "Arbeitsproben" }[file.type];
        zip.file(`${label}_${name}.pdf`, file.bytes);
      }
      downloadBlob(await zip.generateAsync({ type: "blob" }), `bewerbung_${name}.zip`);
    }
    $("#download-dialog").close();
  } catch (error) {
    console.error(error);
    $("#download-status").textContent = `PDF-Erstellung fehlgeschlagen: ${error.message}`;
  } finally { exportInProgress = false; buttons.forEach(button => { button.disabled = false; }); }
});
window.addEventListener("resize", updateAddressWarning);
render(); updateStorageIndicator(); showStatus(); takeSnapshot("Startstand");
if (!hasStarted) $("#welcome-dialog").showModal();
