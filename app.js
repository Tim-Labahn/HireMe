"use strict";

const STORAGE_KEY = "bewerbungsatelier-v1";
const STORAGE_CHOICE_KEY = "hireme-storage-choice-v1";
const defaultState = () => ({
  profile: { firstName: "", lastName: "", headline: "", email: "", phone: "", street: "", city: "", website: "", photo: "" },
  letter: { recipient: "", place: "", date: "", subject: "", salutation: "Sehr geehrte Damen und Herren,", body: "", closing: "Mit freundlichen Grüßen" },
  recipientDetails: null,
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

function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
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
  return { profile, letter, design, sections, portfolio, recipientDetails };
}
function showStatus() { $("#status").textContent = [saveError, message].filter(Boolean).join(" "); }
function updateStorageIndicator() {
  $("#storage-indicator").textContent = storageMode === "local"
    ? "Speicherung: lokal in diesem Browser. Erstelle regelmäßig eine Sicherung."
    : "Speicherung: nur in diesem Tab. Beim Neuladen oder Schließen gehen Änderungen verloren.";
}
function save() {
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

function editable(group, key, placeholder, options = {}) {
  const value = options.value === undefined ? state[group][key] : options.value;
  const tag = options.tag || "span", classes = options.className || "";
  const section = options.section === undefined ? "" : ` data-section="${options.section}"`;
  const entry = options.entry === undefined ? "" : ` data-entry="${options.entry}"`;
  return `<${tag} class="${classes}" contenteditable="true" role="textbox" aria-label="${escapeHtml(placeholder)}" aria-multiline="${Boolean(options.multiline)}" data-group="${group}" data-key="${key}"${section}${entry} data-placeholder="${escapeHtml(placeholder)}"${options.optional && !value ? " hidden" : ""}>${escapeHtml(value)}</${tag}>`;
}
function person(key, placeholder, options) { return editable("profile", key, placeholder, options); }
function letterField(key, placeholder, options) { return editable("letter", key, placeholder, options); }
function entryHasContent(entry) { return [entry.title, entry.subtitle, entry.date, entry.description].some(value => value.trim()); }
function fieldMenu(index, entryIndex, group) {
  const work = group === "work";
  return `<details class="field-menu"><summary class="icon-button" aria-label="Felder hinzufügen" title="Felder hinzufügen">+</summary><div class="field-options">
    ${work ? "" : `<button type="button" data-action="show-field" data-field="subtitle" data-group="${group}" data-index="${index}" data-entry="${entryIndex}">Untertitel</button>`}
    <button type="button" data-action="show-field" data-field="date" data-group="${group}" data-index="${index}" data-entry="${entryIndex}">Zeitraum</button>
    <button type="button" data-action="show-field" data-field="description" data-group="${group}" data-index="${index}" data-entry="${entryIndex}">Beschreibung</button>
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
  const { group, key, section, entry } = element.dataset;
  const value = element.innerText.replace(/\r/g, "").replace(/\n+$/, "");
  if (!value) element.textContent = "";
  if (group === "profile") {
    state.profile[key] = value;
    document.querySelectorAll(`[data-group="profile"][data-key="${key}"]`).forEach(other => { if (other !== element) other.textContent = value; });
  } else if (group === "letter") {
    if (key === "date") {
      state.letter.date = parseEditedDate(value) || value;
    } else state.letter[key] = value;
  } else if (group === "section") state.sections[Number(section)][key] = value;
  else if (group === "entry") { state.sections[Number(section)].entries[Number(entry)][key] = value; updateEmptySection(Number(section)); }
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
$("#paper").addEventListener("focusout", event => {
  const element = event.target;
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
  if (action === "remove-section") {
    if (!confirm("Diesen Abschnitt und alle seine Einträge löschen?")) return;
    state.sections.splice(index, 1);
  } else if (action === "remove-entry") state.sections[index].entries.splice(Number(button.dataset.entry), 1);
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
    state = defaultState(); storageMode = "temporary"; loadBlocked = false; saveError = ""; message = "";
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
    state = imported; loadBlocked = false; message = ""; save(); render();
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
      await loadClassicScript("vendor/export/html2pdf.bundle.min.js");
      await loadClassicScript("vendor/export/pdf-lib.min.js");
      await loadClassicScript("vendor/export/jszip.min.js");
      if (!globalThis.html2pdf || !globalThis.PDFLib || !globalThis.JSZip) throw new Error("Exportbibliotheken sind nicht verfügbar.");
    })().catch(error => { exportLibrary = null; throw error; });
  }
  return exportLibrary;
}
function safeFilename(value) {
  const cleaned = value.normalize("NFC").trim().replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").replace(/\s+/g, "_").replace(/[. ]+$/g, "").slice(0, 100);
  return cleaned && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned) ? cleaned : "Name";
}
function makeExportPaper(type) {
  const paper = document.createElement("article");
  paper.className = `paper export-paper template-${state.design.template}${type === "letter" ? " letter-paper" : ""}`;
  paper.style.setProperty("--accent", state.design.color);
  paper.style.setProperty("--doc-font", `"${state.design.font}", ${state.design.font === "Georgia" ? "serif" : "sans-serif"}`);
  paper.innerHTML = type === "resume" ? renderResume() : type === "letter" ? renderLetter() : renderPortfolio();
  paper.querySelectorAll("[contenteditable]").forEach(element => element.setAttribute("contenteditable", "false"));
  paper.querySelectorAll(".section-actions, .entry-actions, .add-entry, .rating-controls, .empty-section, [hidden]").forEach(element => element.remove());
  paper.querySelectorAll(".block").forEach(element => { if (!element.textContent.trim()) element.remove(); });
  return paper;
}
async function renderPdf(type) {
  const paper = makeExportPaper(type);
  const worker = globalThis.html2pdf().set({
    margin: 0,
    image: { type: "jpeg", quality: 0.96 },
    html2canvas: { scale: 2, backgroundColor: "#ffffff", useCORS: false },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    pagebreak: { mode: ["css", "legacy"], avoid: [".resume-entry", ".work-entry"] }
  }).from(paper).toPdf();
  return worker.outputPdf("arraybuffer");
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function exportAddressOverflows() {
  const paper = makeExportPaper("letter");
  paper.style.position = "fixed"; paper.style.left = "-10000px"; paper.style.top = "0";
  document.body.appendChild(paper);
  try {
    const address = paper.querySelector(".address-window"), recipient = paper.querySelector(".recipient"), sender = paper.querySelector(".return-address");
    return (recipient && recipient.scrollHeight > address.clientHeight - sender.clientHeight + 1) || sender.scrollHeight > sender.clientHeight + 1;
  } finally { paper.remove(); }
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
    if (exportAddressOverflows() && !confirm("Die Adresse passt möglicherweise nicht ins Fenster. Trotzdem exportieren?")) return;
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
render(); updateStorageIndicator(); showStatus();
if (!hasStarted) $("#welcome-dialog").showModal();
