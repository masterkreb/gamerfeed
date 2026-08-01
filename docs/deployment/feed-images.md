# Artikelbilder und Bildgesundheit

Stand: 1. August 2026 (Roadmap-Paket O2c)

GamerFeed bevorzugt Bilder, die ein Feed direkt je Artikel liefert. Fehlt ein
verwendbares Bild und ist die Quelle dafür vorgesehen, folgt ein begrenzter
Fallback. Ein allgemeines Feed-Logo ist **kein** Artikelbild.

## XboxDynasty: Befund vom 29. Juli 2026

Seit dem 29. Juli erschienen neue XboxDynasty-Artikel nur noch mit dem
Platzhalter. Der aktuelle RSS-Feed enthält je Artikel weder `enclosure` noch
`media:content`, `media:thumbnail` oder ein Bild in der Beschreibung. Sein
einziges `<channel><image>` ist ein allgemeines 32×32-Favicon und darf nicht
auf alle Artikel kopiert werden.

Die normalen Artikelseiten antworten automatisierten Abrufen mit HTTP 401. Das
ist kein Beleg für eine gezielte Sperre gegen GamerFeed; es entspricht eher
einer allgemeinen Bot- oder Firewall-Regel. Die öffentliche WordPress-REST-API
liefert weiterhin HTTP 200 und in `yoast_head_json.og_image` das jeweilige
Artikelbild.

## Ein Batch statt vieler Artikelseiten

`scripts/source-image-resolvers.js` ruft für XboxDynasty den festen Endpunkt

```text
/wp-json/wp/v2/posts?per_page=100&_fields=link,yoast_head_json.og_image
```

ab. Die verschachtelte `_fields`-Auswahl ist wichtig: Im Produktionstest waren
zehn Einträge damit rund 2,9 KB groß statt rund 68 KB mit dem vollständigen
Yoast-Objekt.

Der Abruf:

- entsteht nur, wenn ein aktueller RSS-Artikel nach Wiederverwendung des
  gespeicherten Bilds weiterhin keines besitzt;
- zählt als genau **ein** Zugriff gegen das globale Scrape-Budget;
- hat 5 Sekunden Timeout und 128 KiB Byte-Limit;
- läuft durch dieselbe Outbound- und Redirect-Policy wie Feed und OG-Scrape;
- ordnet Artikel über den XboxDynasty-Pfad zu; ein abschließender Slash und
  ein Querystring ändern die Zuordnung nicht;
- repariert bei derselben Gelegenheit passende gespeicherte Platzhalter.

Direkte HTML-Scrapes und der allgemeine Bild-Backfill sind für XboxDynasty
deaktiviert. Scheitert die API, bleibt es dadurch bei **einem** kleinen Versuch
pro Lauf statt bis zu zehn aktuellen und fünf alten Artikelseiten. Der externe
PHP-Proxy auf Cyon und seine Allowlist bleiben unverändert.

Vor dem Ausfall war die normale Last klein: 72 RSS-Abrufe pro Tag bei einem
20-Minuten-Takt und dank gespeicherter Bilder nur ein Seitenabruf je wirklich
neuem Artikel. Erst die dauerhaft erfolglosen Platzhalter hätten ohne diese
Korrektur wiederholte Reparaturversuche ausgelöst – theoretisch bis zu 15 je
Lauf beziehungsweise 1.080 am Tag, soweit das globale Budget reicht.

## Automatische Erkennung im Admin

`feed_health_status` trägt additiv zwei Zahlen je erfolgreich geparstem Feed:

| Feld | Bedeutung |
|---|---|
| `usableImageCount` | Artikel des letzten Abrufs mit verwendbarem Bild |
| `placeholderImageCount` | Artikel des letzten Abrufs mit Platzhalter |

`null` bedeutet **nicht gemessen**, etwa bei einem Abruffehler, einer
Zurückstellung oder einem alten Datensatz. Eine `0` ist eine tatsächlich
gemessene Null.

Ist die Quelle im aktiven Snapshot und enthält der letzte Abruf mindestens
einen Platzhalter, zeigt ihre Admin-Zeile eine Warnung. Der Text unterscheidet
einige fehlende Bilder von einem vollständigen Bildausfall und nennt die
gemessenen Zahlen. Das funktioniert für **jede** Quelle, nicht nur für
XboxDynasty. Alte Health-Daten ohne Bildfelder werden nicht nachträglich als
Warnung geraten.

Die Erkennung ist Beobachtbarkeit, noch keine aktive Benachrichtigung: Man sieht
sie nach dem nächsten erfolgreichen Cron-Lauf beim Laden des Admin-Bereichs.
Eine E-Mail- oder externe Alarmierung gehört weiterhin zu O4c. Die Messung
bezieht sich auf die Artikel des letzten Feed-Abrufs, nicht auf alle bis zu
10.000 Artikel des aktiven Snapshots.

## Wenn eine weitere Quelle ihre Ausgabe ändert

Der allgemeine Bildzähler macht den Ausfall sichtbar. Die Reparatur bleibt
bewusst quellspezifisch: Zuerst wird geprüft, ob RSS, eine offizielle API oder
strukturierte Daten ein Bild liefern. Ein neuer Proxy- oder HTML-Scrape ist nur
die letzte Option und wird nicht automatisch für alle Quellen freigeschaltet.
