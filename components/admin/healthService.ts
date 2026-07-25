export interface HealthState {
    status: 'unknown' | 'checking' | 'ok' | 'warning' | 'error';
    detail: string | null;
}
