import { MedicalAppointment } from '../../domain/entities/MedicalAppointment';
import { IEventPublisher } from '../../domain/ports/IEventPublisher';
import { ILogger } from '../../domain/ports/ILogger';
import { IRecommendationEngine } from '../../domain/ports/IRecommendationEngine';
import { IRecommendationGovernance } from '../../domain/ports/IRecommendationGovernance';

export class GenerateAppointmentRecommendations {
  private readonly nextEvaluationAtByAppointment = new Map<string, number>();
  private readonly noRecommendationCooldownMs = this.readCooldownMs();

  constructor(
    private readonly recommendationEngine: IRecommendationEngine,
    private readonly recommendationGovernance: IRecommendationGovernance,
    private readonly eventPublisher: IEventPublisher,
    private readonly logger: ILogger,
  ) {}

  async execute(appointments: MedicalAppointment[], alreadyRecommended: Set<string>): Promise<void> {
    const nowMs = Date.now();

    for (const appointment of appointments) {
      if (alreadyRecommended.has(appointment.id)) continue;

      if (!this.shouldEvaluateAppointment(appointment, nowMs)) {
        continue;
      }

      const nextEvaluationAt = this.nextEvaluationAtByAppointment.get(appointment.id);
      if (nextEvaluationAt && nextEvaluationAt > nowMs) {
        continue;
      }

      const recommendation = await this.recommendationEngine.recommend(appointment, appointments);
      if (!recommendation) {
        this.nextEvaluationAtByAppointment.set(appointment.id, nowMs + this.noRecommendationCooldownMs);
        continue;
      }

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
      this.nextEvaluationAtByAppointment.delete(appointment.id);

      this.logger.log(
        'APPOINTMENT_RECOMMENDATION',
        `Recomendacion ${recommendation.type} (${recommendation.priority}) para cita ${appointment.id}. source=${recommendation.source ?? 'unknown'}, confirmacion=${confirmationStatus}`,
      );
    }

    if (this.nextEvaluationAtByAppointment.size > appointments.length * 2) {
      const activeIds = new Set(appointments.map((appointment) => appointment.id));
      for (const appointmentId of this.nextEvaluationAtByAppointment.keys()) {
        if (!activeIds.has(appointmentId)) {
          this.nextEvaluationAtByAppointment.delete(appointmentId);
        }
      }
    }
  }

  private shouldEvaluateAppointment(appointment: MedicalAppointment, nowMs: number): boolean {
    const scheduledMs = appointment.scheduledAt.getTime();
    const minutesUntil = (scheduledMs - nowMs) / 60_000;

    // Evaluar principalmente citas en ventana operativa para evitar costo innecesario.
    return minutesUntil <= 90 && minutesUntil >= -45;
  }

  private readCooldownMs(): number {
    const raw = process.env.RECOMMENDATION_EVALUATION_COOLDOWN_MS ?? '300000';
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 60_000) {
      return 300_000;
    }

    return Math.round(parsed);
  }
}
