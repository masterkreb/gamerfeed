/**
 * CSS Migration Check Script
 * Prüft auf potenzielle Probleme nach der Tailwind v4 Migration
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE = path.join(__dirname, '..');

// Dateien zum Scannen
const FILES_TO_SCAN = [
    'App.tsx',
    'admin.tsx',
    'index.tsx',
    'components/ArticleCard.tsx',
    'components/ErrorBoundary.tsx',
    'components/ErrorFallback.tsx',
    'components/FavoritesHeader.tsx',
    'components/FilterBar.tsx',
    'components/Footer.tsx',
    'components/Header.tsx',
    'components/Icons.tsx',
    'components/LanguageSwitcher.tsx',
    'components/ScrollToTopButton.tsx',
    'components/SettingsModal.tsx',
    'components/admin/AdminPanel.tsx',
    'components/admin/FeedFormModal.tsx',
    'components/admin/FeedManagementTab.tsx',
    'components/admin/HealthCenterTab.tsx',
    'components/admin/HealthLegendTab.tsx',
];

// Bekannte problematische Klassen in Tailwind v4
const POTENTIAL_ISSUES = {
    // Deprecated oder geänderte Klassen
    'bg-opacity-': { 
        issue: 'bg-opacity ist deprecated in v4', 
        fix: 'Nutze bg-black/50 statt bg-black bg-opacity-50',
        severity: 'warning'
    },
    'text-opacity-': { 
        issue: 'text-opacity ist deprecated in v4', 
        fix: 'Nutze text-white/50 statt text-white text-opacity-50',
        severity: 'warning'
    },
    'border-opacity-': { 
        issue: 'border-opacity ist deprecated in v4', 
        fix: 'Nutze border-white/50 statt border-white border-opacity-50',
        severity: 'warning'
    },
    'placeholder-opacity-': {
        issue: 'placeholder-opacity ist deprecated in v4',
        fix: 'Nutze placeholder:text-gray-400/50',
        severity: 'warning'
    },
    'divide-opacity-': {
        issue: 'divide-opacity ist deprecated in v4',
        fix: 'Nutze divide-gray-200/50',
        severity: 'warning'
    },
    'ring-opacity-': {
        issue: 'ring-opacity ist deprecated in v4',
        fix: 'Nutze ring-blue-500/50',
        severity: 'warning'
    },
    
    // Form-Elemente die möglicherweise Styling brauchen
    '<input': {
        issue: 'Input-Felder könnten Form-Resets brauchen',
        fix: 'Prüfe ob Input-Styling korrekt ist',
        severity: 'info'
    },
    '<textarea': {
        issue: 'Textarea könnte Form-Resets brauchen',
        fix: 'Prüfe ob Textarea-Styling korrekt ist',
        severity: 'info'
    },
    '<select': {
        issue: 'Select könnte Form-Resets brauchen',
        fix: 'Prüfe ob Select-Styling korrekt ist',
        severity: 'info'
    },
    
    // Alte Syntax
    '@apply': {
        issue: '@apply im TSX gefunden - sollte in CSS sein',
        fix: 'Verschiebe @apply in src/index.css',
        severity: 'error'
    },
};

// Klassen die in v4 anders funktionieren könnten
const V4_CHANGED_CLASSES = [
    'transform', // Nicht mehr nötig in v4
    'filter',    // Nicht mehr nötig in v4
    'backdrop-filter', // Nicht mehr nötig in v4
];

// Alle Tailwind-Klassen extrahieren
function extractClasses(content) {
    const classRegex = /className\s*=\s*[{"`']([^`"'}]+)[`"'}]/g;
    const classes = [];
    let match;
    
    while ((match = classRegex.exec(content)) !== null) {
        const classString = match[1];
        // Template literals auflösen (einfach)
        const cleanedClasses = classString
            .replace(/\$\{[^}]+\}/g, '') // Template expressions entfernen
            .split(/\s+/)
            .filter(c => c.length > 0 && !c.includes('$') && !c.includes('{'));
        classes.push(...cleanedClasses);
    }
    
    return [...new Set(classes)];
}

// Report generieren
function generateReport() {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║         TAILWIND V4 MIGRATION CHECK                         ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    
    const allClasses = new Set();
    const issues = [];
    const fileReports = [];
    
    for (const file of FILES_TO_SCAN) {
        const filePath = path.join(WORKSPACE, file);
        
        if (!fs.existsSync(filePath)) {
            console.log(`⚠️  Datei nicht gefunden: ${file}`);
            continue;
        }
        
        const content = fs.readFileSync(filePath, 'utf-8');
        const classes = extractClasses(content);
        classes.forEach(c => allClasses.add(c));
        
        const fileIssues = [];
        
        // Auf problematische Muster prüfen
        for (const [pattern, info] of Object.entries(POTENTIAL_ISSUES)) {
            if (content.includes(pattern)) {
                fileIssues.push({
                    pattern,
                    ...info,
                    file
                });
            }
        }
        
        // Auf veränderte Klassen prüfen
        for (const cls of V4_CHANGED_CLASSES) {
            if (classes.includes(cls)) {
                fileIssues.push({
                    pattern: cls,
                    issue: `'${cls}' ist in v4 nicht mehr nötig (automatisch angewendet)`,
                    fix: `Kann entfernt werden, aber schadet nicht`,
                    severity: 'info',
                    file
                });
            }
        }
        
        if (fileIssues.length > 0) {
            issues.push(...fileIssues);
        }
        
        fileReports.push({
            file,
            classCount: classes.length,
            issues: fileIssues.length
        });
    }
    
    // Datei-Übersicht
    console.log('📁 DATEI-ANALYSE:');
    console.log('─'.repeat(60));
    
    for (const report of fileReports) {
        const statusIcon = report.issues === 0 ? '✅' : '⚠️';
        console.log(`${statusIcon} ${report.file.padEnd(45)} ${report.classCount} Klassen`);
    }
    
    console.log('\n');
    
    // Issues nach Severity gruppieren
    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');
    const infos = issues.filter(i => i.severity === 'info');
    
    // Errors
    if (errors.length > 0) {
        console.log('🔴 FEHLER (müssen behoben werden):');
        console.log('─'.repeat(60));
        for (const issue of errors) {
            console.log(`   Datei: ${issue.file}`);
            console.log(`   Problem: ${issue.issue}`);
            console.log(`   Lösung: ${issue.fix}`);
            console.log('');
        }
    }
    
    // Warnings
    if (warnings.length > 0) {
        console.log('🟡 WARNUNGEN (sollten geprüft werden):');
        console.log('─'.repeat(60));
        for (const issue of warnings) {
            console.log(`   Datei: ${issue.file}`);
            console.log(`   Pattern: ${issue.pattern}`);
            console.log(`   Problem: ${issue.issue}`);
            console.log(`   Lösung: ${issue.fix}`);
            console.log('');
        }
    }
    
    // Infos
    if (infos.length > 0) {
        console.log('🔵 INFO (zur Kenntnisnahme):');
        console.log('─'.repeat(60));
        for (const issue of infos) {
            console.log(`   Datei: ${issue.file}`);
            console.log(`   ${issue.issue}`);
        }
        console.log('');
    }
    
    // Zusammenfassung
    console.log('\n📊 ZUSAMMENFASSUNG:');
    console.log('─'.repeat(60));
    console.log(`   Geprüfte Dateien: ${fileReports.length}`);
    console.log(`   Gefundene Klassen: ${allClasses.size}`);
    console.log(`   🔴 Fehler: ${errors.length}`);
    console.log(`   🟡 Warnungen: ${warnings.length}`);
    console.log(`   🔵 Infos: ${infos.length}`);
    
    if (errors.length === 0 && warnings.length === 0) {
        console.log('\n✅ MIGRATION SIEHT GUT AUS! Keine kritischen Probleme gefunden.');
    } else if (errors.length === 0) {
        console.log('\n⚠️  Kleinere Anpassungen empfohlen, aber nichts Kritisches.');
    } else {
        console.log('\n❌ Es wurden Fehler gefunden, die behoben werden sollten.');
    }
    
    // Zusätzliche Empfehlungen
    console.log('\n📋 MANUELLE TESTS EMPFOHLEN:');
    console.log('─'.repeat(60));
    console.log('   1. Dark Mode auf allen Seiten prüfen');
    console.log('   2. Alle Modals öffnen und schließen (ESC, Backdrop, X-Button)');
    console.log('   3. Filter-Modal: Alle Filter durchklicken');
    console.log('   4. Settings-Modal: Sources muten/unmuten');
    console.log('   5. Admin-Panel: Alle Tabs durchgehen');
    console.log('   6. Toast-Notifications: Erscheinen und Swipe testen');
    console.log('   7. Hover-Effekte auf Artikel-Cards');
    console.log('   8. Scroll-to-Top Button');
    console.log('   9. Language Switcher');
    console.log('   10. Favoriten-System');
    
    console.log('\n');
}

generateReport();
