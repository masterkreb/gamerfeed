# Release-Prozess

Dieses Runbook beschreibt den verbindlichen Weg von einer Codeänderung bis zum
Production-Deployment von GamerFeed. Ziel ist, dass kein ungeprüfter direkter
Push auf `main` bereits von Vercel produktiv veröffentlicht wird.

## Gewählte Strategie

GamerFeed verwendet Pull Requests mit verpflichtenden Statusprüfungen:

1. Änderungen entstehen auf einem eigenen Branch.
2. Der Branch wird zu GitHub gepusht und als Pull Request gegen `main`
   geöffnet.
3. Der Pull Request muss mit dem aktuellen `main`-Stand übereinstimmen.
4. Folgende Checks müssen erfolgreich sein:
   - `Tests, TypeScript und Build`
   - `Browser-Abnahme (Chromium)`
   - `Vercel`
5. Offene Review-Kommentare müssen aufgelöst sein.
6. Erst danach wird per Rebase oder Squash gemergt. Direkte Pushes, Force
   Pushes und das Löschen von `main` sind gesperrt.

Das Repository wird momentan allein gepflegt. Deshalb ist kein fremdes
Review-Approval vorgeschrieben: Der Pull Request und die automatischen Checks
sind verpflichtend, aber der eigene PR bleibt nach erfolgreicher Prüfung
mergebar.

## GitHub-Regel für `main`

Im Repository wird ein aktives Branch-Ruleset für den Default Branch verwendet:

- Name: `main-release-gate`
- Ziel: Default Branch (`main`)
- Pull Request vor dem Merge erforderlich
- benötigte Approvals: `0`
- erforderliche Checks: die drei oben genannten Checks
- Branch muss vor dem Merge aktuell sein
- offene Konversationen müssen aufgelöst sein
- lineare Historie
- Force Pushes und Löschen gesperrt
- kein dauerhafter Bypass für direkte Production-Pushes

Das Ruleset wurde am 28. Juli 2026 über die GitHub-API als `active` und ohne
Bypass-Akteure verifiziert.

Die beiden GitHub-Actions-Jobs bekommen in `.github/workflows/ci.yml` keine
produktiven Secrets. Der schreibende Feed-Workflow in
`.github/workflows/update-feeds.yml` läuft ausschließlich für
`refs/heads/main`.

## Vercel-Umgebungen

Vercel verwendet `main` als Production Branch. Pull-Request-Branches erzeugen
nur Preview-Deployments.

Produktive Schreibzugänge dürfen ausschließlich für **Production** gelten.
Insbesondere gehören diese Werte nicht in die allgemeine Preview-Umgebung:

- `POSTGRES_URL`
- `KV_URL`
- `KV_REST_API_READ_ONLY_TOKEN`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `REDIS_URL`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`
- `RECAPTCHA_SECRET_KEY`
- `GROQ_API_KEY`
- `CRON_SECRET`

Am 28. Juli 2026 wurde die bestehende Upstash-Ressource `gamerfeed-kv` vom
Projekt getrennt und mit **Production** sowie aktivierter
`Sensitive`-Einstellung wieder verbunden. `vercel env ls preview` und
`vercel env ls development` liefern keine Projektvariablen; alle 14
bestehenden Projektvariablen sind weiterhin in Production vorhanden.
`CRON_SECRET` wird im Repository derzeit nicht verwendet, bleibt aber bis zu
einem eigenen Bereinigungsschritt auf Production begrenzt bestehen.

Preview braucht für die automatisierte Abnahme keine Ersatz-Secrets:
`tests/e2e` stellt API-Antworten selbst, blockiert fremde Herkünfte und läuft
als eigener GitHub-Actions-Job. Falls später ein funktionsfähiges Staging
benötigt wird, erhält es eigene Datenbank-, KV- und Dienstkonten statt
Production-Zugänge.

`RECAPTCHA_ALLOWED_HOSTNAMES` ist in Production auf die produktiven Hostnamen
begrenzt. Für wechselnde Preview-Domains bleibt die Variable weg; ohne
serverseitiges reCAPTCHA-Secret ist das Kontaktformular dort bewusst nicht
versandfähig.

## Merge und Production-Abnahme

Vor dem Merge:

1. Pull-Request-Diff vollständig prüfen.
2. Alle verpflichtenden Checks abwarten.
3. Kontrollieren, dass das Vercel-Ergebnis ein Preview-Deployment und kein
   Production-Deployment ist.
4. Erst bei grünem Merge-Status mergen.

Nach dem Merge:

1. Das neue Vercel-Deployment muss `main` und den gemergten Commit ausweisen.
2. Startseite, `/gaming-news` und `/admin.html` öffnen.
3. News-Preview, Medium- und Full-Endpunkt auf erfolgreiche Antworten prüfen.
4. Bei Änderungen am Kontaktpfad das Formular einmal kontrolliert testen.
5. Bei Fehlern nicht durch weitere ungeprüfte Commits „vorwärts reparieren“,
   sondern zuerst den Rollback-Ablauf verwenden.

## Rollback ohne Datenmutation

Ein normales Vercel-Deployment dieses Repositorys baut Frontend und Functions;
der Feed-Cache wird davon nicht neu geschrieben. Der schreibende Cron bleibt ein
separater GitHub-Actions-Workflow.

Bei einem fehlerhaften Production-Deployment:

1. In Vercel unter **Deployments** das letzte bekannte funktionierende
   Production-Deployment anhand Branch und Commit bestimmen.
2. Das aktuelle Fehlerbild und den betroffenen Commit notieren.
3. Vercels **Rollback** auf das vorherige Production-Deployment verwenden.
4. Startseite und die drei News-Endpunkte erneut prüfen.
5. Den korrigierenden Code wieder über einen neuen Pull Request ausliefern.

Ein Rollback ändert keine Feed-, Cache- oder Datenbankinhalte. Falls die
fehlerhafte Änderung selbst bereits Daten mutiert hat, ist zusätzlich das
fachspezifische Restore-Verfahren erforderlich; ein Vercel-Rollback ersetzt
kein Datenbank-Restore.

Für den ersten Release nach Einführung dieses Gates wurde das aktuelle
Production-Deployment
`gamerfeed-hp8n72trs-imads-projects-757e74dc.vercel.app` (`main`,
Commit `051be8a`, Status `Ready`) als Rücksprungziel identifiziert. Vor jedem
späteren Merge ist das dann aktuelle letzte funktionierende Deployment erneut
zu bestimmen.

Aktuelle Anbieteranleitungen:

- [GitHub – Rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [Vercel – Git Deployments](https://vercel.com/docs/git)
- [Vercel – Production Rollback](https://vercel.com/docs/deployments/rollback-production-deployment)

## Einmalige R1-Verifikation

R1 gilt erst als erledigt, wenn diese externen Zustände geprüft wurden:

- [x] GitHub-Ruleset für `main` aktiv
- [x] Pull Request #1 mit den drei erforderlichen Checks nachgewiesen
- [x] Vercel Production Branch ist `main`
- [x] produktive Schreib-Secrets gelten nicht für Preview
- [x] vorheriges Production-Deployment als Rollback-Ziel identifiziert
- [x] Preview kann weder Feed-Datenbank noch Production-KV verändern
