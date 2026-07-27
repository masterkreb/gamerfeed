// Read-only-Prüfung aller konfigurierten Feed-Adressen gegen die
// Outbound-Policy. Schreibt nichts - weder in die Datenbank noch in KV - und
// setzt auch keine Abrufe ab: geprüft werden Syntax und DNS-Auflösung.
//
// Gedacht als Vorabkontrolle: `node scripts/check-feed-urls.js`
// Beendet sich mit Code 1, sobald mindestens eine Adresse abgelehnt würde.

import 'dotenv/config';
import { sql } from '@vercel/postgres';
import { assertOutboundTargetAllowed } from './outbound-policy.js';

async function main() {
    const { rows: feeds } = await sql`SELECT id, name, url FROM feeds ORDER BY name;`;
    console.log(`\n🔍 ${feeds.length} konfigurierte Feeds werden gegen die Outbound-Policy geprüft.\n`);

    const rejected = [];

    for (const feed of feeds) {
        try {
            const { addresses } = await assertOutboundTargetAllowed(feed.url);
            const summary = addresses.map(entry => entry.address).join(', ');
            console.log(`   ✅ ${feed.name} — ${summary}`);
        } catch (error) {
            rejected.push({ feed, message: error.message });
            console.log(`   ❌ ${feed.name} — ${error.message}`);
            console.log(`      ${feed.url}`);
        }
    }

    if (rejected.length === 0) {
        console.log('\n✅ Alle Adressen passieren die Policy.\n');
        return;
    }

    console.log(`\n❌ ${rejected.length} von ${feeds.length} Adressen würden abgelehnt.`);
    console.log('   Vor dem Aktivieren klären, ob die Adresse falsch ist oder die Policy zu eng.\n');
    process.exitCode = 1;
}

main().catch(error => {
    console.error('\n❌ Prüfung fehlgeschlagen:', error.message);
    process.exitCode = 1;
});
