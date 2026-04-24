export interface IAppointmentUpdater {
  markAsSecretaryReview(appointmentId: string): Promise<void>;
  markAsWaitingVitalSigns(
    appointmentId: string,
    checkedInAt: Date,
    lateArrivalApproved?: boolean,
  ): Promise<void>;
  markAsReadyForAppointment(appointmentId: string, vitalSignsTakenAt: Date): Promise<void>;
  markAsRescheduled(appointmentId: string, rescheduledTo: Date): Promise<void>;
  markAsCancelled(appointmentId: string): Promise<void>;
  markAsStarted(appointmentId: string): Promise<void>;
  markAsCompleted(appointmentId: string): Promise<void>;
}