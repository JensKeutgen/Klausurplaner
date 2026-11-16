# Klausurplaner

Web-App zur Planung von Klausuren für Bildungsgänge und Klassen – mit direkter EduPage-Anbindung im lokalen Modus, automatischer Speicherung, Wochen-IDs & echten Kalendertagen sowie einem Smart-Solver.

## Lokale Nutzung mit EduPage-Anbindung & automatischer Dateispeicherung

### Voraussetzungen
- Node.js (v20+)
- Python 3.9+

### 1. Einmalige Einrichtung
```bash
npm install
npm run setup:edupage
```
`npm run setup:edupage` legt eine lokale `.venv`-Umgebung an und installiert `edupage-api`.

### 2. App lokal starten
```bash
npm run dev:local
```
Dadurch starten sowohl die lokale Python-Bridge (`server/edupage_bridge.py` auf `127.0.0.1:8787`) als auch das Vite-Frontend.

- **EduPage Direktimport:** In „Stundenpläne importieren“ Subdomain, Benutzername und Passwort eingeben (optional lokal speichern), Klassen nach Stufe/Name filtern und Wochenpläne direkt abrufen.
- **Auto-Save:** Alle Änderungen werden automatisch im Browser (`localStorage`) **und** in `server/data/klausurplan.json` auf deiner Festplatte gespeichert (lokale Daten & Zugangsdaten stehen in `.gitignore`).
- **Smart-Solver:** Platziert Klausuren mittels MRV + lokaler Suche, vermeidet aufeinanderfolgende Klausurtage und Lehrkraft-Überschneidungen, schützt gepinnte Klausuren und versucht Klausuren desselben Faches und derselben Stufe in dieselbe Woche zu legen (ohne sie auf denselben Tag zu koppeln).

## Build & Lint
```bash
npm run build
npm run lint
```
