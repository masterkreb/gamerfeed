// Shared state returned by the cached backend health report.
export interface HealthState {
    status: 'unknown' | 'checking' | 'ok' | 'warning' | 'error';
    detail: string | null;
}
