import { MedicalAppointment } from '../../domain/entities/MedicalAppointment';
import { IDecisionEngine, LateArrivalResult } from '../../domain/ports/IDecisionEngine';
import { ILogger } from '../../domain/ports/ILogger';

interface LlmDecisionResponse {
  decision: 'attend' | 'reschedule';
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
}

export class LlmDecisionEngine implements IDecisionEngine {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(private readonly logger: ILogger) {
    this.apiUrl = process.env.RECOMMENDATION_LLM_URL ?? '';
    this.apiKey = process.env.RECOMMENDATION_LLM_API_KEY ?? '';
    this.model = process.env.RECOMMENDATION_LLM_MODEL ?? 'gpt-4o-mini';
    this.timeoutMs = parseInt(
      process.env.LLM_DECISION_TIMEOUT_MS ?? process.env.RECOMMENDATION_LLM_TIMEOUT_MS ?? '28000',
      10,
    );
  }

  async decideLateArrival(
    appointment: MedicalAppointment,
    minutesLate: number,
    context: MedicalAppointment[],
  ): Promise<LateArrivalResult> {
    if (!this.apiUrl) {
      throw new Error('LLM not configured');
    }

    const otherActiveAppointments = context.filter(
      (a) => a.id !== appointment.id && a.doctorName === appointment.doctorName,
    ).length;

    const durationMinutes = Math.round(
      (appointment.endsAt.getTime() - appointment.scheduledAt.getTime()) / 60000,
    );
    const remainingMinutes = durationMinutes - minutesLate;

    const prompt = `Eres un agente de triaje médico inteligente. Debes decidir si un paciente que llegó tarde a su cita puede ser atendido hoy o debe reagendarse.

Datos de la cita:
- Paciente: ${appointment.patientName}
- Doctor: Dr. ${appointment.doctorName}
- Especialidad: ${appointment.specialty}
- Duración programada: ${durationMinutes} minutos
- Minutos de retraso: ${minutesLate} min
- Tiempo útil restante: ${remainingMinutes} minutos
- Otras citas activas del mismo doctor: ${otherActiveAppointments}

Criterios a considerar:
- Llegadas tardías siempre pasan por evaluación de secretaría.
- Si la agenda está a tope (9 o más citas activas) y el tiempo útil restante es menor a 20 minutos → reagendar.
- Si el tiempo útil restante es de al menos 20 minutos y no hay conflicto de agenda del doctor → puede atenderse.
- Si el retraso supera 25 minutos → reagendar.
- Evalúa el balance entre atención al paciente y operación de la clínica

Responde ÚNICAMENTE con JSON válido, sin texto adicional:
{"decision":"attend","reasoning":"explicacion concisa en español","confidence":"high"}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'Eres un agente de triaje médico. Responde solo con JSON válido.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 180,
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error('Empty LLM response');

      const parsed = this.parseDecisionResponse(content);

      this.logger.log('LLM_DECISION', `Decisión LLM para ${appointment.patientName}: ${parsed.decision} (${parsed.confidence}) - ${parsed.reasoning}`);

      return {
        decision: parsed.decision,
        reasoning: parsed.reasoning,
        confidence: parsed.confidence ?? 'medium',
        source: 'llm',
      };
    } catch (error: unknown) {
      clearTimeout(timeout);
      const detail = error instanceof Error ? error.message : 'unknown';
      this.logger.log('LLM_DECISION_ERROR', detail);
      throw error;
    }
  }

  private parseDecisionResponse(content: string): LlmDecisionResponse {
    const candidate = this.extractJsonObject(content);
    const parsed = JSON.parse(candidate) as Partial<LlmDecisionResponse>;

    const decision = this.normalizeDecision(parsed.decision);
    if (!decision) {
      throw new Error(`Invalid decision value: ${String(parsed.decision)}`);
    }

    return {
      decision,
      reasoning: typeof parsed.reasoning === 'string' && parsed.reasoning.trim()
        ? parsed.reasoning.trim()
        : 'El modelo sugirió esta decisión según el contexto operativo actual.',
      confidence: this.normalizeConfidence(parsed.confidence),
    };
  }

  private extractJsonObject(text: string): string {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;

    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
      return trimmed.slice(first, last + 1);
    }

    throw new Error('Decision response is not valid JSON');
  }

  private normalizeDecision(value: unknown): 'attend' | 'reschedule' | null {
    if (typeof value !== 'string') return null;
    const normalized = value.toLowerCase().trim();

    if (normalized === 'attend' || normalized === 'approve' || normalized === 'keep') {
      return 'attend';
    }

    if (
      normalized === 'reschedule' ||
      normalized === 'reassign' ||
      normalized === 'reprogram' ||
      normalized === 'reprogramar'
    ) {
      return 'reschedule';
    }

    return null;
  }

  private normalizeConfidence(value: unknown): 'high' | 'medium' | 'low' {
    if (value === 'high' || value === 'medium' || value === 'low') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.toLowerCase().trim();
      if (normalized === 'alta' || normalized === 'high') return 'high';
      if (normalized === 'media' || normalized === 'medium') return 'medium';
      if (normalized === 'baja' || normalized === 'low') return 'low';
    }

    return 'medium';
  }
}
