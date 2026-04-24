import { MedicalAppointment } from '../../domain/entities/MedicalAppointment';
import { AppointmentStatus } from '../../domain/enums/AppointmentStatus';
import { IAppointmentUpdater } from '../../domain/ports/IAppointmentUpdater';
import { IAlertNotifier } from '../../domain/ports/IAlertNotifier';
import { IEventPublisher } from '../../domain/ports/IEventPublisher';
import { ILogger } from '../../domain/ports/ILogger';

function isDirectServiceSpecialty(specialty: string): boolean {
  const normalized = specialty.trim().toLowerCase();
  return normalized === 'toma de laboratorios' || normalized === 'toma de estudios especiales';
}

export class StartAppointment {
  constructor(
    private readonly appointmentUpdater: IAppointmentUpdater,
    private readonly alertNotifier: IAlertNotifier,
    private readonly eventPublisher: IEventPublisher,
    private readonly logger: ILogger,
  ) {}

  async execute(appointment: MedicalAppointment, alreadyStarted: Set<string>): Promise<void> {
    if (alreadyStarted.has(appointment.id)) return;
    if (appointment.status !== AppointmentStatus.ReadyForAppointment) return;

    const now = new Date();
    const isTimeToStart = this.isWithinAppointmentWindow(now, appointment.scheduledAt, appointment.endsAt);
    if (!isTimeToStart) return;

    const hasAssignedDoctor = appointment.doctorName.trim().length > 0;
    const doctorLabel = hasAssignedDoctor ? `Dr. ${appointment.doctorName}` : 'personal de servicio';
    const directService = isDirectServiceSpecialty(appointment.specialty);

    this.eventPublisher.publish({
      version: 1,
      type: 'agent_thinking',
      occurredAt: now.toISOString(),
      appointmentId: appointment.id,
      patientName: appointment.patientName,
      doctorName: appointment.doctorName,
      specialty: appointment.specialty,
      scheduledAt: appointment.scheduledAt.toISOString(),
      endsAt: appointment.endsAt.toISOString(),
      actionText: `Preparación completada para ${appointment.patientName}. Iniciando atención con ${doctorLabel}.`,
    });

    if (hasAssignedDoctor) {
      this.eventPublisher.publish({
        version: 1,
        type: 'patient_call_to_doctor',
        occurredAt: now.toISOString(),
        appointmentId: appointment.id,
        patientName: appointment.patientName,
        doctorName: appointment.doctorName,
        specialty: appointment.specialty,
        scheduledAt: appointment.scheduledAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        actionText: 'Paciente, por favor pasar con el medico para iniciar la consulta.',
      });
    }

    await this.appointmentUpdater.markAsStarted(appointment.id);
    alreadyStarted.add(appointment.id);

    this.alertNotifier.notifyAppointmentStarted(appointment);

    this.eventPublisher.publish({
      version: 1,
      type: 'appointment_started',
      occurredAt: new Date().toISOString(),
      appointmentId: appointment.id,
      patientName: appointment.patientName,
      doctorName: appointment.doctorName,
      specialty: appointment.specialty,
      scheduledAt: appointment.scheduledAt.toISOString(),
      endsAt: appointment.endsAt.toISOString(),
      actionText: directService
        ? 'La toma de servicio inicio y se completo en la misma atencion.'
        : 'La cita llego a su hora de inicio y fue marcada como Iniciada.',
    });

    if (directService) {
      await this.appointmentUpdater.markAsCompleted(appointment.id);
      this.logger.log(
        'APPOINTMENT_COMPLETED',
        `Servicio de ${appointment.specialty} para ${appointment.patientName} completado sin consulta medica.`,
      );
      return;
    }

    this.logger.log(
      'APPOINTMENT_STARTED',
      `Cita de ${appointment.patientName} con ${doctorLabel} (${appointment.specialty}) marcada como Iniciada`,
    );
  }

  private isWithinAppointmentWindow(now: Date, scheduledAt: Date, endsAt: Date): boolean {
    return now >= scheduledAt && now < endsAt;
  }
}