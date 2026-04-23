import { MedicalAppointment } from '../../domain/entities/MedicalAppointment';
import { IRecommendationEngine } from '../../domain/ports/IRecommendationEngine';
import { AppointmentRecommendation } from '../../domain/recommendations/AppointmentRecommendation';

export class FallbackRecommendationEngine implements IRecommendationEngine {
  constructor(
    private readonly primary: IRecommendationEngine,
    private readonly fallback: IRecommendationEngine,
  ) {}

  async recommend(
    appointment: MedicalAppointment,
    context: MedicalAppointment[],
  ): Promise<AppointmentRecommendation | null> {
    const primaryRecommendation = await this.primary.recommend(appointment, context);
    if (primaryRecommendation) return primaryRecommendation;
    return this.fallback.recommend(appointment, context);
  }
}
