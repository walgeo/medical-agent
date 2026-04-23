import { spawnSync } from 'child_process';
import { AlertMessage } from './AlertMessage';
import { INotificationChannel } from './INotificationChannel';

export class WindowsPowerShellChannel implements INotificationChannel {
  readonly name = 'powershell';

  notify(message: AlertMessage): boolean {
    const icon = message.severity === 'warning' ? 'Warning' : 'Information';
    const title = this.escape(message.title);
    const body = this.escape(message.body.replace(/\n/g, '`n'));

    const command = [
      'Add-Type -AssemblyName PresentationFramework',
      `[System.Windows.MessageBox]::Show('${body}', '${title}', 'OK', '${icon}')`,
    ].join('; ');

    const powershell = spawnSync('powershell', ['-NoProfile', '-Command', command], {
      stdio: 'ignore',
    });

    if ((powershell.status ?? 1) === 0) return true;

    const pwsh = spawnSync('pwsh', ['-NoProfile', '-Command', command], {
      stdio: 'ignore',
    });
    return (pwsh.status ?? 1) === 0;
  }

  private escape(value: string): string {
    return value.replace(/'/g, "''");
  }
}
