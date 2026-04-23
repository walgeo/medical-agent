import { MedicalAppointment } from '../../domain/entities/MedicalAppointment';
import { AppointmentStatus } from '../../domain/enums/AppointmentStatus';
import { IAppointmentUpdater } from '../../domain/ports/IAppointmentUpdater';
import { IEventPublisher } from '../../domain/ports/IEventPublisher';
import { ILogger } from '../../domain/ports/ILogger';

const VITAL_SIGNS_WINDOW_MINUTES = 10;

export class ProcessVitalSignsQueue {
  constructor(
    private readonly appointmentUpdater: IAppointmentUpdater,
    private readonly eventPublisher: IEventPublisher,
    private readonly logger: ILogger,
  ) {}

  async execute(appointment: MedicalAppointment): Promise<void> {
    if (appointment.status !== AppointmentStatus.WaitingVitalSigns) return;
    if (!this.isWithinVitalSignsWindow(appointment)) return;

    await this.appointmentUpdater.markAsReadyForAppointment(appointment.id, new Date());

    this.eventPublisher.publish({
      version: 1,
      type: 'vital_signs_completed',
      occurredAt: new Date().toISOString(),
      appointmentId: appointment.id,
      patientName: appointment.patientName,
      doctorName: appointment.doctorName,
      specialty: appointment.specialty,
      scheduledAt: appointment.scheduledAt.toISOString(),
      endsAt: appointment.endsAt.toISOString(),
      actionText: 'Signos vitales completados. Paciente listo para pasar con el medico.',
    });

    this.logger.log(
      'VITAL_SIGNS_COMPLETED',
      `Signos vitales completados para ${appointment.patientName}.`,
    );
  }

  private isWithinVitalSignsWindow(appointment: MedicalAppointment): boolean {
    if (appointment.lateArrivalApproved) {
      return true;
    }

    const now = Date.now();
    const startWindow = appointment.scheduledAt.getTime() - VITAL_SIGNS_WINDOW_MINUTES * 60_000;
    const endWindow = appointment.scheduledAt.getTime() + VITAL_SIGNS_WINDOW_MINUTES * 60_000;
    return now >= startWindow && now <= endWindow;
  }
}
