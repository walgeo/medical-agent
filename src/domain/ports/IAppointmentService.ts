import { MedicalAppointment } from '../entities/MedicalAppointment';

export interface IAppointmentService {
  getTodayActiveAppointments(): Promise<MedicalAppointment[]>;
  getTodayTrackedAppointments(): Promise<MedicalAppointment[]>;
}