export type RecommendationPriority = 'alta' | 'media' | 'baja';

export type RecommendationType =
  | 'confirm_arrival'
  | 'prepare_room'
  | 'reschedule_candidate'
  | 'follow_up';

export interface AppointmentRecommendation {
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
  | 'appointment_recommendation';

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
  recommendation?: AppointmentRecommendation;
}

type EventHandler = (event: AgentEvent) => void;

interface EventSourceLike {
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
}

export class AgentEventsClient {
  private source: EventSourceLike | null = null;

  constructor(private readonly url: string) {}

  connect(): void {
    const EventSourceCtor = (globalThis as { EventSource?: new (url: string) => EventSourceLike })
      .EventSource;

    if (!EventSourceCtor) {
      throw new Error('EventSource no esta disponible en este entorno.');
    }

    this.source = new EventSourceCtor(this.url);
  }

  on(type: AgentEventType, handler: EventHandler): void {
    if (!this.source) {
      throw new Error('Debe llamar connect() antes de registrar handlers.');
    }

    this.source.addEventListener(type, (event) => {
      const payload = JSON.parse(event.data) as AgentEvent;
      handler(payload);
    });
  }

  disconnect(): void {
    this.source?.close();
    this.source = null;
  }
}
