import { MedicalAppointment } from '../../domain/entities/MedicalAppointment';
import { AppointmentStatus } from '../../domain/enums/AppointmentStatus';
import { IAppointmentUpdater } from '../../domain/ports/IAppointmentUpdater';
import { IDecisionEngine } from '../../domain/ports/IDecisionEngine';
import { IEventPublisher } from '../../domain/ports/IEventPublisher';
import { ILogger } from '../../domain/ports/ILogger';

const LATE_ARRIVAL_TOLERANCE_MINUTES = 10;

function getPreparationArea(specialty: string): string {
  const s = specialty.toLowerCase();
  if (s === 'toma de laboratorios') return 'toma de laboratorios';
  if (s === 'toma de estudios especiales') return 'toma de estudios especiales';
  return 'signos vitales';
}

export class ProcessPatientArrival {
  constructor(
    private readonly appointmentUpdater: IAppointmentUpdater,
    private readonly eventPublisher: IEventPublisher,
    private readonly logger: ILogger,
    private readonly decisionEngine: IDecisionEngine,
  ) {}

  async execute(appointment: MedicalAppointment, context: MedicalAppointment[] = []): Promise<void> {
    if (appointment.status !== AppointmentStatus.Active) return;
    if (appointment.checkedInAt) return;
    if (!appointment.simulatedArrivalAt) return;
    const now = new Date();
    if (now < appointment.simulatedArrivalAt) return;

    if (now > appointment.endsAt) {
      const patientCancels = appointment.lateArrivalOutcome === 'cancel';

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
        actionText: `Paciente fuera de ventana de cita (${appointment.patientName}). Aplicando politica operativa de cierre de franja.`,
      });

      this.eventPublisher.publish({
        version: 1,
        type: 'agent_decision',
        occurredAt: new Date().toISOString(),
        appointmentId: appointment.id,
        patientName: appointment.patientName,
        doctorName: appointment.doctorName,
        specialty: appointment.specialty,
        scheduledAt: appointment.scheduledAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        actionText: patientCancels
          ? `Decision operativa: ${appointment.patientName} cancela la cita fuera de horario.`
          : `Decision operativa: reagendar cita de ${appointment.patientName} por llegada fuera de horario.`,
        agentReasoning: patientCancels
          ? 'La franja de atencion ya finalizo y el paciente prefirio no continuar con la cita.'
          : 'La franja de atencion ya finalizo. Politica fija: reagendar cuando la llegada es posterior al horario de la cita.',
        decisionSource: 'heuristic',
        decisionConfidence: 'high',
      });

      if (patientCancels) {
        await this.appointmentUpdater.markAsCancelled(appointment.id);
        this.logger.log(
          'LATE_ARRIVAL_CANCELLED',
          `Paciente ${appointment.patientName} cancelo la cita por llegada fuera de horario.`,
        );
        return;
      }

      const rescheduledTo = this.nextAvailableSlot(appointment.scheduledAt);
      await this.appointmentUpdater.markAsRescheduled(appointment.id, rescheduledTo);

      this.eventPublisher.publish({
        version: 1,
        type: 'appointment_rescheduled',
        occurredAt: new Date().toISOString(),
        appointmentId: appointment.id,
        patientName: appointment.patientName,
        doctorName: appointment.doctorName,
        specialty: appointment.specialty,
        scheduledAt: appointment.scheduledAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        actionText: `Cita reagendada por llegada fuera de horario. Nuevo horario sugerido: ${rescheduledTo.toLocaleString('es-CR')}.`,
      });

      this.logger.log(
        'LATE_ARRIVAL_AFTER_WINDOW_RESCHEDULED',
        `Paciente ${appointment.patientName} reagendado por llegada fuera de horario.`,
      );
      return;
    }

    const minutesLate = this.getMinutesLate(now, appointment.scheduledAt);

    if (minutesLate > LATE_ARRIVAL_TOLERANCE_MINUTES) {
      // Notificar que el agente está evaluando
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
        actionText: `Detecté que ${appointment.patientName} llegó con ${Math.round(minutesLate)} min de retraso. Consultando motor de decisión IA para evaluar si puede ser atendido hoy...`,
      });

      await this.appointmentUpdater.markAsSecretaryReview(appointment.id);

      this.eventPublisher.publish({
        version: 1,
        type: 'secretary_review',
        occurredAt: now.toISOString(),
        appointmentId: appointment.id,
        patientName: appointment.patientName,
        doctorName: appointment.doctorName,
        specialty: appointment.specialty,
        scheduledAt: appointment.scheduledAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        actionText:
          'Paciente llego tarde (+10 min). Secretaria valida si aun puede atenderse o se reagenda.',
      });

      // Decisión IA: ¿atender o reagendar?
      let result;
      try {
        result = await this.decisionEngine.decideLateArrival(appointment, minutesLate, context);
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : 'unknown';
        this.logger.log('DECISION_ERROR', `Fallo la decisión para ${appointment.patientName}: ${detail}. Usando reagendar como fallback.`);
        result = {
          decision: 'reschedule' as const,
          reasoning: 'Error en motor de decisión. Reagendando por seguridad.',
          confidence: 'low' as const,
          source: 'heuristic' as const,
        };
      }

      this.eventPublisher.publish({
        version: 1,
        type: 'agent_decision',
        occurredAt: new Date().toISOString(),
        appointmentId: appointment.id,
        patientName: appointment.patientName,
        doctorName: appointment.doctorName,
        specialty: appointment.specialty,
        scheduledAt: appointment.scheduledAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        actionText: result.decision === 'attend'
          ? `Decisión IA: Aprobar atención de ${appointment.patientName}`
          : `Decisión IA: Reagendar cita de ${appointment.patientName}`,
        agentReasoning: result.reasoning,
        decisionSource: result.source,
        decisionConfidence: result.confidence,
      });

      if (result.decision === 'reschedule') {
        const rescheduledTo = this.nextAvailableSlot(appointment.scheduledAt);
        await this.appointmentUpdater.markAsRescheduled(appointment.id, rescheduledTo);

        this.eventPublisher.publish({
          version: 1,
          type: 'appointment_rescheduled',
          occurredAt: new Date().toISOString(),
          appointmentId: appointment.id,
          patientName: appointment.patientName,
          doctorName: appointment.doctorName,
          specialty: appointment.specialty,
          scheduledAt: appointment.scheduledAt.toISOString(),
          endsAt: appointment.endsAt.toISOString(),
          actionText: `Cita reagendada por llegada tardia. Nuevo horario sugerido: ${rescheduledTo.toLocaleString('es-CR')}.`,
        });

        this.logger.log(
          'LATE_ARRIVAL_RESCHEDULED',
          `Paciente ${appointment.patientName} reagendado por llegada tardia.`,
        );
        return;
      }

      await this.appointmentUpdater.markAsWaitingVitalSigns(appointment.id, now, true);

      this.eventPublisher.publish({
        version: 1,
        type: 'patient_arrived',
        occurredAt: new Date().toISOString(),
        appointmentId: appointment.id,
        patientName: appointment.patientName,
        doctorName: appointment.doctorName,
        specialty: appointment.specialty,
        scheduledAt: appointment.scheduledAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        actionText:
          `Paciente autorizado por secretaria y enviado a la cola de ${getPreparationArea(appointment.specialty)}.`,
      });

      this.logger.log(
        'LATE_ARRIVAL_APPROVED',
        `Paciente ${appointment.patientName} aprobado por secretaria para atencion el mismo dia.`,
      );
      return;
    }

    await this.appointmentUpdater.markAsWaitingVitalSigns(appointment.id, now, false);

    this.eventPublisher.publish({
      version: 1,
      type: 'patient_arrived',
      occurredAt: now.toISOString(),
      appointmentId: appointment.id,
      patientName: appointment.patientName,
      doctorName: appointment.doctorName,
      specialty: appointment.specialty,
      scheduledAt: appointment.scheduledAt.toISOString(),
      endsAt: appointment.endsAt.toISOString(),
      actionText: `Paciente verificado y enviado a la cola de espera para ${getPreparationArea(appointment.specialty)}.`,
    });

    this.logger.log(
      'PATIENT_ARRIVED',
      `Paciente ${appointment.patientName} verificado y en cola de ${getPreparationArea(appointment.specialty)}.`,
    );
  }

  private getMinutesLate(now: Date, scheduledAt: Date): number {
    const diffMs = now.getTime() - scheduledAt.getTime();
    return diffMs / 60_000;
  }

  private nextAvailableSlot(base: Date): Date {
    const next = new Date(base);
    next.setHours(next.getHours() + 2);
    return next;
  }
}
