import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { AlertMessage } from './AlertMessage';
import { INotificationChannel } from './INotificationChannel';

export class BrowserAlertChannel implements INotificationChannel {
  readonly name = 'browser-alert';
  private readonly isLinuxFlatpak =
    process.platform === 'linux' &&
    (Boolean(process.env.FLATPAK_ID) ||
      (process.env.DBUS_SESSION_BUS_ADDRESS ?? '').includes('/run/flatpak/bus'));

  notify(message: AlertMessage): boolean {
    try {
      const tempDir = mkdtempSync(join(tmpdir(), 'medical-alert-'));
      const htmlPath = join(tempDir, `alert-${Date.now()}.html`);
      const html = this.renderHtml(message);

      writeFileSync(htmlPath, html, { encoding: 'utf8' });
      const opened = this.openInDefaultBrowser(htmlPath);

      // En Flatpak, xdg-open puede devolver 0 sin mostrar la ventana al frente.
      // Dejamos continuar la cadena para garantizar una alerta visible.
      if (this.isLinuxFlatpak) return false;
      return opened;
    } catch {
      return false;
    }
  }

  private openInDefaultBrowser(filePath: string): boolean {
    if (process.platform === 'linux') {
      const result = spawnSync('xdg-open', [filePath], { stdio: 'ignore' });
      return (result.status ?? 1) === 0;
    }

    if (process.platform === 'darwin') {
      const result = spawnSync('open', [filePath], { stdio: 'ignore' });
      return (result.status ?? 1) === 0;
    }

    if (process.platform === 'win32') {
      const result = spawnSync('cmd', ['/c', 'start', '', filePath], { stdio: 'ignore' });
      return (result.status ?? 1) === 0;
    }

    return false;
  }

  private renderHtml(message: AlertMessage): string {
    const title = this.escapeHtml(message.title);
    const body = this.escapeHtml(message.body).replace(/\n/g, '<br />');
    const tone = message.severity === 'warning' ? 'warning' : 'info';
    const hero = tone === 'warning' ? 'ALERTA' : 'CITA INICIADA';
    const subtitle =
      tone === 'warning'
        ? 'Revise esta alerta ahora y ayude al paciente.'
        : 'La consulta ya inicio. Continue con la atencion.';

    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    :root {
      --bg: ${tone === 'warning' ? '#fff3e8' : '#eef7ff'};
      --panel: #ffffff;
      --text: #1f2937;
      --muted: #4b5563;
      --accent: ${tone === 'warning' ? '#d9480f' : '#1d4ed8'};
      --ok: #166534;
      --help: ${tone === 'warning' ? '#b91c1c' : '#0f766e'};
      --ring: ${tone === 'warning' ? '#fb923c' : '#60a5fa'};
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Noto Sans", "Segoe UI", Arial, sans-serif;
      background: radial-gradient(circle at top, #ffffff 0%, var(--bg) 58%, #e5e7eb 100%);
      color: var(--text);
      display: grid;
      place-items: center;
      padding: 28px;
    }

    .card {
      width: min(980px, 95vw);
      background: var(--panel);
      border: 3px solid var(--ring);
      border-radius: 20px;
      box-shadow: 0 24px 50px rgba(0, 0, 0, 0.18);
      overflow: hidden;
    }

    .header {
      display: flex;
      gap: 18px;
      align-items: center;
      padding: 26px 30px;
      border-bottom: 2px solid #e5e7eb;
      background: linear-gradient(120deg, #ffffff, ${tone === 'warning' ? '#ffedd5' : '#dbeafe'});
    }

    .icon {
      width: 86px;
      height: 86px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: white;
      font-size: 42px;
      font-weight: 800;
      background: var(--accent);
      flex-shrink: 0;
    }

    .headline {
      line-height: 1.25;
    }

    .headline h1 {
      margin: 0;
      font-size: clamp(2rem, 3vw, 2.55rem);
      letter-spacing: 0.2px;
    }

    .headline p {
      margin: 8px 0 0;
      font-size: clamp(1.1rem, 2vw, 1.38rem);
      color: var(--muted);
      font-weight: 600;
    }

    .content {
      padding: 26px 30px 16px;
    }

    .title {
      font-size: clamp(1.5rem, 2.3vw, 1.9rem);
      font-weight: 800;
      margin: 0 0 14px;
      color: var(--accent);
    }

    .message {
      background: #f8fafc;
      border: 2px solid #dbe3ec;
      border-radius: 14px;
      padding: 18px;
      font-size: clamp(1.15rem, 2vw, 1.45rem);
      line-height: 1.65;
      color: #111827;
      font-weight: 600;
    }

    .actions {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      padding: 22px 30px 30px;
    }

    .btn {
      border: 0;
      border-radius: 12px;
      padding: 14px 20px;
      min-height: 56px;
      font-size: clamp(1rem, 1.8vw, 1.22rem);
      font-weight: 800;
      cursor: pointer;
      color: white;
      letter-spacing: 0.2px;
    }

    .btn-ok { background: var(--ok); }
    .btn-help { background: var(--help); }

    .btn:focus-visible {
      outline: 4px solid #111827;
      outline-offset: 2px;
    }

    @media (max-width: 680px) {
      .header, .content, .actions { padding-left: 18px; padding-right: 18px; }
      .icon { width: 72px; height: 72px; font-size: 34px; }
      .btn { width: 100%; }
    }
  </style>
</head>
<body>
  <main class="card" role="alertdialog" aria-live="assertive" aria-label="Alerta medica">
    <section class="header">
      <div class="icon">${tone === 'warning' ? '!' : 'i'}</div>
      <div class="headline">
        <h1>${hero}</h1>
        <p>${subtitle}</p>
      </div>
    </section>

    <section class="content">
      <h2 class="title">${title}</h2>
      <div class="message">${body}</div>
    </section>

    <section class="actions">
      <button id="help" class="btn btn-help" type="button">Necesito asistencia</button>
      <button id="ok" class="btn btn-ok" type="button">Entendido</button>
    </section>
  </main>

  <script>
    const ok = document.getElementById('ok');
    const help = document.getElementById('help');

    ok?.addEventListener('click', () => {
      window.close();
      setTimeout(() => alert('Puede cerrar esta pestana.'), 100);
    });

    help?.addEventListener('click', () => {
      alert('Aviso registrado. Contacte al personal de apoyo.');
    });
  </script>
</body>
</html>`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
