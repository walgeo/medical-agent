import { IAppointmentService } from '../../domain/ports/IAppointmentService';
import { MedicalAppointment } from '../../domain/entities/MedicalAppointment';
import { MockAppointmentStore } from './MockAppointmentStore';

export class MockAppointmentService implements IAppointmentService {
  constructor(private readonly store: MockAppointmentStore) {}

  async getTodayActiveAppointments(): Promise<MedicalAppointment[]> {
    return this.store.getTodayTrackedAppointments();
  }

  async getTodayTrackedAppointments(): Promise<MedicalAppointment[]> {
    return this.store.getTodayTrackedAppointments();
  }
}