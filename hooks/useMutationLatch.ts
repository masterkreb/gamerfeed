import { useCallback, useRef, useState } from 'react';

export interface MutationLatch {
    /**
     * Nur für Anzeige, `aria-busy` und Deaktivierung gedacht – niemals als
     * alleiniger Schutz gegen eine zweite Auslösung.
     */
    isMutating: boolean;
    /**
     * Führt `mutate` aus, solange keine andere Mutation desselben Latches
     * läuft, und liefert `false`, wenn der Aufruf deshalb abgewiesen wurde.
     * Die Sperre wird in jedem Erfolgs- und Fehlerpfad wieder freigegeben.
     */
    runExclusive: (mutate: () => Promise<void>) => Promise<boolean>;
}

/**
 * Schützt mutierende Aktionen gegen zwei Ereignisse im selben Render-Zyklus.
 *
 * React-State allein genügt dafür nicht: Zwei synchrone Klicks oder Submits
 * sehen beide noch den alten Wert, weil React erst danach neu rendert. Der
 * `useRef`-Latch wird deshalb synchron vor dem ersten `await` gesetzt; die
 * State-Kopie dient ausschließlich der Oberfläche.
 *
 * Ein gemeinsamer Latch für mehrere Aktionen (etwa Speichern und Löschen
 * derselben Ankündigung) verhindert zusätzlich, dass zwei verschiedene
 * Mutationen synchron nebeneinander starten.
 */
export function useMutationLatch(): MutationLatch {
    const isMutatingRef = useRef(false);
    const [isMutating, setIsMutating] = useState(false);

    const runExclusive = useCallback(async (mutate: () => Promise<void>) => {
        if (isMutatingRef.current) {
            return false;
        }

        isMutatingRef.current = true;
        setIsMutating(true);

        try {
            await mutate();
            return true;
        } finally {
            isMutatingRef.current = false;
            setIsMutating(false);
        }
    }, []);

    return { isMutating, runExclusive };
}
