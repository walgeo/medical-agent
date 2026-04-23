import { MedicalAppointment } from '../../domain/entities/MedicalAppointment';
import { IDecisionEngine, LateArrivalResult } from '../../domain/ports/IDecisionEngine';

export class FallbackDecisionEngine implements IDecisionEngine {
  constructor(
    private readonly primary: IDecisionEngine,
    private readonly fallback: IDecisionEngine,
  ) {}

  async decideLateArrival(
    appointment: MedicalAppointment,
    minutesLate: number,
    context: MedicalAppointment[],
  ): Promise<LateArrivalResult> {
    try {
      return await this.primary.decideLateArrival(appointment, minutesLate, context);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'unknown';
      console.log(`[DECISION_FALLBACK] Motor LLM falló (${detail}). Usando heurística.`);
      return await this.fallback.decideLateArrival(appointment, minutesLate, context);
    }
  }
}
