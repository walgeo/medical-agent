import { MedicalAppointment } from '../entities/MedicalAppointment';

export interface IAlertNotifier {
  notifyVitalSignsAlert(appointment: MedicalAppointment): void;
  notifyAppointmentStarted(appointment: MedicalAppointment): void;
}