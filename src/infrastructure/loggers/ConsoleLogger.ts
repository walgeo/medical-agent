import { ILogger, LogEntry } from '../../domain/ports/ILogger';

export class ConsoleLogger implements ILogger {
  private readonly entries: LogEntry[] = [];

  log(action: string, detail: string): void {
    const entry: LogEntry = {
      timestamp: new Date(),
      action,
      detail,
    };

    this.entries.push(entry);
    this.printEntry(entry);
  }

  getLogs(): LogEntry[] {
    return [...this.entries];
  }

  private printEntry(entry: LogEntry): void {
    const timestamp = entry.timestamp.toLocaleTimeString('es-CR');
    console.log(`[${timestamp}] [${entry.action}] ${entry.detail}`);
  }
}