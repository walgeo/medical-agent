import { AppointmentStatus } from '../enums/AppointmentStatus';

export interface MedicalAppointment {
  id: string;
  patientName: string;
  doctorName: string;
  specialty: string;
  scheduledAt: Date;
  endsAt: Date;
  simulatedArrivalAt?: Date | null;
  lateArrivalOutcome?: 'attend' | 'reschedule' | 'cancel';
  lateArrivalApproved?: boolean;
  checkedInAt?: Date | null;
  vitalSignsTakenAt?: Date | null;
  rescheduledTo?: Date | null;
  status: AppointmentStatus;
}