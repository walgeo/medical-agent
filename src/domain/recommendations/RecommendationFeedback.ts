export type RecommendationFeedbackOutcome = 'accepted' | 'ignored' | 'false_alarm';

export interface RecommendationMetricsSnapshot {
  totalGenerated: number;
  totalAccepted: number;
  totalIgnored: number;
  totalFalseAlarm: number;
}
