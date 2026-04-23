import { IRecommendationGovernance } from '../../domain/ports/IRecommendationGovernance';
import { AppointmentRecommendation } from '../../domain/recommendations/AppointmentRecommendation';
import {
  RecommendationFeedbackOutcome,
  RecommendationMetricsSnapshot,
} from '../../domain/recommendations/RecommendationFeedback';

interface RecommendationRecord {
  appointmentId: string;
  recommendation: AppointmentRecommendation;
  confirmationStatus: 'not_required' | 'pending' | 'confirmed';
  feedbackOutcome?: RecommendationFeedbackOutcome;
}

export class InMemoryRecommendationGovernance implements IRecommendationGovernance {
  private readonly records = new Map<string, RecommendationRecord>();
  private readonly metrics: RecommendationMetricsSnapshot = {
    totalGenerated: 0,
    totalAccepted: 0,
    totalIgnored: 0,
    totalFalseAlarm: 0,
  };

  registerRecommendation(
    appointmentId: string,
    recommendation: AppointmentRecommendation,
  ): { confirmationStatus: 'not_required' | 'pending' } {
    this.metrics.totalGenerated += 1;

    const confirmationStatus = recommendation.requiresHumanConfirmation
      ? 'pending'
      : 'not_required';

    this.records.set(appointmentId, {
      appointmentId,
      recommendation,
      confirmationStatus,
    });

    return { confirmationStatus };
  }

  confirmRecommendation(appointmentId: string): boolean {
    const record = this.records.get(appointmentId);
    if (!record) return false;
    if (!record.recommendation.requiresHumanConfirmation) return false;
    if (record.confirmationStatus === 'confirmed') return true;

    record.confirmationStatus = 'confirmed';
    this.metrics.totalAccepted += 1;
    return true;
  }

  addFeedback(appointmentId: string, outcome: RecommendationFeedbackOutcome): boolean {
    const record = this.records.get(appointmentId);
    if (!record) return false;
    if (record.feedbackOutcome === outcome) return true;

    if (record.feedbackOutcome) {
      this.decrementMetric(record.feedbackOutcome);
    }

    record.feedbackOutcome = outcome;

    if (outcome === 'accepted') this.metrics.totalAccepted += 1;
    if (outcome === 'ignored') this.metrics.totalIgnored += 1;
    if (outcome === 'false_alarm') this.metrics.totalFalseAlarm += 1;

    return true;
  }

  getMetrics(): RecommendationMetricsSnapshot {
    return { ...this.metrics };
  }

  private decrementMetric(outcome: RecommendationFeedbackOutcome): void {
    if (outcome === 'accepted') this.metrics.totalAccepted = Math.max(0, this.metrics.totalAccepted - 1);
    if (outcome === 'ignored') this.metrics.totalIgnored = Math.max(0, this.metrics.totalIgnored - 1);
    if (outcome === 'false_alarm') {
      this.metrics.totalFalseAlarm = Math.max(0, this.metrics.totalFalseAlarm - 1);
    }
  }
}
