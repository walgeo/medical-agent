import { IAppointmentUpdater } from '../../domain/ports/IAppointmentUpdater';
import { MockAppointmentStore } from './MockAppointmentStore';

export class MockAppointmentUpdater implements IAppointmentUpdater {
  constructor(private readonly store: MockAppointmentStore) {}

  async markAsSecretaryReview(appointmentId: string): Promise<void> {
    await this.delay(100);
    this.store.markAsSecretaryReview(appointmentId);
    console.log(
      `[MOCK API] PATCH /appointments/${appointmentId} → { status: "En revision de secretaria" } ✓`,
    );
  }

  async markAsWaitingVitalSigns(
    appointmentId: string,
    checkedInAt: Date,
    lateArrivalApproved = false,
  ): Promise<void> {
    await this.delay(150);
    this.store.markAsWaitingVitalSigns(appointmentId, checkedInAt, lateArrivalApproved);
    console.log(
      `[MOCK API] PATCH /appointments/${appointmentId} → { status: "En espera de signos vitales", lateArrivalApproved: ${lateArrivalApproved} } ✓`,
    );
  }

  async markAsReadyForAppointment(
    appointmentId: string,
    vitalSignsTakenAt: Date,
  ): Promise<void> {
    await this.delay(150);
    this.store.markAsReadyForAppointment(appointmentId, vitalSignsTakenAt);
    console.log(
      `[MOCK API] PATCH /appointments/${appointmentId} → { status: "Lista para consulta" } ✓`,
    );
  }

  async markAsStarted(appointmentId: string): Promise<void> {
    await this.delay(200);
    this.store.markAsStarted(appointmentId);
    console.log(`[MOCK API] PATCH /appointments/${appointmentId} → { status: "Iniciada" } ✓`);
  }

  async markAsRescheduled(appointmentId: string, rescheduledTo: Date): Promise<void> {
    await this.delay(120);
    this.store.markAsRescheduled(appointmentId, rescheduledTo);
    console.log(
      `[MOCK API] PATCH /appointments/${appointmentId} → { status: "Reagendada", rescheduledTo: "${rescheduledTo.toISOString()}" } ✓`,
    );
  }

  async markAsCancelled(appointmentId: string): Promise<void> {
    await this.delay(100);
    this.store.markAsCancelled(appointmentId);
    console.log(`[MOCK API] PATCH /appointments/${appointmentId} → { status: "Cancelada" } ✓`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}