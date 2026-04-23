import { INotificationChannel } from './INotificationChannel';
import { BrowserAlertChannel } from './BrowserAlertChannel';
import { LinuxNotifySendChannel } from './LinuxNotifySendChannel';
import { LinuxZenityChannel } from './LinuxZenityChannel';
import { MacOsascriptChannel } from './MacOsascriptChannel';
import { NodeNotifierChannel } from './NodeNotifierChannel';
import { WindowsPowerShellChannel } from './WindowsPowerShellChannel';

export class NotificationChannelFactory {
  static createForCurrentPlatform(): INotificationChannel[] {
    switch (process.platform) {
      case 'linux':
        return [
          new BrowserAlertChannel(),
          new LinuxZenityChannel(),
          new LinuxNotifySendChannel(),
          new NodeNotifierChannel(),
        ];
      case 'darwin':
        return [new BrowserAlertChannel(), new MacOsascriptChannel(), new NodeNotifierChannel()];
      case 'win32':
        return [new BrowserAlertChannel(), new WindowsPowerShellChannel(), new NodeNotifierChannel()];
      default:
        return [new BrowserAlertChannel(), new NodeNotifierChannel()];
    }
  }
}
