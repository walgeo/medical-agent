import { MedicalAppointment } from '../../domain/entities/MedicalAppointment';
import { IDecisionEngine, LateArrivalResult } from '../../domain/ports/IDecisionEngine';

export class HeuristicDecisionEngine implements IDecisionEngine {
  async decideLateArrival(
    appointment: MedicalAppointment,
    minutesLate: number,
    context: MedicalAppointment[],
  ): Promise<LateArrivalResult> {
    const durationMinutes = Math.round(
      (appointment.endsAt.getTime() - appointment.scheduledAt.getTime()) / 60000,
    );
    const remainingMinutes = durationMinutes - minutesLate;

    const activeLoad = context.filter(
      (a) => a.status !== 'Completada' && a.status !== 'Cancelada',
    ).length;
    const agendaIsFull = activeLoad >= 9;

    const doctorHasConflict = context.some(
      (a) =>
        a.id !== appointment.id &&
        a.doctorName === appointment.doctorName &&
        a.scheduledAt <= appointment.endsAt &&
        a.endsAt >= appointment.scheduledAt,
    );

    if (minutesLate > 25) {
      return {
        decision: 'reschedule',
        reasoning: `El paciente llegó con ${minutesLate} minutos de retraso, lo que no deja tiempo útil suficiente para una consulta completa.`,
        confidence: 'high',
        source: 'heuristic',
      };
    }

    if (agendaIsFull && remainingMinutes < 20) {
      return {
        decision: 'reschedule',
        reasoning: `La agenda está a tope (${activeLoad} citas activas) y solo quedan ${remainingMinutes} minutos útiles para la consulta. Se recomienda reagendar desde secretaría.`,
        confidence: 'high',
        source: 'heuristic',
      };
    }

    if (doctorHasConflict) {
      return {
        decision: 'reschedule',
        reasoning: `El doctor ${appointment.doctorName} tiene otra cita activa en el mismo horario. Atender al paciente tardío generaría conflicto de agenda.`,
        confidence: 'high',
        source: 'heuristic',
      };
    }

    if (remainingMinutes >= 20) {
      return {
        decision: 'attend',
        reasoning: `Quedan ${remainingMinutes} minutos útiles y el doctor no tiene conflictos de agenda. Supera el mínimo operativo de 20 minutos, por lo que se puede atender hoy.`,
        confidence: 'medium',
        source: 'heuristic',
      };
    }

    return {
      decision: 'reschedule',
      reasoning: `Solo quedan ${remainingMinutes} minutos útiles, por debajo del mínimo de 20 minutos para atención segura y completa. Se recomienda reagendar desde secretaría.`,
      confidence: 'medium',
      source: 'heuristic',
    };
  }
}
