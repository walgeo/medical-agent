import { MedicalAppointment } from '../../domain/entities/MedicalAppointment';
import { AppointmentStatus } from '../../domain/enums/AppointmentStatus';
import { IRecommendationEngine } from '../../domain/ports/IRecommendationEngine';
import { AppointmentRecommendation } from '../../domain/recommendations/AppointmentRecommendation';
import { ILogger } from '../../domain/ports/ILogger';

interface LlmResponse {
  recommendation: AppointmentRecommendation | null;
}

type LlmProvider = 'openai' | 'openrouter' | 'custom';

export class LlmRecommendationEngine implements IRecommendationEngine {
  private readonly provider: LlmProvider;
  private readonly resolvedApiUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly logger: ILogger,
    private readonly apiUrl = process.env.RECOMMENDATION_LLM_URL ?? '',
    private readonly apiKey = process.env.RECOMMENDATION_LLM_API_KEY ?? '',
    private readonly model = process.env.RECOMMENDATION_LLM_MODEL ?? 'gpt-4o-mini',
  ) {
    this.provider = this.readProvider();
    this.resolvedApiUrl = this.resolveApiUrl();
    this.requestTimeoutMs = this.readTimeoutMs();
  }

  async recommend(
    appointment: MedicalAppointment,
    context: MedicalAppointment[],
  ): Promise<AppointmentRecommendation | null> {
    if (!this.resolvedApiUrl) return null;
    if (appointment.status !== AppointmentStatus.Active) return null;

    // Si falla o tarda, retorna null para activar fallback heuristico.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    const prompt = this.buildPrompt(appointment, context);

    const requestBody = {
      model: this.model,
      messages: [
        {
          role: 'system',
          content:
            'Eres un asistente de triaje de agenda medica. Responde solo JSON con recommendation o null.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 220,
      stream: false,
      ...(this.provider !== 'custom' && {
        response_format: { type: 'json_object' },
      }),
    };

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(this.provider === 'openrouter'
          ? {
              'HTTP-Referer': process.env.RECOMMENDATION_LLM_APP_URL ?? 'http://localhost',
              'X-Title': process.env.RECOMMENDATION_LLM_APP_NAME ?? 'medical-agent',
            }
          : {}),
      };
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(this.resolvedApiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.log('LLM_RECOMMENDATION_HTTP_ERROR', `status=${response.status}`);
        clearTimeout(timeout);
        return null;
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data.choices?.[0]?.message?.content;
      clearTimeout(timeout);
      if (!content) return null;

      const parsed = this.parseLlmResponse(content);
      if (!parsed || !parsed.recommendation) return null;

      return this.normalizeRecommendation(parsed.recommendation);
    } catch (error: unknown) {
      clearTimeout(timeout);
      const detail = error instanceof Error ? error.message : 'unknown error';
      this.logger.log('LLM_RECOMMENDATION_ERROR', detail);
      return null;
    }
  }

  private readProvider(): LlmProvider {
    const raw = (process.env.RECOMMENDATION_LLM_PROVIDER ?? 'openai').toLowerCase();
    if (raw === 'openai' || raw === 'openrouter' || raw === 'custom') {
      return raw;
    }

    this.logger.log('LLM_PROVIDER_INVALID', `Proveedor invalido '${raw}', usando 'openai'.`);
    return 'openai';
  }

  private resolveApiUrl(): string {
    if (this.apiUrl) return this.apiUrl;

    if (this.provider === 'openrouter') {
      return 'https://openrouter.ai/api/v1/chat/completions';
    }

    if (this.provider === 'custom') {
      return '';
    }

    return 'https://api.openai.com/v1/chat/completions';
  }

  private readTimeoutMs(): number {
    const raw = process.env.LLM_RECOMMENDATION_TIMEOUT_MS ?? process.env.RECOMMENDATION_LLM_TIMEOUT_MS;
    if (!raw) return 12000;

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      this.logger.log(
        'LLM_TIMEOUT_INVALID',
        `Timeout invalido '${raw}', usando 12000ms.`,
      );
      return 12000;
    }

    return Math.round(parsed);
  }

  private parseLlmResponse(content: string): LlmResponse | null {
    const trimmed = content.trim();
    if (!trimmed || trimmed === 'null') return null;

    try {
      return JSON.parse(trimmed) as LlmResponse;
    } catch {
      const first = trimmed.indexOf('{');
      const last = trimmed.lastIndexOf('}');
      if (first < 0 || last <= first) return null;

      try {
        const candidate = trimmed.slice(first, last + 1);
        return JSON.parse(candidate) as LlmResponse;
      } catch {
        this.logger.log('LLM_RECOMMENDATION_PARSE_ERROR', 'Respuesta no parseable a JSON.');
        return null;
      }
    }
  }

  private buildPrompt(appointment: MedicalAppointment, context: MedicalAppointment[]): string {
    return JSON.stringify({
      appointment: {
        id: appointment.id,
        patientName: appointment.patientName,
        doctorName: appointment.doctorName,
        specialty: appointment.specialty,
        scheduledAt: appointment.scheduledAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        status: appointment.status,
      },
      context: context.map((item) => ({
        id: item.id,
        doctorName: item.doctorName,
        scheduledAt: item.scheduledAt.toISOString(),
        endsAt: item.endsAt.toISOString(),
        status: item.status,
      })),
      schema: {
        recommendation: {
          priority: "'alta'|'media'|'baja'",
          type: "'confirm_arrival'|'prepare_room'|'reschedule_candidate'|'follow_up'",
          rationale: 'string',
          actionText: 'string',
          requiresHumanConfirmation: 'boolean',
        },
      },
    });
  }

  private normalizeRecommendation(
    recommendation: AppointmentRecommendation,
  ): AppointmentRecommendation {
    return {
      source: 'llm',
      ...recommendation,
      requiresHumanConfirmation:
        recommendation.requiresHumanConfirmation ||
        recommendation.type === 'reschedule_candidate',
    };
  }
}
