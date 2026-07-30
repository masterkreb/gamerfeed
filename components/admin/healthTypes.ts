// Shared state returned by the cached backend health report.
//
// Kein 'checking': Das Admin prueft keinen einzelnen Feed live, der Zustand
// wurde nirgends gesetzt und die Legende hat ihn deshalb nicht mehr.
export interface HealthState {
    status: 'unknown' | 'ok' | 'warning' | 'error';
    detail: string | null;
}
