import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Verdrahtungswaechter fuer das Leseprotokoll in App.tsx (Roadmap O3a).
//
// **Warum bleibt ein kleiner Quelltextwaechter bestehen?**
//
// Seit F1 pruefen Deferred-Promise-Tests den echten Controller. Diese Datei
// kontrolliert nur noch die duenne Verdrahtung in App.tsx: Controller, Pin,
// lokale Kopie und der weiterhin separate Auto-Update-Pfad.

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
    assert.match(body, /newsLoadController\.cancelPassiveRequests\(\)/,
        'eine sichtbare Uebernahme entwertet einen Poll mit altem Artikel-State');
});

test('die Uebernahme speichert den Snapshot der uebernommenen Artikel', () => {
    const body = callbackBody(APP_SOURCE, 'loadPendingArticles');

    assert.match(
        body,
        /persistCachedArticles\(pending\.articles,\s*plan\.snapshot\)/,
        'die lokale Kopie bekommt die Generation der tatsaechlich uebernommenen Artikel',
    );
});

test('der News-Controller ist mit Pin und lokaler Kopie verdrahtet', () => {
    assert.match(APP_SOURCE, /createNewsLoadController\(\s*\{/);
    assert.match(APP_SOURCE, /getPinnedSnapshot:\s*\(\)\s*=>\s*pinnedSnapshotRef\.current/);
    assert.match(
        APP_SOURCE,
        /setPinnedSnapshot:\s*snapshot\s*=>\s*\{\s*pinnedSnapshotRef\.current\s*=\s*snapshot/,
    );
    assert.match(
        APP_SOURCE,
        /commitArticles:\s*\(nextArticles,\s*snapshot\)\s*=>\s*\{[\s\S]*?persistCachedArticles\(nextArticles,\s*snapshot\)/,
        'nur der vom Controller akzeptierte Snapshot wird zusammen mit seinen Artikeln gespeichert',
    );
});

test('der Auto-Update-Pfad pinnt nicht', () => {
    // Er zeigt nichts an; die gepinnte Generation muss zum sichtbaren Stand
    // passen. Ein `pinnedSnapshotRef.current = ...` waere hier der Fehler.
    const body = callbackBody(APP_SOURCE, 'checkForNewArticles');

    assert.match(body, /newsLoadController\.beginPassiveRequest\(\)/);
    assert.match(body, /\{\s*signal:\s*request\.signal\s*\}/);
    assert.match(body, /if\s*\(!request\.isCurrent\(\)/,
        'der Poll muss vor Seiteneffekten weiter aktuell sein');
    assert.doesNotMatch(
        body,
        /pinnedSnapshotRef\.current\s*=/,
        'checkForNewArticles darf die gepinnte Generation nicht verschieben',
    );
    assert.match(body, /setPending\(\{\s*articles:\s*fetchedArticles,\s*snapshot:\s*incoming\s*\}\)/,
        'Artikel und Generation werden gemeinsam vorgemerkt');
});

test('ein Rollback im Auto-Update-Pfad raeumt die Warteschlange', () => {
    // Eine zurueckgezogene Generation darf nicht vorgemerkt bleiben - sonst
    // spielt ein spaeterer Klick genau sie ein.
    const body = callbackBody(APP_SOURCE, 'checkForNewArticles');

    assert.match(body, /planPollResponse\(\s*\{/, 'checkForNewArticles muss planPollResponse aufrufen');
    assert.match(body, /rollback:\s*readSnapshotRollback\(response\.headers\)/);
    assert.match(body, /if\s*\(plan\.clearPending\)/, 'und das Aufraeumen auch ausfuehren');
    assert.match(body, /setPending\(\{\s*articles:\s*\[\],\s*snapshot:\s*null\s*\}\)/,
        'die Warteschlange wird geleert');
    assert.match(body, /setNewArticlesCount\(0\)/, 'das Abzeichen wird zurueckgesetzt');
});

test('die lokale Kopie wird immer mit einer ausdruecklichen Generation gespeichert', () => {
    // `persistCachedArticles` verlangt den Snapshot als zweiten Parameter.
    // Ein Aufruf ohne ihn waere ein TypeScript-Fehler - dieser Test haelt
    // zusaetzlich fest, dass niemand die gepinnte Generation stillschweigend
    // einsetzt, wo die Artikel aus einer anderen stammen.
    const aufrufe = [...APP_SOURCE.matchAll(/persistCachedArticles\(([^)]*)\)/g)]
        .map(treffer => treffer[1].trim())
        .filter(argumente => !argumente.startsWith('('));

    assert.ok(aufrufe.length >= 2, `erwartet Controller und Pending-Pfad, gefunden: ${aufrufe.length}`);
    for (const argumente of aufrufe) {
        assert.match(argumente, /,/, `zweites Argument fehlt: persistCachedArticles(${argumente})`);
    }
});
