import notifier from 'node-notifier';
import { AlertMessage } from './AlertMessage';
import { INotificationChannel } from './INotificationChannel';

export class NodeNotifierChannel implements INotificationChannel {
  readonly name = 'node-notifier';

  notify(message: AlertMessage): boolean {
    try {
      notifier.notify({
        title: message.title,
        message: message.body,
        wait: false,
      });
      return true;
    } catch {
      return false;
    }
  }
}
