# 🔧 Setup-Anleitung: Cookie-Consent, Analytics & Kontaktformular

Nach der Implementierung musst du noch diese Schritte durchführen, damit alles funktioniert:

---

## 1. ✅ Persönliche Daten eintragen

✅ **Erledigt!** Name "Imad Chatila" ist bereits eingetragen.

**Für Schweiz (Hobby-Projekt):** Keine Adresse nötig! Name + Kontaktformular reicht.

---

## 2. 🔒 Google reCAPTCHA v3 einrichten

### Schritt 1: reCAPTCHA Site erstellen (oder bestehende nutzen)

**Option A: Bestehende Keys nutzen**
1. Gehe zu: https://www.google.com/recaptcha/admin
2. Öffne deine bestehende Site
3. Füge Domain hinzu: `gamerfeed.vercel.app`
4. Keys sind bereits vorhanden ✅

**Option B: Neue Site erstellen** (falls gewünscht)
1. Gehe zu: https://www.google.com/recaptcha/admin
2. Klicke **"+ Neue Website hinzufügen"**
3. Label: "GamerFeed"
4. reCAPTCHA-Typ: **reCAPTCHA v3**
5. Domains: `gamerfeed.vercel.app`, `localhost`
6. Du erhältst:
   - **Site Key** (öffentlich, im Frontend)
   - **Secret Key** (geheim, im Backend)

### Schritt 2: Site Key eintragen
Öffne `components/SettingsModal.tsx` und ersetze **2x** `YOUR_RECAPTCHA_SITE_KEY`:

**Zeile ~50** (Script-Laden):
```typescript
script.src = 'https://www.google.com/recaptcha/api.js?render=YOUR_RECAPTCHA_SITE_KEY';
```

**Zeile ~70** (Token-Generierung):
```typescript
const token = await grecaptcha.execute('YOUR_RECAPTCHA_SITE_KEY', { action: 'contact_form' });
```

**Hinweis:** Das Kontaktformular ist jetzt im **"Kontakt"-Tab** im Settings-Modal integriert.

### Schritt 3: Secret Key in Vercel Secrets
```bash
vercel env add RECAPTCHA_SECRET_KEY
# Dann: Füge deinen Secret Key ein
```

Oder über Vercel Dashboard:
- Project → Settings → Environment Variables
- Name: `RECAPTCHA_SECRET_KEY`
- Value: `6Le...` (dein Secret Key)
- Environments: Production, Preview, Development

---

## 3. 📧 E-Mail-Service einrichten (3 Optionen)

**Vercel hat KEINEN eigenen E-Mail-Service!** Wähle eine Option:

---

### **Option A: Formspree** ⭐ (EMPFOHLEN - 0 Min Setup)

**Vorteile:** Kostenlos, kein Code ändern, sofort einsatzbereit

1. Gehe zu: https://formspree.io/
2. Erstelle Account (kostenlos: 50 Submissions/Monat)
3. Erstelle neues Formular → Notiere die **Form ID** (z.B. `mwpeabc`)
4. In Vercel Secrets eintragen:
```bash
vercel env add FORMSPREE_FORM_ID
# Wert: mwpeabc (deine Form ID)
```

**Fertig!** E-Mails werden an deine Account-E-Mail weitergeleitet.

---

### **Option B: Gmail SMTP** (kostenlos, 5 Min Setup)

**Vorteile:** Nutzt deine eigene Gmail, keine externe Platform

1. Gmail-Konto öffnen → **App-Passwort** erstellen:
   - https://myaccount.google.com/apppasswords
   - App auswählen: "Mail"
   - Gerät: "GamerFeed"
   - Notiere das 16-stellige Passwort
   
2. Vercel Secrets:
```bash
vercel env add GMAIL_USER
# Wert: deine@gmail.com

vercel env add GMAIL_APP_PASSWORD
# Wert: abcd efgh ijkl mnop (App-Passwort)
```

3. Installiere Nodemailer:
```bash
npm install nodemailer
```

4. Aktiviere den Gmail-Code in `api/contact.ts` (ist bereits vorbereitet)

---

### **Option C: Resend** (professionell, später)

Falls du später eine eigene Domain nutzen willst:

1. https://resend.com/ → Account erstellen
2. API Key erstellen
3. Vercel Secrets:
```bash
vercel env add RESEND_API_KEY
vercel env add CONTACT_EMAIL
```

4. Domain verifizieren für `noreply@gamerfeed.com` Absender

---

**Meine Empfehlung:** Start mit **Option A (Formspree)** → Später auf **Option B (Gmail)** wechseln wenn mehr Traffic kommt.

---

## 4. 📊 Google Analytics einrichten

### Schritt 1: GA4 Property erstellen
1. Gehe zu: https://analytics.google.com/
2. Admin → Create Property
3. Property Name: "GamerFeed"
4. Wähle deine Zeitzone (Europa/Zürich)
5. Erstelle einen **Web-Datenstream**:
   - Website URL: `https://gamerfeed.vercel.app`
   - Notiere die **Measurement ID** (Format: `G-XXXXXXXXXX`)

### Schritt 2: Measurement ID eintragen
Öffne `App.tsx` und ersetze:

```typescript
function initGoogleAnalytics() {
    const GA_MEASUREMENT_ID = 'G-XXXXXXXXXX'; // ← Hier deine Measurement ID
    // ...
}
```

### Schritt 3: IP-Anonymisierung & Consent prüfen
- ✅ Bereits implementiert: `'anonymize_ip': true`
- ✅ Analytics lädt nur, wenn User im Cookie-Banner zustimmt

### Schritt 4: AV-Vertrag mit Google (Pflicht!)
- Gehe zu: GA4 → Admin → Data Settings → Data Processing Amendment
- Akzeptiere die Bedingungen

---

## 5. 🎨 Cookie-Consent-Banner anpassen (Optional)

Die Library `vanilla-cookieconsent` ist bereits integriert. Wenn du das Design anpassen möchtest:

Öffne `components/CookieConsent.tsx` und bearbeite die `guiOptions`:

```typescript
guiOptions: {
    consentModal: {
        layout: 'box inline', // oder 'bar inline', 'cloud', 'box wide'
        position: 'bottom right', // oder 'bottom center', 'middle center'
    }
}
```

Mehr Optionen: https://cookieconsent.orestbida.com/

---

## 6. 🧪 Testen

### Lokal testen:
```bash
# Starte Dev-Server mit Vercel Functions
vercel dev

# Oder normaler Dev-Server (ohne Serverless Functions)
npm run dev
```

**Wichtig:** Cookie-Banner und Kontaktformular funktionieren nur mit `vercel dev` oder deployed!

### Testen:
1. **Cookie-Banner**: Öffne Seite → Banner sollte erscheinen
2. **Kontaktformular**: Settings → Rechtliches → "Kontaktformular öffnen"
3. **Captcha**: Turnstile sollte erscheinen (grüner Haken)
4. **E-Mail**: Formular absenden → Check deine CONTACT_EMAIL
5. **Analytics**: Im Cookie-Banner "Alle akzeptieren" → Öffne GA4 → Realtime Report

---

## 7. 🚀 Deployen

```bash
# Bauen (testet ob alles kompiliert)
npm run build

# Deployen
vercel --prod
```

Nach dem Deploy:
1. Öffne `https://gamerfeed.vercel.app`
2. Cookie-Banner sollte erscheinen
3. Teste Kontaktformular
4. Prüfe GA4 Realtime-Daten (nach Consent)

---

## 🔐 Sicherheit: Vercel Secrets Übersicht

Diese Secrets musst du in Vercel eintragen:

```bash
TURNSTILE_SECRET_KEY      # Cloudflare Turnstile Secret
RESEND_API_KEY            # Resend E-Mail API Key
CONTACT_EMAIL             # Empfänger-E-Mail für Kontaktanfragen
POSTGRES_URL              # (bereits vorhanden)
KV_REST_API_URL           # (bereits vorhanden)
KV_REST_API_TOKEN         # (bereits vorhanden)
GROQ_API_KEY              # (bereits vorhanden)
```

---

## ❓ Troubleshooting

### Cookie-Banner erscheint nicht
- Prüfe Browser-Konsole auf Fehler
- Lösche localStorage: `localStorage.clear()` in Console
- Hard-Refresh: `Ctrl+Shift+R` (Windows) / `Cmd+Shift+R` (Mac)

### Kontaktformular sendet nicht
- Prüfe: Sind `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, `CONTACT_EMAIL` gesetzt?
- Check API Logs in Vercel: Dashboard → Functions → `/api/contact`

### Analytics trackt nicht
- Cookie-Banner akzeptiert?
- GA4 Measurement ID korrekt?
- Check Browser-Konsole: `window.gtag` sollte existieren

### Captcha funktioniert nicht
- Turnstile Site Key korrekt in `ContactForm.tsx`?
- Domain in Cloudflare Turnstile Dashboard hinzugefügt?

---

## 📝 Checkliste vor Go-Live

- [ ] Persönliche Daten im Impressum eingetragen
- [ ] Turnstile Site Key & Secret Key konfiguriert
- [ ] Resend API Key & CONTACT_EMAIL gesetzt
- [ ] Google Analytics Measurement ID eingetragen
- [ ] AV-Vertrag mit Google akzeptiert
- [ ] Kontaktformular getestet (E-Mail erhalten?)
- [ ] Cookie-Banner getestet (Analytics lädt nur bei Consent?)
- [ ] Datenschutzerklärung gelesen und angepasst (falls nötig)

---

✅ **Fertig!** Deine Seite ist jetzt DSGVO/nDSG-konform mit:
- Cookie-Consent-Banner
- Google Analytics (nur mit Einwilligung)
- Kontaktformular mit Spam-Schutz
- Korrekte Datenschutzerklärung

Bei Fragen: Siehe README.md oder AGENTS.md
