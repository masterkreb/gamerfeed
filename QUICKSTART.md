# ⚡ Schnellstart: GamerFeed

Diese Anleitung beschreibt die aktuell implementierte Konfiguration. Das Kontaktformular verwendet Google reCAPTCHA v3 und Gmail SMTP über Nodemailer.

## 1. Abhängigkeiten installieren

```bash
npm install
```

## 2. Lokale Umgebungsvariablen

Lege im Projektverzeichnis eine `.env` an. Die vollständige Liste steht in der [README](README.md); für das Kontaktformular werden diese Werte benötigt:

```env
RECAPTCHA_SECRET_KEY="dein_recaptcha_secret_key"
GMAIL_USER="deine-adresse@gmail.com"
GMAIL_APP_PASSWORD="dein_google_app_passwort"

# Optional; lokal inklusive localhost, mehrere Domains mit Komma trennen
RECAPTCHA_ALLOWED_HOSTNAMES="localhost,gamerfeed.vercel.app"
```

Das Google-App-Passwort wird ohne Leerzeichen eingetragen. Secrets gehören ausschließlich in die lokale `.env` beziehungsweise in Vercel und niemals in den Frontend-Code oder ins Git-Repository.

## 3. reCAPTCHA v3 konfigurieren

1. Öffne die [reCAPTCHA-Administration](https://www.google.com/recaptcha/admin).
2. Registriere die produktive Domain und für lokale Tests bei Bedarf `localhost`.
3. Hinterlege den Secret Key als `RECAPTCHA_SECRET_KEY`.
4. Prüfe, ob der öffentliche Site Key in `components/SettingsModal.tsx` zur registrierten reCAPTCHA-Site gehört. Er wird dort einmal als `RECAPTCHA_SITE_KEY` definiert.
5. Setze in Vercel Production `RECAPTCHA_ALLOWED_HOSTNAMES` nur auf die produktiven Hostnamen, beispielsweise `gamerfeed.vercel.app,www.example.com`. Für lokale Tests muss zusätzlich `localhost` erlaubt sein.

Die Serverfunktion akzeptiert nur erfolgreiche Prüfungen mit der Action `contact_form` und einem Score von mindestens `0.5`.

## 4. Gmail SMTP konfigurieren

1. Aktiviere für das Google-Konto die Zwei-Faktor-Authentifizierung.
2. Erstelle unter [Google App-Passwörter](https://myaccount.google.com/apppasswords) ein eigenes App-Passwort für GamerFeed.
3. Hinterlege die Gmail-Adresse als `GMAIL_USER` und das App-Passwort als `GMAIL_APP_PASSWORD`.

Nodemailer ist bereits als Projektabhängigkeit installiert. Formspree, Resend und Cloudflare Turnstile sind nicht Teil des aktuellen Kontaktflusses.

## 5. Lokal prüfen

```bash
npm test
npm run typecheck
npm run build
vercel dev
```

`npm run dev` startet nur Vite. Um das Kontaktformular inklusive `/api/contact` lokal zu testen, ist `vercel dev` nötig.

Öffne danach den Kontakt-Tab, sende eine Testnachricht und prüfe:

- Die Anfrage zeigt im Browser eine Erfolgsmeldung.
- Die Nachricht kommt beim konfigurierten Gmail-Konto an.
- Die Vercel-Ausgabe enthält `contact.delivered`, aber keine Formulardaten oder E-Mail-Adressen.

Bei einem Fehler zuerst die Serverausgabe von `/api/contact` und anschließend die vier Kontaktvariablen prüfen.

## 6. Vercel

Die gleichen Variablen müssen unter **Project Settings → Environment Variables** für die gewünschten Umgebungen gesetzt werden. Danach ist ein neues Deployment erforderlich.

GitHub Actions benötigt die Kontaktvariablen nicht: Das Formular läuft als Vercel Serverless Function. Die Secrets für den Feed-Workflow sind separat in der [README](README.md#4-github-actions-einrichten) beschrieben.
