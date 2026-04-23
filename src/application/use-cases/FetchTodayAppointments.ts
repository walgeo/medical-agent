import { MedicalAppointment } from '../../domain/entities/MedicalAppointment';
import { IAppointmentService } from '../../domain/ports/IAppointmentService';
import { ILogger } from '../../domain/ports/ILogger';

export class FetchTodayAppointments {
  constructor(
    private readonly appointmentService: IAppointmentService,
    private readonly logger: ILogger,
  ) {}

  async execute(): Promise<MedicalAppointment[]> {
    const appointments = await this.appointmentService.getTodayActiveAppointments();

    this.logger.log(
      'FETCH_APPOINTMENTS',
      `Se encontraron ${appointments.length} cita(s) activa(s) para hoy`,
    );

    return appointments;
  }
}