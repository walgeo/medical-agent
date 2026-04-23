export type RecommendationPriority = 'alta' | 'media' | 'baja';

export type RecommendationType =
  | 'confirm_arrival'
  | 'prepare_room'
  | 'reschedule_candidate'
  | 'follow_up';

export interface AppointmentRecommendation {
  source?: 'llm' | 'fallback';
  priority: RecommendationPriority;
  type: RecommendationType;
  rationale: string;
  actionText: string;
  requiresHumanConfirmation: boolean;
  confirmationStatus?: 'not_required' | 'pending' | 'confirmed';
}
