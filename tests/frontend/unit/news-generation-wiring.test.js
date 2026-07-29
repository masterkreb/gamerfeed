import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Verdrahtungswaechter fuer das Leseprotokoll in App.tsx (Roadmap O3a).
//
// **Warum ein Quelltextwaechter und kein Verhaltenstest?**
//
// Die drei Entscheidungen unten liegen in `shared/news-snapshot.js` und sind
// dort vollstaendig gegen ihre Regeln getestet. Was ein Regeltest nicht
// abdeckt, ist der Fall „App.tsx ruft die Funktion gar nicht mehr auf" - und
// genau das soll hier auffallen.
//
// Ein Verhaltenstest waere der bessere Waechter, ist aber fuer den
// Auto-Update-Pfad derzeit nicht erreichbar: er haengt an einem
// 5-Minuten-Intervall, und ein manueller Refresh leert die Warteschlange, bevor
// sich der sichtbare Stand ueberhaupt verschieben kann. Mit der Umstrukturierung
// des News-Lifecycles in F1 wird der Pfad testbar; bis dahin ist dieser
// Waechter die ehrlichere Absicherung als gar keiner.

const APP_SOURCE = await readFile(new URL('../../../App.tsx', import.meta.url), 'utf8');

/** Rumpf einer `const <name> = useCallback(...)`-Deklaration. */
function callbackBody(source, name) {
    const start = source.indexOf(`const ${name} = useCallback(`);
    assert.notEqual(start, -1, `${name} existiert in App.tsx`);

    const end = source.indexOf('\n    }, [', start);
    assert.notEqual(end, -1, `${name} hat eine Abhaengigkeitsliste`);

    return source.slice(start, end);
}

test('die Uebernahme ausstehender Artikel prueft die Generation erneut', () => {
    // Zwischen dem Vormerken und dem Klick koennen Minuten liegen. Ohne diese
    // Pruefung setzte ein Klick auf eine Warteschlange aus Generation B eine
    // bereits sichtbare Generation C wieder zurueck.
    const body = callbackBody(APP_SOURCE, 'loadPendingArticles');

    assert.match(
        body,
        /planPendingAdoption\(\s*\{/,
        'loadPendingArticles muss planPendingAdoption aufrufen',
    );
    assert.match(body, /pinned:\s*pinnedSnapshotRef\.current/, 'gegen die gepinnte Generation');
    assert.match(body, /if\s*\(!plan\.adopt\)/, 'und das Ergebnis auch auswerten');
});

test('die Uebernahme speichert den Snapshot der uebernommenen Artikel', () => {
    const body = callbackBody(APP_SOURCE, 'loadPendingArticles');

    assert.match(
        body,
        /persistCachedArticles\(pending\.articles,\s*plan\.snapshot\)/,
        'die lokale Kopie bekommt die Generation der tatsaechlich uebernommenen Artikel',
    );
});

test('jede Antwort wird gegen die gepinnte Generation geprueft', () => {
    const body = callbackBody(APP_SOURCE, 'acceptSnapshotResponse');

    assert.match(body, /decideSnapshotAcceptance\(\s*\{/);
    assert.match(body, /rollback:\s*readSnapshotRollback\(response\.headers\)/,
        'ein ausdruecklicher Rollback muss erkannt werden');
});

test('der Auto-Update-Pfad pinnt nicht', () => {
    // Er zeigt nichts an; die gepinnte Generation muss zum sichtbaren Stand
    // passen. Ein `pinnedSnapshotRef.current = ...` waere hier der Fehler.
    const body = callbackBody(APP_SOURCE, 'checkForNewArticles');

    assert.doesNotMatch(
        body,
        /pinnedSnapshotRef\.current\s*=/,
        'checkForNewArticles darf die gepinnte Generation nicht verschieben',
    );
    assert.match(body, /setPending\(\{\s*articles:\s*fetchedArticles,\s*snapshot:\s*incoming\s*\}\)/,
        'Artikel und Generation werden gemeinsam vorgemerkt');
});

test('die lokale Kopie wird immer mit einer ausdruecklichen Generation gespeichert', () => {
    // `persistCachedArticles` verlangt den Snapshot als zweiten Parameter.
    // Ein Aufruf ohne ihn waere ein TypeScript-Fehler - dieser Test haelt
    // zusaetzlich fest, dass niemand die gepinnte Generation stillschweigend
    // einsetzt, wo die Artikel aus einer anderen stammen.
    const aufrufe = [...APP_SOURCE.matchAll(/persistCachedArticles\(([^)]*)\)/g)]
        .map(treffer => treffer[1].trim())
        .filter(argumente => !argumente.startsWith('('));

    assert.ok(aufrufe.length >= 5, `erwartet mehrere Aufrufe, gefunden: ${aufrufe.length}`);
    for (const argumente of aufrufe) {
        assert.match(argumente, /,/, `zweites Argument fehlt: persistCachedArticles(${argumente})`);
    }
});
