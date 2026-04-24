import { IAlertNotifier } from '../../domain/ports/IAlertNotifier';
import { MedicalAppointment } from '../../domain/entities/MedicalAppointment';

const SEPARATOR = '─'.repeat(55);

export class ConsoleAlertNotifier implements IAlertNotifier {
  notifyVitalSignsAlert(appointment: MedicalAppointment): void {
    const range = this.formatRange(appointment.scheduledAt, appointment.endsAt);
    const preparationArea = this.getPreparationArea(appointment.specialty);
    const doctor = this.doctorDisplayName(appointment.doctorName);

    console.log('\n🔔 ALERTA — PREPARACION PREVIA');
    console.log(SEPARATOR);
    console.log(`  Paciente  : ${appointment.patientName}`);
    console.log(`  Médico    : ${doctor}`);
    console.log(`  Esp.      : ${appointment.specialty}`);
    console.log(`  Horario   : ${range}`);
    console.log(`  ⚠️  Por favor, pasar a ${preparationArea}`);
    console.log(`${SEPARATOR}\n`);
  }

  notifyAppointmentStarted(appointment: MedicalAppointment): void {
    const range = this.formatRange(appointment.scheduledAt, appointment.endsAt);
    const doctor = this.doctorDisplayName(appointment.doctorName);
    const directService = this.isDirectServiceSpecialty(appointment.specialty);

    console.log('\n✅ CITA INICIADA');
    console.log(SEPARATOR);
    console.log(`  Paciente  : ${appointment.patientName}`);
    console.log(`  Médico    : ${doctor}`);
    console.log(`  Esp.      : ${appointment.specialty}`);
    console.log(`  Horario   : ${range}`);
    console.log(
      directService
        ? '  Estado actualizado → Completada'
        : '  Estado actualizado → Iniciada',
    );
    console.log(`${SEPARATOR}\n`);
  }

  private formatRange(start: Date, end: Date): string {
    const fmt = (d: Date) => d.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });
    return `${fmt(start)} – ${fmt(end)}`;
  }

  private getPreparationArea(specialty: string): string {
    const normalized = specialty.trim().toLowerCase();
    if (normalized === 'toma de laboratorios') return 'toma de laboratorios';
    if (normalized === 'toma de estudios especiales') return 'toma de estudios especiales';
    return 'toma de signos vitales';
  }

  private doctorDisplayName(doctorName: string): string {
    const normalized = doctorName.trim();
    return normalized ? `Dr. ${normalized}` : 'No asignado';
  }

  private isDirectServiceSpecialty(specialty: string): boolean {
    const normalized = specialty.trim().toLowerCase();
    return normalized === 'toma de laboratorios' || normalized === 'toma de estudios especiales';
  }
}