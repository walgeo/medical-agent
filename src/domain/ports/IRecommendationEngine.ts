import { MedicalAppointment } from '../entities/MedicalAppointment';
import { AppointmentRecommendation } from '../recommendations/AppointmentRecommendation';

export interface IRecommendationEngine {
  recommend(
    appointment: MedicalAppointment,
    context: MedicalAppointment[],
  ): Promise<AppointmentRecommendation | null>;
}
