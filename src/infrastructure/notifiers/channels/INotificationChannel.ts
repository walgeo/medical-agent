import { AlertMessage } from './AlertMessage';

export interface INotificationChannel {
  readonly name: string;
  notify(message: AlertMessage): boolean;
}
