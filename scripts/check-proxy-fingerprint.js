// Isolierter Produktionsvergleich des PHP-Proxys (Roadmap-Paket O4d).
//
// Beantwortet genau eine Frage: liegt auf dem externen Hosting dieselbe Datei
// wie in `tools/feed-proxy.php`?
//
// Bewusst **kein** Bestandteil des Feed-Laufs. Der Vergleich laeuft ueber einen
// eigenen, manuell gestarteten Workflow, damit er einen News-Publish niemals
// blockieren kann - und damit ein abweichender Fingerprint eine ruhige
// Betriebsentscheidung bleibt statt eines roten Cron-Laufs.
//
// Der Lauf fasst weder Feed-Anbieter noch Produktionscache, Datenbank oder
// KV-Schluessel an. Er stellt genau eine GET-Anfrage an den Fingerprint-Modus.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
    checkProxyFingerprint,
    computeProxyFingerprint,
    redactProxyMessage,
} from './proxy-fingerprint.js';

const PROXY_SOURCE_PATH = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../tools/feed-proxy.php',
);

/**
 * Fuehrt den Vergleich aus und meldet ihn.
 *
 * Alle Aussenkanten sind injizierbar, damit der Ablauf ohne Netz, ohne echtes
 * Hosting und ohne echte Wartezeit pruefbar ist.
 *
 * @param {{
 *   env?: Record<string, unknown>,
 *   readSource?: () => Promise<string>,
 *   check?: typeof checkProxyFingerprint,
 *   logger?: Pick<Console, 'log'|'error'>,
 *   exit?: (code: number) => unknown,
 *   fetchImpl?: Function,
 *   lookup?: Function,
 * }} [options]
 */
export async function main({
    env = process.env,
    readSource = () => readFile(PROXY_SOURCE_PATH, 'utf8'),
    check = checkProxyFingerprint,
    logger = console,
    exit = code => process.exit(code),
    fetchImpl,
    lookup,
} = {}) {
    const feedProxyUrl = typeof env.FEED_PROXY_URL === 'string' ? env.FEED_PROXY_URL.trim() : '';
    const redact = message => redactProxyMessage(message, feedProxyUrl || null);

    let expectedFingerprint = null;
    try {
        expectedFingerprint = computeProxyFingerprint(await readSource());
    } catch (error) {
        // Der Pfad der Quelldatei ist nicht geheim, der Fehlertext trotzdem
        // durch dieselbe Bereinigung.
        logger.error(`❌ tools/feed-proxy.php ist nicht lesbar: ${redact(error)}`);
        return exit(1);
    }

    // Der erwartete Fingerprint darf im Protokoll stehen: er ist der Hash einer
    // oeffentlich im Repository liegenden Datei. Die Adresse des Endpunkts steht
    // dagegen nirgends.
    logger.log(`🔎 Erwarteter Fingerprint aus tools/feed-proxy.php: ${expectedFingerprint}`);

    const result = await check({
        feedProxyUrl,
        expectedFingerprint,
        fetchImpl,
        lookup,
    });

    if (result.outcome === 'ok') {
        logger.log(`✅ ${result.message}`);
        return exit(0);
    }

    if (result.outcome === 'mismatch') {
        logger.error(`❌ ${result.message}`);
        logger.error(`   erwartet:  ${result.expected}`);
        logger.error(`   gemeldet:  ${result.actual}`);
        logger.error('   Nächster Schritt: docs/deployment/feed-proxy.md, Abschnitt „Fingerprint prüfen“.');
        return exit(1);
    }

    logger.error(`❌ Fingerprint-Vergleich nicht möglich (${result.outcome}): ${redact(result.message)}`);
    return exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    main();
}
