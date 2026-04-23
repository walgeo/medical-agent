import { spawnSync } from 'child_process';
import { AlertMessage } from './AlertMessage';
import { INotificationChannel } from './INotificationChannel';

export class MacOsascriptChannel implements INotificationChannel {
  readonly name = 'osascript';

  notify(message: AlertMessage): boolean {
    const title = this.escape(message.title);
    const body = this.escape(message.body.replace(/\n/g, '\\n'));
    const script = `display dialog \"${body}\" with title \"${title}\" buttons {\"ENTENDIDO\"} default button \"ENTENDIDO\"`;

    const result = spawnSync('osascript', ['-e', script], { stdio: 'ignore' });
    return (result.status ?? 1) === 0;
  }

  private escape(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
}
