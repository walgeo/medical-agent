export type AlertSeverity = 'warning' | 'info';

export interface AlertMessage {
  severity: AlertSeverity;
  title: string;
  body: string;
}
