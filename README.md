# HireMe

Eine statische, deutschsprachige Anwendung zum Erstellen und Gestalten von Lebenslauf, Anschreiben und optionalen Arbeitsproben. Alle Daten und PDF-Dateien werden ausschließlich lokal im Browser verarbeitet. Ein Konto oder Backend ist nicht nötig.

## Lokal starten

Mit installiertem Node.js im Projektordner `npm start` ausführen und **http://127.0.0.1:4173** im Browser öffnen. Zum Beenden im Terminal `Strg+C` drücken. Die benötigten PDF.js-Dateien liegen bereits im Ordner `vendor`; zum Starten ist keine Installation notwendig.

Die `index.html` lässt sich auch direkt öffnen. Der PDF-Import nutzt dabei eine lokal mitgelieferte Variante von PDF.js; manche Browser oder PDF-Schriften können bei `file:` trotzdem Einschränkungen haben. In diesem Fall den lokalen Server oder GitHub Pages verwenden. Browserdaten sind je nach Adresse getrennt: Unter `file:`, `127.0.0.1` und GitHub Pages werden jeweils eigene Daten gespeichert. Über gespeicherte Vorlagen lassen sie sich übertragen.

## Online Nutzen

Das project ist Via Github Pages erreichbar unter **http://HireMe.timlabahn.de**


## Bearbeiten und drucken

- Das gewünschte Dokument oben auswählen. Texte direkt auf dem Blatt anklicken und bearbeiten. Name und gemeinsame Kontaktdaten werden zentral über **Persönliche Angaben** bearbeitet und in allen Dokumenten verwendet.
- Text im Dokument markieren und über die Leiste links oder am Dokument Schriftgröße, Fett, Kursiv, Unterstreichung oder Textfarbe einstellen. Die Formatierung gilt für die Auswahl und wird in Vorlagen und PDF übernommen; mit dem Zurücksetzen-Knopf wird sie entfernt. Das Datumsfeld im Anschreiben und die zentralen Profil- und Empfängerangaben werden nicht einzeln formatiert.
- Im Lebenslauf mit **+ Abschnitt** und **+ Eintrag** Inhalte ergänzen. Abschnitte lassen sich am Griff ziehen, mit den Pfeilen verschieben oder mit der Breiten-Schaltfläche zwischen 100 % und 50 % umstellen. In den seitlichen Werkzeugen lassen sich Foto, Fotogröße, Design, Schrift und Farbe einstellen.
- Leere optionale Eintragsfelder werden ausgeblendet. Im Titel eines Eintrags mit **Umschalt + Enter** den Untertitel öffnen; alternativ über **+** am Eintrag Untertitel, Zeitraum oder Beschreibung hinzufügen. Ein leeres Feld verschwindet wieder, sobald es verlassen wird.
- Über **+ → Bewertung ein- / ausblenden** einem Eintrag optional eine Selbsteinschätzung hinzufügen. Skala (1–5 oder 1–10) und Wert sind je Eintrag wählbar. Im Druck erscheinen die Punkte und der Zahlenwert, nicht die Auswahlfelder. Beim Wechsel auf 1–5 wird ein höherer Wert auf 5 begrenzt.
- Unter **Arbeitsproben** bei Bedarf eine separate Seite mit Beispielen anlegen. Über **+ Arbeitsprobe** einen Eintrag erstellen; über dessen **+** lassen sich Zeitraum, Beschreibung und Link hinzufügen. Die Seite wird nur gedruckt, wenn sie ausgewählt ist.
- Das Anschreiben hat ein Adressfeld für DIN 5008 Form B: Das 85 × 45 mm große Feld beginnt 20 mm vom linken und 45 mm vom oberen Blattrand. Bei zu langer Adresse wird gewarnt.
- Ein Klick auf die Empfängeradresse oder Anrede sowie **Empfängeradresse ausfüllen** öffnet das Formular. Die Adresse kann dort frei bearbeitet oder aus Einzelfeldern zusammengestellt werden. Auch eine eigene Anrede ist möglich; Änderungen werden erst beim Übernehmen gespeichert.
- Mit **Betreffvorlage** lässt sich ein Betreff für Ausbildung, Stelle oder Praktikum mit Beruf und optionalem Beginn erzeugen. Der Betreff bleibt anschließend frei bearbeitbar.
- Die Bearbeitungsansicht zeigt A4-Seiten untereinander und um 15 % vergrößert. Bei mehreren Seiten zeigt sie orientierende Seitenzahlen. Der Text fließt im Editor durchgehend; die Seitenlinien dienen zur Orientierung und erzwingen keinen Umbruch. Der Lebenslaufkopf wird deshalb im Editor nicht auf Folgeseiten wiederholt. Die **Seitenvorschau** zeigt die tatsächlichen PDF-Seiten und Umbrüche. Lange Einträge werden im PDF auf Folgeseiten verteilt, der Lebenslaufkopf wird dort wiederholt. Dokumente mit mehreren Seiten erhalten Seitenzahlen pro Dokument. Die Vergrößerung wirkt sich nicht auf PDF und Druck aus.
- Für PDF und Seitenvorschau wird die Schrift bei knappem Überlauf um bis zu 5 % verkleinert, wenn dadurch eine Seite eingespart wird. Bei 85–95 % Auslastung der letzten Seite wird sie um 5 % vergrößert, sofern keine zusätzliche Seite entsteht. Die Schriftgröße im Editor bleibt unverändert. Im Anschreiben verwenden die Vorlagen Modern und Klassisch die Akzentfarbe für den Betreff, Modern ergänzt eine Linie; Minimal bleibt schlicht.
- Über **PDF herunterladen** Dokumente auswählen und als `bewerbung_Name.zip` mit einzelnen Dateien `Anschreiben_Name.pdf`, `Lebenslauf_Name.pdf` und optional `Arbeitsproben_Name.pdf` herunterladen. Der Name lässt sich im Dialog ändern. Die lokal erzeugten PDFs sind Vektor-PDFs mit echtem, auswählbarem Text und übernehmen Farben, Trennlinien, Foto und Bewertungspunkte; verwendet werden Standardschriften (Helvetica bzw. Times für Georgia). Platzhalter werden ersetzt.
- Alternativ das gewünschte Dokument über **Drucken** im Browser drucken oder als PDF speichern. Im Druckdialog A4, 100 % bzw. tatsächliche Größe und keine zusätzlichen Ränder wählen; Kopf- und Fußzeilen ausschalten. Brief und Fensterposition zunächst mit einem Probedruck und dem verwendeten Umschlag überprüfen. Bei längeren Dokumenten Seitenumbrüche in der Druckvorschau kontrollieren.

## Bestehende PDF importieren

Über **PDF importieren** eine oder mehrere textbasierte PDFs auswählen. Die Dateien werden nacheinander mit PDF.js lokal ausgelesen; eine Netzwerkübertragung an einen KI-Dienst findet nicht statt. Jede Datei wird einzeln zur Kontrolle vorgelegt und kann übernommen, übersprungen oder zusammen mit den verbleibenden Dateien abgebrochen werden. Ein Fehler bei einer Datei wird angezeigt und verhindert nicht das Überspringen zur nächsten. Der Dokumenttyp wird nach Möglichkeit automatisch erkannt und kann in der Vorschau geändert werden. Sowohl die erkannten Angaben als auch den gesamten extrahierten Text mit dem Original vergleichen. Die automatische, regelbasierte Erkennung ist nicht für jedes Layout geeignet und kann Inhalte falsch oder gar nicht zuordnen. Mehrspaltige PDFs, Grafiken und komplexe Formatierungen sind besonders fehleranfällig. PDFs, die nur aus Bildern bestehen, werden nicht per OCR erkannt. Fotos und das ursprüngliche Layout werden nicht übernommen.

Erst nach Bestätigung werden erkannte Felder übernommen. Bei Lebensläufen ersetzen erkannte Abschnitte die bisherigen Abschnitte vollständig; bei Anschreiben ersetzen erkannte Felder die jeweiligen Werte. Nicht erkannte Felder bleiben erhalten. Bei mehreren Dateien desselben Typs können später übernommene Angaben frühere ersetzen. Vorher eine Vorlage speichern. Anschließend alle Inhalte und die Reihenfolge direkt auf dem Dokument kontrollieren und fehlende Angaben ergänzen.

## Datenschutz und Vorlagen

Beim ersten Besuch zwischen dauerhafter Speicherung in diesem Browser und einer flüchtigen Sitzung wählen. Im flüchtigen Modus bleiben neue Daten nur im Arbeitsspeicher des Tabs und gehen beim Neuladen oder Schließen verloren; vorhandene lokale Daten werden dabei nicht automatisch gelöscht. Im dauerhaften Modus werden Daten einschließlich Foto im `localStorage` gespeichert und nicht automatisch synchronisiert. Unter **Datenschutz & Hilfe** lässt sich die Auswahl ändern und lassen sich die lokal gespeicherten HireMe-Daten löschen. Bereits exportierte Dateien bleiben davon unberührt.

HireMe sendet eingegebene Daten und importierte PDFs nicht selbst an einen Server oder KI-Dienst. Beim Laden der Website und ihrer Dateien erhält der Hosting-Anbieter dennoch technische Verbindungsdaten wie die IP-Adresse. Browsererweiterungen, Schadsoftware, andere Personen mit Zugriff auf das Gerät oder andere Anwendungen derselben Web-Origin können unter Umständen auf Daten zugreifen. Nutze auf gemeinsam verwendeten Geräten vorzugsweise den flüchtigen Modus. Die Anwendung setzt keine Cookies; im dauerhaften Modus wird die Speicherauswahl ebenfalls im `localStorage` abgelegt.

Browserdaten können durch das Löschen von Website-Daten, private Browsersitzungen oder Gerätewechsel verloren gehen. Mit **Vorlage speichern** eine JSON-Datei erstellen und sicher aufbewahren; sie enthält alle persönlichen Daten, Platzhalter unverändert und gegebenenfalls das Foto. **Vorlage laden** stellt sie nach Bestätigung wieder her und ersetzt die aktuellen Daten. Auch ältere JSON-Sicherungen können geladen werden. Browser begrenzen den verfügbaren Speicherplatz; insbesondere große Fotos können das Speichern verhindern. In diesem Fall erscheint eine Fehlermeldung. Speichere eine Vorlage und verwende gegebenenfalls ein kleineres Foto.

Der PDF-Import verwendet [PDF.js](https://mozilla.github.io/pdf.js/) unter der Apache-Lizenz 2.0; die Lizenz liegt unter `vendor/pdfjs/LICENSE`. Der Export verwendet pdf-lib und JSZip; die jeweiligen Lizenzen liegen in `vendor/export`. Zum erneuten Erzeugen der PDF.js-Browser-Bundles nach einer Änderung der Abhängigkeiten `npm install` und `npm run build:pdf` ausführen.

## Platzhalter, Versionen und eigene Felder

- **Platzhalter:** In Textfeldern z. B. {company}, {job_name}, {name}, {first_name}, {last_name}, {email}, {phone}, {city}, {street}, {contact} und {date} verwenden (auch deutsch, z. B. {firma}, {beruf}). Firma und Beruf stehen unter **Platzhalter**. Beim Bearbeiten ist der Platzhalter sichtbar, sonst der ersetzte Text.
- **Autokorrektur:** Rechtschreibprüfung des Browsers plus einfache Korrekturen beim Tippen (doppelte Leerzeichen, häufige Tippfehler, Satzanfang in mehrzeiligen Feldern).
- **Versionen:** Zwischenstände (max. 40) liegen nur im Arbeitsspeicher und verschwinden mit F5 oder beim Schließen des Tabs.
- **Eigene Felder:** Im Lebenslauf-Kopf über **+ Feld** und in Einträgen über das Plus-Menü **Eigenes Feld** frei hinzufügen; Löschen von Feldern mit Inhalt fragt nach.
