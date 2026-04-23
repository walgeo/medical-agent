import { spawnSync } from 'child_process';
import { AlertMessage } from './AlertMessage';
import { INotificationChannel } from './INotificationChannel';

export class LinuxZenityChannel implements INotificationChannel {
  readonly name = 'zenity';

  notify(message: AlertMessage): boolean {
    const title = message.severity === 'warning' ? 'ALERTA IMPORTANTE' : 'INFORMACION DE CITA';
    const kind = message.severity === 'warning' ? '--warning' : '--info';
    const text = this.buildReadableBody(message);

    const result = spawnSync(
      'zenity',
      [
        kind,
        `--title=${title}`,
        '--width=760',
        '--height=420',
        '--ok-label=ENTENDIDO',
        '--no-wrap',
        `--text=${text}`,
      ],
      { stdio: 'ignore' },
    );

    return (result.status ?? 1) === 0;
  }

  private buildReadableBody(message: AlertMessage): string {
    return [
      message.title,
      '',
      message.body,
      '',
      'Accion: confirmar que el paciente fue atendido.',
    ].join('\n');
  }
}
