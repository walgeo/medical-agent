import { MedicalAppointment } from '../../domain/entities/MedicalAppointment';
import { IAlertNotifier } from '../../domain/ports/IAlertNotifier';
import { IEventPublisher } from '../../domain/ports/IEventPublisher';
import { ILogger } from '../../domain/ports/ILogger';

const MINUTES_BEFORE_ALERT = 10;

export class NotifyPreAppointment {
  constructor(
    private readonly alertNotifier: IAlertNotifier,
    private readonly eventPublisher: IEventPublisher,
    private readonly logger: ILogger,
  ) {}

  execute(appointment: MedicalAppointment, alreadyNotified: Set<string>): void {
    if (alreadyNotified.has(appointment.id)) return;

    const minutesUntilAppointment = this.getMinutesUntil(appointment.scheduledAt);
    const shouldAlert =
      minutesUntilAppointment <= MINUTES_BEFORE_ALERT && minutesUntilAppointment > 0;

    if (shouldAlert) {
      const preparationArea = this.getPreparationArea(appointment.specialty);

      this.eventPublisher.publish({
        version: 1,
        type: 'agent_thinking',
        occurredAt: new Date().toISOString(),
        appointmentId: appointment.id,
        patientName: appointment.patientName,
        doctorName: appointment.doctorName,
        specialty: appointment.specialty,
        scheduledAt: appointment.scheduledAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        actionText: `La cita de ${appointment.patientName} (${appointment.specialty}) inicia en ${Math.round(minutesUntilAppointment)} min. Emitiendo alerta de ${preparationArea}.`,
      });

      this.alertNotifier.notifyVitalSignsAlert(appointment);

      this.eventPublisher.publish({
        version: 1,
        type: 'pre_appointment_alert',
        occurredAt: new Date().toISOString(),
        appointmentId: appointment.id,
        patientName: appointment.patientName,
        doctorName: appointment.doctorName,
        specialty: appointment.specialty,
        scheduledAt: appointment.scheduledAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        actionText: `La cita inicia en ${Math.round(minutesUntilAppointment)} minutos. Pasar a ${preparationArea}.`,
      });

      alreadyNotified.add(appointment.id);

      this.logger.log(
        'PRE_APPOINTMENT_ALERT',
        `Alerta enviada para cita de ${appointment.patientName} con Dr. ${appointment.doctorName} (${appointment.specialty}) en ${Math.round(minutesUntilAppointment)} min`,
      );
    }
  }

  private getMinutesUntil(scheduledAt: Date): number {
    const now = new Date();
    const diffMs = scheduledAt.getTime() - now.getTime();
    return diffMs / 60_000;
  }

  private getPreparationArea(specialty: string): string {
    const normalized = specialty.trim().toLowerCase();
    if (normalized === 'toma de laboratorios') return 'toma de laboratorios';
    if (normalized === 'toma de estudios especiales') return 'toma de estudios especiales';
    return 'signos vitales';
  }
}