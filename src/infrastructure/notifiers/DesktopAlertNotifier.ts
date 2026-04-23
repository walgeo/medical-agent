import { IAlertNotifier } from '../../domain/ports/IAlertNotifier';
import { MedicalAppointment } from '../../domain/entities/MedicalAppointment';
import { AlertMessage } from './channels/AlertMessage';
import { INotificationChannel } from './channels/INotificationChannel';
import { NotificationChannelFactory } from './channels/NotificationChannelFactory';

export class DesktopAlertNotifier implements IAlertNotifier {
  private readonly channels: INotificationChannel[];

  constructor(channels: INotificationChannel[] = NotificationChannelFactory.createForCurrentPlatform()) {
    this.channels = channels;
  }

  notifyVitalSignsAlert(appointment: MedicalAppointment): void {
    const minutesUntil = Math.round(this.getMinutesUntil(appointment.scheduledAt));
    const range = this.formatRange(appointment.scheduledAt, appointment.endsAt);
    const preparationArea = this.getPreparationArea(appointment.specialty);
    const doctor = this.doctorDisplayName(appointment.doctorName);
    this.showDialog({
      severity: 'warning',
      title: 'ALERTA - PREPARACION PREVIA',
      body:
        `Paciente: ${appointment.patientName}\n` +
        `Doctor: ${doctor}\n` +
        `Especialidad: ${appointment.specialty}\n` +
        `Horario de cita: ${range}\n\n` +
        `La cita inicia en ${minutesUntil} minutos.\n` +
        `Accion ahora: llevar al paciente a ${preparationArea}.`,
    });
  }

  notifyAppointmentStarted(appointment: MedicalAppointment): void {
    const range = this.formatRange(appointment.scheduledAt, appointment.endsAt);
    const doctor = this.doctorDisplayName(appointment.doctorName);
    this.showDialog({
      severity: 'info',
      title: 'CITA INICIADA',
      body:
        `Paciente: ${appointment.patientName}\n` +
        `Doctor: ${doctor}\n` +
        `Especialidad: ${appointment.specialty}\n` +
        `Horario de cita: ${range}\n\n` +
        `Estado actualizado: Iniciada.\n` +
        `Accion: continuar con la atencion medica.`,
    });
  }

  private showDialog(message: AlertMessage): void {
    for (const channel of this.channels) {
      const delivered = channel.notify(message);
      if (delivered) return;
    }

    // Ultimo fallback para no perder la alerta en entornos sin GUI.
    console.log(`[ALERT_FALLBACK] ${message.title} - ${message.body.replace(/\n/g, ' | ')}`);
  }

  private formatRange(start: Date, end: Date): string {
    const fmt = (d: Date) => d.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });
    return `${fmt(start)} – ${fmt(end)}`;
  }

  private getMinutesUntil(scheduledAt: Date): number {
    return (scheduledAt.getTime() - Date.now()) / 60_000;
  }

  private getPreparationArea(specialty: string): string {
    const normalized = specialty.trim().toLowerCase();
    if (normalized === 'toma de laboratorios') return 'toma de laboratorios';
    if (normalized === 'toma de estudios especiales') return 'toma de estudios especiales';
    return 'signos vitales';
  }

  private doctorDisplayName(doctorName: string): string {
    const normalized = doctorName.trim();
    return normalized ? `Dr. ${normalized}` : 'No asignado';
  }
}
