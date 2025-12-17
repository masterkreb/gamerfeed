# ⚡ Schnellstart: GamerFeed Setup

## ✅ Was bereits erledigt ist:

- ✅ Name "Imad Chatila" im Impressum
- ✅ Keine Adresse (Schweiz Hobby-Projekt → nicht nötig!)
- ✅ reCAPTCHA v3 statt Turnstile
- ✅ Kontaktformular als eigener Tab im Settings-Modal
- ✅ Cookie-Consent-System integriert
- ✅ Google Analytics vorbereitet

---

## 📝 Was DU noch machen musst:

### **1. reCAPTCHA Site Key eintragen** (5 Min)

#### A) Deine bestehende reCAPTCHA nutzen:
1. https://www.google.com/recaptcha/admin → Deine Site öffnen
2. **Domain hinzufügen:** `gamerfeed.vercel.app` (und optional `localhost`)
3. Keys kopieren

#### B) Oder neue Site erstellen:
1. https://www.google.com/recaptcha/admin → **"+ Neue Website"**
2. Label: "GamerFeed"
3. Typ: **reCAPTCHA v3**
4. Domains: `gamerfeed.vercel.app`, `localhost`

#### Site Key eintragen:
Öffne `components/SettingsModal.tsx` und ersetze **2x** `YOUR_RECAPTCHA_SITE_KEY` mit deinem Site Key:

**Zeile ~50:**
```typescript
script.src = 'https://www.google.com/recaptcha/api.js?render=6LeXXXXXXXXXX';
```

**Zeile ~70:**
```typescript
const token = await grecaptcha.execute('6LeXXXXXXXXXX', { action: 'contact_form' });
```

#### Secret Key in Vercel:
```bash
vercel env add RECAPTCHA_SECRET_KEY
# Paste dein Secret Key (6Le...)
```

---

### **2. E-Mail-Service wählen** (2-5 Min)

**Meine Empfehlung: Formspree** (am einfachsten!)

#### Option A: Formspree ⭐ (EMPFOHLEN)
1. https://formspree.io/ → Account erstellen (kostenlos)
2. Neues Formular erstellen
3. Notiere **Form ID** (z.B. `mwpeabc`)
4. Vercel Secret:
```bash
vercel env add FORMSPREE_FORM_ID
# Wert: mwpeabc
```

**Fertig!** E-Mails kommen an deine Formspree-Account-E-Mail.

#### Option B: Gmail SMTP (falls du Gmail nutzt)
1. https://myaccount.google.com/apppasswords
2. App-Passwort für "GamerFeed" erstellen
3. Vercel Secrets:
```bash
vercel env add GMAIL_USER
# deine@gmail.com

vercel env add GMAIL_APP_PASSWORD
# abcd efgh ijkl mnop
```

4. Installiere Nodemailer:
```bash
npm install nodemailer
```

---

### **3. Google Analytics** (Optional, 5 Min)

1. https://analytics.google.com/ → GA4 Property erstellen
2. Measurement ID notieren (z.B. `G-ABC123XYZ`)
3. Öffne `App.tsx`, Zeile ~22:
```typescript
const GA_MEASUREMENT_ID = 'G-ABC123XYZ'; // ← Deine ID
```

4. GA4 → Admin → **Data Processing Amendment** akzeptieren

---

## 🚀 Deployen & Testen

```bash
# Build testen
npm run build

# Lokal mit Serverless Functions testen
vercel dev

# Produktiv deployen
vercel --prod
```

### Nach Deploy testen:
1. ✅ Cookie-Banner erscheint beim ersten Besuch
2. ✅ Settings öffnen → **"Kontakt"-Tab** → Formular ausfüllen
3. ✅ reCAPTCHA v3 ist unsichtbar (läuft im Hintergrund)
4. ✅ E-Mail Check (Formspree/Gmail je nach Wahl)
5. ✅ Cookie-Banner: "Alle akzeptieren" → GA4 trackt

---

## 🔐 Vercel Secrets Übersicht

```bash
# Pflicht:
RECAPTCHA_SECRET_KEY        # Google reCAPTCHA Secret

# E-Mail (wähle EINE Option):
FORMSPREE_FORM_ID          # Formspree Form ID (empfohlen)
# ODER
GMAIL_USER                 # Gmail Adresse
GMAIL_APP_PASSWORD         # Gmail App-Passwort
# ODER
RESEND_API_KEY            # Resend API (später)
CONTACT_EMAIL             # Empfänger-E-Mail

# Optional:
# (Google Analytics braucht keine Secrets, nur Code-Änderung)

# Bereits vorhanden:
POSTGRES_URL
KV_REST_API_URL
KV_REST_API_TOKEN
GROQ_API_KEY
```

---

## 📋 Checkliste

- [ ] reCAPTCHA Site Key in `SettingsModal.tsx` (2x)
- [ ] reCAPTCHA Secret Key in Vercel Secrets
- [ ] E-Mail-Service gewählt (Formspree ODER Gmail)
- [ ] E-Mail-Secrets in Vercel eingetragen
- [ ] (Optional) Google Analytics Measurement ID in `App.tsx`
- [ ] `vercel --prod` deployen
- [ ] Kontaktformular testen
- [ ] Cookie-Banner testen

---

## 💡 Unterschied reCAPTCHA v3 vs. Turnstile

| Feature | reCAPTCHA v3 | Turnstile |
|---------|--------------|-----------|
| Anbieter | Google | Cloudflare |
| UX | Unsichtbar (Score) | Unsichtbar/Check |
| Keys wiederverwenden | ✅ Ja | ❌ Nein |
| Bereits im Einsatz | ✅ Bei dir | ❌ Neu |

→ reCAPTCHA macht für dich Sinn! ✅

---

## ❓ Hilfe

- **Formular sendet nicht:** Check Vercel Logs → Functions → `/api/contact`
- **reCAPTCHA Error:** Browser-Konsole öffnen, Fehler checken
- **Cookie-Banner fehlt:** Hard-Refresh `Ctrl+Shift+R`

Mehr Details: Siehe [SETUP-GUIDE.md](SETUP-GUIDE.md)
