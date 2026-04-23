import { AppointmentRecommendation } from '../recommendations/AppointmentRecommendation';

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
