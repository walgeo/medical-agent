import { AppointmentRecommendation } from '../recommendations/AppointmentRecommendation';
import {
  RecommendationFeedbackOutcome,
  RecommendationMetricsSnapshot,
} from '../recommendations/RecommendationFeedback';

export interface IRecommendationGovernance {
  registerRecommendation(
    appointmentId: string,
    recommendation: AppointmentRecommendation,
  ): { confirmationStatus: 'not_required' | 'pending' };
  confirmRecommendation(appointmentId: string): boolean;
  addFeedback(appointmentId: string, outcome: RecommendationFeedbackOutcome): boolean;
  getMetrics(): RecommendationMetricsSnapshot;
}
