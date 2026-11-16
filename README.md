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

## Kollegiums-Abstimmung auf Cloudflare (Pages + D1)

Mit der Abstimmungs-Funktion können Kollegen den Plan per geschütztem Link + Zugangscode prüfen, Klausuren einfach mit **„Passt / Passt nicht (früher/später)“** bewerten und **No-Go-/Wunschtermine** im Kalender markieren. Das EduPage-Backend bleibt dabei sicher lokal auf deinem Rechner.

### Einmalige Einrichtung in Cloudflare
1. **D1-Datenbank anlegen & Schema einspielen:**
   ```bash
   npx wrangler d1 create klausurplaner-review
   # Die ausgegebene database_id in wrangler.toml eintragen
   npx wrangler d1 execute klausurplaner-review --remote --file=cloudflare/schema.sql
   ```
2. **Auf Cloudflare Pages deployen** (entweder per Git-Integration mit Build-Command `npm run build` und Output-Ordner `dist`, oder manuell):
   ```bash
   npm run build
   npx wrangler pages deploy dist
   ```
3. **D1-Binding verknüpfen:** Im Cloudflare Dashboard unter **Pages → Settings → Bindings** (oder über `wrangler.toml`) die D1-Datenbank `klausurplaner-review` als Variable **`DB`** für Production und Preview verknüpfen.
4. *(Optional empfohlen)* Ein Session-Signatur-Secret setzen:
   ```bash
   npx wrangler pages secret put SESSION_SECRET
   ```

### Ablauf im Alltag
1. Lokal mit `npm run dev:local` über EduPage importieren und den Entwurf generieren.
2. Oben auf **„Abstimmung“** klicken, dort deine Cloudflare-Pages-URL (z. B. `https://klausurplaner.pages.dev`) sowie ein Kollegiums-Passwort angeben und den Link + die fertige Mail-Vorlage kopieren.
3. Rückmeldungen erscheinen in der **„Kollegen-Rückmeldungen“**-Inbox direkt über dem Kalender (inkl. 1-Klick-Übernahme von Sperrtagen).

## Build & Lint
```bash
npm run build
npm run lint
```

