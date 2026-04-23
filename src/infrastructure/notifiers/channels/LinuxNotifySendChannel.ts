import { spawnSync } from 'child_process';
import { AlertMessage } from './AlertMessage';
import { INotificationChannel } from './INotificationChannel';

export class LinuxNotifySendChannel implements INotificationChannel {
  readonly name = 'notify-send';

  notify(message: AlertMessage): boolean {
    const urgency = message.severity === 'warning' ? 'critical' : 'normal';
    const result = spawnSync('notify-send', ['-u', urgency, message.title, message.body], {
      stdio: 'ignore',
    });

    return (result.status ?? 1) === 0;
  }
}
