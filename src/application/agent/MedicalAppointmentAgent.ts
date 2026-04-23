import cron from 'node-cron';
import { FetchTodayAppointments } from '../use-cases/FetchTodayAppointments';
import { GenerateAppointmentRecommendations } from '../use-cases/GenerateAppointmentRecommendations';
import { ProcessPatientArrival } from '../use-cases/ProcessPatientArrival';
import { StartAppointment } from '../use-cases/StartAppointment';
import { ILogger } from '../../domain/ports/ILogger';
import { MedicalAppointment } from '../../domain/entities/MedicalAppointment';

const FETCH_INTERVAL_CRON = '*/10 * * * *';
const CHECK_INTERVAL_CRON = '* * * * *';

export class MedicalAppointmentAgent {
  private todayAppointments: MedicalAppointment[] = [];
  private readonly recommendedAppointments = new Set<string>();
  private readonly startedAppointments = new Set<string>();
  private isChecking = false;
  private lastKnownDay = new Date().getDate();

  constructor(
    private readonly fetchTodayAppointments: FetchTodayAppointments,
    private readonly generateAppointmentRecommendations: GenerateAppointmentRecommendations,
    private readonly processPatientArrival: ProcessPatientArrival,
    private readonly startAppointment: StartAppointment,
    private readonly logger: ILogger,
  ) {}

  start(): void {
    this.logger.log('AGENT_START', 'Agente de consultas médicas iniciado');

    this.refreshAppointments();

    cron.schedule(FETCH_INTERVAL_CRON, () => {
      this.refreshAppointments().catch((err: unknown) => {
        this.logger.log('FETCH_ERROR', `Error al actualizar citas: ${err}`);
      });
    });

    cron.schedule(CHECK_INTERVAL_CRON, () => {
      this.checkAppointments().catch((err: unknown) => {
        this.logger.log('CHECK_ERROR', `Error al revisar citas: ${err}`);
      });
    });
  }

  private resetDailyStateIfNeeded(): void {
    const today = new Date().getDate();
    if (today !== this.lastKnownDay) {
      this.recommendedAppointments.clear();
      this.startedAppointments.clear();
      this.lastKnownDay = today;
      this.logger.log('DAILY_RESET', 'Estado diario reiniciado');
    }
  }

  private async refreshAppointments(): Promise<void> {
    this.resetDailyStateIfNeeded();
    this.todayAppointments = await this.fetchTodayAppointments.execute();
  }

  private async checkAppointments(): Promise<void> {
    if (this.isChecking) return;
    this.isChecking = true;
    try {
      for (const appointment of this.todayAppointments) {
        await this.processPatientArrival.execute(appointment, this.todayAppointments);
        await this.startAppointment.execute(appointment, this.startedAppointments);
      }

      await this.generateAppointmentRecommendations.execute(
        this.todayAppointments,
        this.recommendedAppointments,
      );
    } finally {
      this.isChecking = false;
    }
  }
}