import { MedicalAppointment } from '../../domain/entities/MedicalAppointment';
import { AppointmentStatus } from '../../domain/enums/AppointmentStatus';
import { IRecommendationEngine } from '../../domain/ports/IRecommendationEngine';
import { AppointmentRecommendation } from '../../domain/recommendations/AppointmentRecommendation';

export class HeuristicRecommendationEngine implements IRecommendationEngine {
  async recommend(
    appointment: MedicalAppointment,
    context: MedicalAppointment[],
  ): Promise<AppointmentRecommendation | null> {
    if (appointment.status !== AppointmentStatus.Active) return null;

    if (this.hasDoctorOverlap(appointment, context)) {
      return {
        source: 'fallback',
        priority: 'alta',
        type: 'reschedule_candidate',
        rationale:
          'Existe un solapamiento de agenda para el mismo doctor en otra cita activa.',
        actionText:
          'Revisar agenda del doctor y reprogramar una de las citas para evitar retrasos.',
        requiresHumanConfirmation: true,
      };
    }

    const minutesUntil = this.getMinutesUntil(appointment.scheduledAt);

    if (minutesUntil <= 15 && minutesUntil > 0) {
      return {
        source: 'fallback',
        priority: 'alta',
        type: 'confirm_arrival',
        rationale: 'La cita comienza pronto y conviene validar llegada del paciente.',
        actionText: `Confirmar llegada de ${appointment.patientName} y priorizar signos vitales.`,
        requiresHumanConfirmation: false,
      };
    }

    if (minutesUntil <= 45 && minutesUntil > 15) {
      return {
        source: 'fallback',
        priority: 'media',
        type: 'prepare_room',
        rationale: 'La cita esta proxima y permite preparar recursos con tiempo.',
        actionText: 'Preparar consultorio e insumos para reducir tiempos de espera.',
        requiresHumanConfirmation: false,
      };
    }

    if (minutesUntil <= -10 && minutesUntil >= -30) {
      return {
        source: 'fallback',
        priority: 'alta',
        type: 'follow_up',
        rationale: 'La cita debio iniciar y sigue activa; puede existir atraso operacional.',
        actionText: 'Contactar recepcion para confirmar estado real de la atencion.',
        requiresHumanConfirmation: false,
      };
    }

    return null;
  }

  private hasDoctorOverlap(
    appointment: MedicalAppointment,
    context: MedicalAppointment[],
  ): boolean {
    return context.some((other) => {
      if (other.id === appointment.id) return false;
      if (other.status !== AppointmentStatus.Active) return false;
      if (other.doctorName !== appointment.doctorName) return false;

      return (
        appointment.scheduledAt < other.endsAt &&
        appointment.endsAt > other.scheduledAt
      );
    });
  }

  private getMinutesUntil(scheduledAt: Date): number {
    return (scheduledAt.getTime() - Date.now()) / 60_000;
  }
}
