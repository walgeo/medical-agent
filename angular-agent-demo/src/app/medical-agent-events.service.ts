import { Injectable, NgZone } from '@angular/core';
import { Observable } from 'rxjs';

export type RecommendationPriority = 'alta' | 'media' | 'baja';

export type RecommendationType =
  | 'confirm_arrival'
  | 'prepare_room'
  | 'reschedule_candidate'
  | 'follow_up';

export type ChatResponseRoute = 'tool' | 'llm_premium' | 'llm_local' | 'fallback' | 'learned';

export interface ChatResponse {
  response: string;
  isHtml: boolean;
  confidence?: number;
  route?: ChatResponseRoute;
  tool?: string;
  adapted?: boolean;
}

export interface AppointmentRecommendation {
  source?: 'llm' | 'fallback';
  priority: RecommendationPriority;
  type: RecommendationType;
  rationale: string;
  actionText: string;
  requiresHumanConfirmation: boolean;
  confirmationStatus?: 'not_required' | 'pending' | 'confirmed';
}

export type AgentEventType =
  | 'patient_arrived'
  | 'secretary_review'
  | 'pre_appointment_alert'
  | 'patient_call_to_doctor'
  | 'vital_signs_completed'
  | 'appointment_rescheduled'
  | 'appointment_started'
  | 'appointment_recommendation'
  | 'agent_thinking'
  | 'agent_decision';

export interface AgentEvent {
  version: 1;
  type: AgentEventType;
  occurredAt: string;
  appointmentId: string;
  patientName: string;
  doctorName: string;
  specialty: string;
  scheduledAt: string;
  endsAt: string;
  actionText: string;
  agentReasoning?: string;
  decisionSource?: 'llm' | 'heuristic';
  decisionConfidence?: 'high' | 'medium' | 'low';
  recommendation?: AppointmentRecommendation;
}

export type ConnectionStatus = 'conectando' | 'conectado' | 'desconectado' | 'reconectando';

export interface RecommendationMetrics {
  totalGenerated: number;
  totalAccepted: number;
  totalIgnored: number;
  totalFalseAlarm: number;
}

export interface TrackedAppointment {
  id: string;
  patientName: string;
  doctorName: string;
  specialty: string;
  scheduledAt: string;
  endsAt: string;
  status: string;
  checkedInAt: string | null;
  vitalSignsTakenAt: string | null;
  rescheduledTo: string | null;
}

export interface UiConfig {
  mainAlertWindowMs: number;
  overlayWarningTtlMs: number;
  overlayInfoTtlMs: number;
}

@Injectable({ providedIn: 'root' })
export class MedicalAgentEventsService {
  private readonly apiBaseUrl = (window as any).__API_BASE_URL__ ?? 'http://localhost:7071';
  private readonly url = `${this.apiBaseUrl}/events`;
  private readonly MAX_RETRIES = 10;
  private readonly RETRY_DELAY_MS = 5000;

  constructor(private readonly ngZone: NgZone) {}

  // Emite eventos y reconecta automáticamente ante caídas del agente.
  streamWithReconnect(
    onStatus: (status: ConnectionStatus, attempt: number) => void,
  ): Observable<AgentEvent> {
    return new Observable<AgentEvent>((subscriber) => {
      let attempt = 0;
      let source: EventSource | null = null;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      let destroyed = false;

      const connect = (): void => {
        if (destroyed) return;

        onStatus(attempt === 0 ? 'conectando' : 'reconectando', attempt);
        source = new EventSource(this.url);

        const handleMessage = (event: MessageEvent): void => {
          this.ngZone.run(() => {
            attempt = 0;
            onStatus('conectado', 0);
            try {
              subscriber.next(JSON.parse(event.data) as AgentEvent);
            } catch (err) {
              subscriber.error(err);
            }
          });
        };

        source.addEventListener('pre_appointment_alert', handleMessage as EventListener);
        source.addEventListener('patient_arrived', handleMessage as EventListener);
        source.addEventListener('secretary_review', handleMessage as EventListener);
        source.addEventListener('vital_signs_completed', handleMessage as EventListener);
        source.addEventListener('patient_call_to_doctor', handleMessage as EventListener);
        source.addEventListener('appointment_rescheduled', handleMessage as EventListener);
        source.addEventListener('appointment_started', handleMessage as EventListener);
        source.addEventListener('appointment_recommendation', handleMessage as EventListener);
        source.addEventListener('agent_thinking', handleMessage as EventListener);
        source.addEventListener('agent_decision', handleMessage as EventListener);

        source.onerror = (): void => {
          source?.close();
          source = null;
          this.ngZone.run(() => {
            if (destroyed) return;
            attempt++;
            if (attempt > this.MAX_RETRIES) {
              onStatus('desconectado', attempt);
              subscriber.error(new Error('Max reintentos alcanzados'));
              return;
            }
            onStatus('reconectando', attempt);
            retryTimer = setTimeout(connect, this.RETRY_DELAY_MS);
          });
        };
      };

      connect();

      return () => {
        destroyed = true;
        if (retryTimer) clearTimeout(retryTimer);
        source?.close();
      };
    });
  }

  async getPushPublicKey(): Promise<{ enabled: boolean; publicKey: string }> {
    const response = await fetch(`${this.apiBaseUrl}/push/public-key`);
    if (!response.ok) {
      throw new Error(`No se pudo obtener llave publica push. status=${response.status}`);
    }
    return (await response.json()) as { enabled: boolean; publicKey: string };
  }

  async registerPushSubscription(subscription: PushSubscription): Promise<void> {
    const response = await fetch(`${this.apiBaseUrl}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription),
    });

    if (!response.ok) {
      throw new Error(`No se pudo registrar la suscripcion push. status=${response.status}`);
    }
  }

  async unregisterPushSubscription(subscription: PushSubscription): Promise<void> {
    await fetch(`${this.apiBaseUrl}/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
  }

  async confirmRecommendation(appointmentId: string): Promise<void> {
    const response = await fetch(`${this.apiBaseUrl}/recommendations/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appointmentId }),
    });

    if (!response.ok) {
      throw new Error(`No se pudo confirmar recomendacion. status=${response.status}`);
    }
  }

  async sendRecommendationFeedback(
    appointmentId: string,
    outcome: 'accepted' | 'ignored' | 'false_alarm',
  ): Promise<void> {
    const response = await fetch(`${this.apiBaseUrl}/recommendations/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appointmentId, outcome }),
    });

    if (!response.ok) {
      throw new Error(`No se pudo enviar feedback. status=${response.status}`);
    }
  }

  async getRecommendationMetrics(): Promise<RecommendationMetrics> {
    const response = await fetch(`${this.apiBaseUrl}/recommendations/metrics`);
    if (!response.ok) {
      throw new Error(`No se pudieron obtener metricas. status=${response.status}`);
    }

    return (await response.json()) as RecommendationMetrics;
  }

  async getTrackedAppointments(): Promise<TrackedAppointment[]> {
    const response = await fetch(`${this.apiBaseUrl}/appointments/tracking`);
    if (!response.ok) {
      throw new Error(`No se pudieron obtener citas de seguimiento. status=${response.status}`);
    }

    return (await response.json()) as TrackedAppointment[];
  }

  async completeVitalSigns(appointmentId: string): Promise<void> {
    const response = await fetch(`${this.apiBaseUrl}/appointments/complete-vital-signs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-staff-role': 'nurse',
      },
      body: JSON.stringify({ appointmentId }),
    });

    if (!response.ok) {
      throw new Error(`No se pudo marcar signos vitales como atendidos. status=${response.status}`);
    }
  }

  async triggerEarlyVitalSigns(appointmentId: string): Promise<void> {
    const response = await fetch(`${this.apiBaseUrl}/appointments/trigger-early-vital-signs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-staff-role': 'nurse',
      },
      body: JSON.stringify({ appointmentId }),
    });

    if (!response.ok) {
      throw new Error(`No se pudo iniciar signos vitales. status=${response.status}`);
    }
  }

  async sendChatMessage(
    message: string,
    history: Array<{ role: string; content: string }>,
  ): Promise<ChatResponse> {
    const response = await fetch(`${this.apiBaseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
    });

    if (!response.ok) {
      throw new Error(`Error en el chat. status=${response.status}`);
    }

    return (await response.json()) as ChatResponse;
  }

  async getUiConfig(): Promise<UiConfig> {
    const response = await fetch(`${this.apiBaseUrl}/ui/config`);
    if (!response.ok) {
      throw new Error(`No se pudo obtener configuracion UI. status=${response.status}`);
    }

    return (await response.json()) as UiConfig;
  }

  async synthesizeSpeech(text: string): Promise<ArrayBuffer> {
    const response = await fetch(`${this.apiBaseUrl}/tts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`No se pudo sintetizar audio en servidor. status=${response.status}`);
    }

    return await response.arrayBuffer();
  }
}