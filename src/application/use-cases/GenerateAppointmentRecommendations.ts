import { MedicalAppointment } from '../../domain/entities/MedicalAppointment';
import { IEventPublisher } from '../../domain/ports/IEventPublisher';
import { ILogger } from '../../domain/ports/ILogger';
import { IRecommendationEngine } from '../../domain/ports/IRecommendationEngine';
import { IRecommendationGovernance } from '../../domain/ports/IRecommendationGovernance';

export class GenerateAppointmentRecommendations {
  constructor(
    private readonly recommendationEngine: IRecommendationEngine,
    private readonly recommendationGovernance: IRecommendationGovernance,
    private readonly eventPublisher: IEventPublisher,
    private readonly logger: ILogger,
  ) {}

  async execute(appointments: MedicalAppointment[], alreadyRecommended: Set<string>): Promise<void> {
    for (const appointment of appointments) {
      if (alreadyRecommended.has(appointment.id)) continue;

      const recommendation = await this.recommendationEngine.recommend(appointment, appointments);
      if (!recommendation) continue;

      const { confirmationStatus } = this.recommendationGovernance.registerRecommendation(
        appointment.id,
        recommendation,
      );

      const recommendationWithStatus = {
        ...recommendation,
        confirmationStatus,
      };

      this.eventPublisher.publish({
        version: 1,
        type: 'appointment_recommendation',
        occurredAt: new Date().toISOString(),
        appointmentId: appointment.id,
        patientName: appointment.patientName,
        doctorName: appointment.doctorName,
        specialty: appointment.specialty,
        scheduledAt: appointment.scheduledAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        actionText: recommendationWithStatus.actionText,
        recommendation: recommendationWithStatus,
      });

      alreadyRecommended.add(appointment.id);

      this.logger.log(
        'APPOINTMENT_RECOMMENDATION',
        `Recomendacion ${recommendation.type} (${recommendation.priority}) para cita ${appointment.id}. source=${recommendation.source ?? 'unknown'}, confirmacion=${confirmationStatus}`,
      );
    }
  }
}
