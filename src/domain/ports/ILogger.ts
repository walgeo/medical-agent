export interface ILogger {
  log(action: string, detail: string): void;
  getLogs(): LogEntry[];
}

export interface LogEntry {
  timestamp: Date;
  action: string;
  detail: string;
}