import { MedicalAppointment } from '../../domain/entities/MedicalAppointment';
import { AppointmentStatus } from '../../domain/enums/AppointmentStatus';

export class MockAppointmentStore {
  private static readonly BALANCED_ARRIVAL_OFFSETS: number[] = [
    -22, // Muy temprano
    -12, // Temprano recomendado (~10 min antes)
    -9,  // Temprano moderado
    -5,  // Poco antes
    -2,  // Casi puntual (antes)
    0,   // Puntual
    6,   // Levemente tarde
    12,  // Tarde con revisión
    18,  // Tarde con revisión
    32,  // Fuera de ventana
    52,  // Fuera de ventana extrema
  ];

  private readonly appointments: MedicalAppointment[] = (() => {
    const today = new Date();
    today.setSeconds(0, 0);

    const specialties = [
      { specialty: 'Medicina General', doctorName: 'Pedro Soto' },
      { specialty: 'Pediatría', doctorName: 'Camila Torres' },
      { specialty: 'Odontología', doctorName: 'Roberto Mora' },
      { specialty: 'Cardiología', doctorName: 'Daniel Porras' },
      { specialty: 'Dermatología', doctorName: 'Valentina Castro' },
      { specialty: 'Neurología', doctorName: 'Javier Campos' },
      { specialty: 'Ginecología', doctorName: 'Mariana Ureña' },
      { specialty: 'Oftalmología', doctorName: 'Rafael Acuña' },
      { specialty: 'Traumatología', doctorName: 'Natalia Pineda' },
      { specialty: 'Toma de laboratorios', doctorName: '' },
      { specialty: 'Toma de estudios especiales', doctorName: '' },
    ];

    const firstNames = [
      'Laura',
      'Sofia',
      'Mario',
      'Ana',
      'Luis',
      'Paula',
      'Hector',
      'Elena',
      'Diego',
      'Carla',
      'Andrés',
      'Mónica',
      'Rubén',
      'Tamara',
      'José',
      'Mariela',
      'Kevin',
      'Daniela',
      'Ignacio',
      'Lucía',
      'Fabián',
      'Noelia',
      'Pablo',
      'Irene',
    ];

    const lastNames = [
      'Rios',
      'Herrera',
      'Vega',
      'Solis',
      'Mena',
      'Naranjo',
      'Ruiz',
      'Quesada',
      'Salazar',
      'Mora',
      'Campos',
      'Porras',
      'Acuña',
      'Pineda',
      'Castro',
      'Benavides',
      'Arias',
      'Sánchez',
      'López',
      'Jiménez',
      'Cordero',
      'Vargas',
      'Rojas',
      'Madrigal',
    ];

    const start = new Date(today);
    start.setMinutes(Math.floor(today.getMinutes() / 30) * 30, 0, 0);
    start.setHours(start.getHours() - 2);

    const now = new Date();
    const appointments: MedicalAppointment[] = [];
    let appointmentId = 1;

    for (let slotIndex = 0; slotIndex < 24; slotIndex += 1) {
      const scheduledAt = this.offset(start, slotIndex * 30);
      const endsAt = this.offset(scheduledAt, 30);

      for (let specialtyIndex = 0; specialtyIndex < specialties.length; specialtyIndex += 1) {
        const specialtyConfig = specialties[specialtyIndex];
        const nameIndex = slotIndex * specialties.length + specialtyIndex;
        const patientName = `${firstNames[nameIndex % firstNames.length]} ${lastNames[nameIndex % lastNames.length]}`;

        const patternSeed = slotIndex * 17 + specialtyIndex * 23 + nameIndex;
        const arrivalOffsetMinutes = this.computeArrivalOffsetMinutes(slotIndex, specialtyIndex);
        const simulatedArrivalAt = this.offset(scheduledAt, arrivalOffsetMinutes);

        let status = AppointmentStatus.Active;
        let checkedInAt: Date | null = null;
        let vitalSignsTakenAt: Date | null = null;
        let lateArrivalApproved = false;
        let rescheduledTo: Date | null = null;

        // Llegar después de la hora de cita (offset > 0) ya es tarde; con tolerancia de 10 min.
        const isLateSlot = arrivalOffsetMinutes > 0 && arrivalOffsetMinutes <= 30;
        const isAfterWindow = arrivalOffsetMinutes > 30;

        const lateArrivalOutcome = isAfterWindow
          ? (patternSeed % 2 === 0 ? 'reschedule' : 'cancel')
          : isLateSlot && patternSeed % 3 === 0
            ? 'reschedule'
            : 'attend';
        lateArrivalApproved = isLateSlot && lateArrivalOutcome === 'attend';

        appointments.push({
          id: `${appointmentId++}`,
          patientName,
          doctorName: specialtyConfig.doctorName,
          specialty: specialtyConfig.specialty,
          scheduledAt,
          endsAt,
          simulatedArrivalAt,
          lateArrivalOutcome,
          lateArrivalApproved,
          checkedInAt,
          vitalSignsTakenAt,
          rescheduledTo,
          status,
        });
      }
    }

    return appointments;
  })();

  getTodayTrackedAppointments(): MedicalAppointment[] {
    this.autoClosePastAppointments();

    return this.appointments.filter((appointment) => {
      return (
        appointment.status !== AppointmentStatus.Completed &&
        appointment.status !== AppointmentStatus.Cancelled
      );
    });
  }

  private autoClosePastAppointments(): void {
    const now = new Date();

    for (const appointment of this.appointments) {
      if (appointment.endsAt >= now) continue;

      const isStillOpen =
        appointment.status === AppointmentStatus.Active ||
        appointment.status === AppointmentStatus.SecretaryReview ||
        appointment.status === AppointmentStatus.WaitingVitalSigns ||
        appointment.status === AppointmentStatus.ReadyForAppointment ||
        appointment.status === AppointmentStatus.Started;

      if (!isStillOpen) continue;

      const seed = Number.parseInt(appointment.id, 10) || 0;
      const roll = (seed % 10) / 10;

      if (roll < 0.6) {
        // Most past appointments are assumed attended/completed.
        if (!appointment.checkedInAt) {
          appointment.checkedInAt = this.offset(appointment.scheduledAt, 2);
        }
        if (!appointment.vitalSignsTakenAt) {
          appointment.vitalSignsTakenAt = this.offset(appointment.scheduledAt, 10);
        }
        appointment.status = AppointmentStatus.Completed;
        continue;
      }

      if (roll < 0.8) {
        // Some patients do not show up.
        appointment.status = AppointmentStatus.Cancelled;
        continue;
      }

      // Remaining appointments are considered rescheduled.
      appointment.rescheduledTo = this.offset(now, 120);
      appointment.status = AppointmentStatus.Rescheduled;
    }
  }

  markAsSecretaryReview(appointmentId: string): void {
    const appointment = this.findById(appointmentId);
    if (!appointment) return;

    appointment.status = AppointmentStatus.SecretaryReview;
  }

  markAsWaitingVitalSigns(
    appointmentId: string,
    checkedInAt: Date,
    lateArrivalApproved: boolean,
  ): void {
    const appointment = this.findById(appointmentId);
    if (!appointment) return;

    appointment.checkedInAt = checkedInAt;
    appointment.lateArrivalApproved = lateArrivalApproved;
    appointment.status = AppointmentStatus.WaitingVitalSigns;
  }

  markAsReadyForAppointment(appointmentId: string, vitalSignsTakenAt: Date): void {
    const appointment = this.findById(appointmentId);
    if (!appointment) return;

    appointment.vitalSignsTakenAt = vitalSignsTakenAt;
    appointment.status = AppointmentStatus.ReadyForAppointment;
  }

  markAsStarted(appointmentId: string): void {
    const appointment = this.findById(appointmentId);
    if (!appointment) return;

    appointment.status = AppointmentStatus.Started;
  }

  markAsRescheduled(appointmentId: string, rescheduledTo: Date): void {
    const appointment = this.findById(appointmentId);
    if (!appointment) return;

    appointment.rescheduledTo = rescheduledTo;
    appointment.status = AppointmentStatus.Rescheduled;
  }

  markAsCancelled(appointmentId: string): void {
    const appointment = this.findById(appointmentId);
    if (!appointment) return;

    appointment.status = AppointmentStatus.Cancelled;
  }

  private findById(appointmentId: string): MedicalAppointment | undefined {
    return this.appointments.find((appointment) => appointment.id === appointmentId);
  }

  private offset(base: Date, minutes: number): Date {
    const d = new Date(base);
    d.setMinutes(d.getMinutes() + minutes);
    return d;
  }

  private computeArrivalOffsetMinutes(slotIndex: number, specialtyIndex: number): number {
    // En cada ciclo horario se rota una matriz de casos para cubrir todo el flujo operativo.
    // Esto garantiza casos tempranos, puntuales, tardíos y fuera de ventana en todas las especialidades.
    const caseIndex =
      (slotIndex + specialtyIndex) % MockAppointmentStore.BALANCED_ARRIVAL_OFFSETS.length;
    return MockAppointmentStore.BALANCED_ARRIVAL_OFFSETS[caseIndex];
  }
}
