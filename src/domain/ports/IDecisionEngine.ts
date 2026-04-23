import { MedicalAppointment } from '../entities/MedicalAppointment';

export type LateArrivalDecision = 'attend' | 'reschedule';

export interface LateArrivalResult {
  decision: LateArrivalDecision;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'llm' | 'heuristic';
}

export interface IDecisionEngine {
  decideLateArrival(
    appointment: MedicalAppointment,
    minutesLate: number,
    context: MedicalAppointment[],
  ): Promise<LateArrivalResult>;
}
