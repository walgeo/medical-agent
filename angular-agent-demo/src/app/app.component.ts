import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import {
  AgentEvent,
  AgentEventType,
  ConnectionStatus,
  MedicalAgentEventsService,
  TrackedAppointment,
  UiConfig,
  ChatResponseRoute,
} from './medical-agent-events.service';
import { ZoeLearningClient } from './zoe-learning.client';
import { ZoeResponseWithFeedbackComponent } from './zoe-response-with-feedback.component';
import { VoiceCallQueueService, VoiceCall, VoiceDiagnostics } from './voice-call-queue.service';

type Filter = 'all' | AgentEventType;
type UiAlertLevel = 'warning' | 'info';
type DashboardView = 'main' | 'nurse' | 'lab' | 'studies' | 'tracking' | 'secretary' | 'chat';

interface UiAlert {
  id: number;
  level: UiAlertLevel;
  title: string;
  message: string;
}

interface ChatMessage {
  role: 'user' | 'zoe';
  content: string;
  isHtml: boolean;
  timestamp: string;
  confidence?: number;
  route?: ChatResponseRoute;
  tool?: string;
}

interface ChatOption {
  label: string;
  prompt?: string;
  nextMenu?: 'root' | 'patients' | 'doctors' | 'status' | 'schedules';
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ZoeResponseWithFeedbackComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit, OnDestroy {
  status: ConnectionStatus = 'conectando';
  reconnectAttempts = 0;
  activeFilter: Filter = 'all';
  activeView: DashboardView = 'main';
  allEvents: AgentEvent[] = [];
  overlayAlerts: UiAlert[] = [];
  trackedAppointments: TrackedAppointment[] = [];
  notificationPermission: NotificationPermission | 'unsupported' = 'default';
  notificationStatusMessage = '';
  recommendationFeedbackByAppointment: Record<string, 'accepted' | 'ignored' | 'false_alarm'> = {};
  trackingActiveTab: string = 'Confirmada';
  appointmentStatuses: string[] = [];
  trackingSearch = '';
  trackingSortColumn: 'scheduledAt' | 'patientName' | 'doctorName' | 'specialty' | 'checkedInAt' | 'vitalSignsTakenAt' = 'scheduledAt';
  trackingSortDir: 'asc' | 'desc' = 'asc';
  trackingPage = 1;
  readonly trackingPageSize = 10;
  uiConfig: UiConfig = {
    mainAlertWindowMs: 15 * 60_000,
    overlayWarningTtlMs: 25_000,
    overlayInfoTtlMs: 12_000,
    preferBrowserTts: false,
    serverTtsEnabled: true,
  };

  // Chat Zoe
  chatMessages: ChatMessage[] = [];
  chatInput = '';
  isChatLoading = false;
  chatMode: 'guided' = 'guided';
  currentChatMenu: 'root' | 'patients' | 'doctors' | 'status' | 'schedules' = 'root';
  private chatHistory: Array<{ role: string; content: string }> = [];

  // Voice call queue
  voiceQueue: VoiceCall[] = [];
  currentVoiceCall: VoiceCall | null = null;
  isVoiceCallPlaying = false;
  voiceDiagnostics: VoiceDiagnostics = {
    voicesDetected: 0,
    selectedVoice: 'default',
    audioUnlocked: false,
    chunkedModeActive: false,
    lastFallbackReason: null,
    lastSynthesisError: null,
  };
  private voiceQueueSub?: Subscription;
  private voiceCurrentSub?: Subscription;
  private voicePlayingSub?: Subscription;
  private voiceDiagnosticsSub?: Subscription;
  private voiceCallsProcessed = new Set<string>();
  private preparationStartedByAppointment = new Set<string>();
  private doctorCallAnnouncedByAppointment = new Set<string>();
  private pendingDoctorCallByAppointment = new Map<string, AgentEvent>();

  private sub?: Subscription;
  private trackingTimer?: ReturnType<typeof setInterval>;
  private dailyCheckTimer?: ReturnType<typeof setInterval>;
  private alertIdSequence = 1;
  private pushSubscription: PushSubscription | null = null;
  private currentDayKey = this.getDayKey(new Date());
  private alertAudioContext: AudioContext | null = null;
  private alertAudioUnlocked = false;
  private readonly unlockAlertAudio = () => {
    this.alertAudioUnlocked = true;

    if (this.alertAudioContext && this.alertAudioContext.state === 'suspended') {
      void this.alertAudioContext.resume().catch(() => {
        // Evita ruido en consola cuando el navegador sigue bloqueando audio.
      });
    }

    document.removeEventListener('click', this.unlockAlertAudio);
    document.removeEventListener('keydown', this.unlockAlertAudio);
  };

  constructor(
    private readonly eventsService: MedicalAgentEventsService,
    private readonly sanitizer: DomSanitizer,
    private readonly learningClient: ZoeLearningClient,
    private readonly voiceCallQueue: VoiceCallQueueService,
  ) {}

  get filteredEvents(): AgentEvent[] {
    if (this.activeFilter === 'all') return this.allEvents;
    return this.allEvents.filter((e) => e.type === this.activeFilter);
  }

  get mainAlerts(): AgentEvent[] {
    const cutoff = Date.now() - this.uiConfig.mainAlertWindowMs;

    return this.allEvents
      .filter(
        (event) =>
          this.isMainAlertType(event.type) &&
          !this.shouldHideMainAlert(event) &&
          this.isCurrentDay(event.scheduledAt) &&
          new Date(event.occurredAt).getTime() >= cutoff,
      )
      .slice(0, 8);
  }

  get vitalSignsQueue(): TrackedAppointment[] {
    return this.trackedAppointments
      .filter(
        (appointment) =>
          appointment.status === 'En espera de signos vitales' &&
          !this.isLaboratorySpecialty(appointment.specialty) &&
          !this.isSpecialStudiesSpecialty(appointment.specialty),
      )
      .sort((a, b) => this.compareTrackedAppointments(a, b));
  }

  get laboratoryQueue(): TrackedAppointment[] {
    return this.trackedAppointments
      .filter(
        (appointment) =>
          appointment.status === 'En espera de signos vitales' &&
          this.isLaboratorySpecialty(appointment.specialty),
      )
      .sort((a, b) => this.compareTrackedAppointments(a, b));
  }

  get specialStudiesQueue(): TrackedAppointment[] {
    return this.trackedAppointments
      .filter(
        (appointment) =>
          appointment.status === 'En espera de signos vitales' &&
          this.isSpecialStudiesSpecialty(appointment.specialty),
      )
      .sort((a, b) => this.compareTrackedAppointments(a, b));
  }

  get uniqueAppointmentStatuses(): string[] {
    const statuses = new Set(this.trackedAppointments.map((a) => this.trackingStatusGroupFor(a)));
    return Array.from(statuses).sort();
  }

  private getFilteredSortedAppointments(status: string): TrackedAppointment[] {
    const search = this.trackingSearch.trim().toLowerCase();
    let list = this.trackedAppointments.filter((a) => this.trackingStatusGroupFor(a) === status);

    if (search) {
      list = list.filter((a) =>
        a.patientName.toLowerCase().includes(search) ||
        (a.doctorName ?? '').toLowerCase().includes(search) ||
        (a.specialty ?? '').toLowerCase().includes(search) ||
        this.trackingStatusLabel(a).toLowerCase().includes(search),
      );
    }

    const col = this.trackingSortColumn;
    const dir = this.trackingSortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = (a[col] ?? '') as string;
      const vb = (b[col] ?? '') as string;
      return va < vb ? -dir : va > vb ? dir : 0;
    });
  }

  getAppointmentsByStatus(status: string): TrackedAppointment[] {
    const all = this.getFilteredSortedAppointments(status);
    const start = (this.trackingPage - 1) * this.trackingPageSize;
    return all.slice(start, start + this.trackingPageSize);
  }

  getTotalByStatus(status: string): number {
    return this.getFilteredSortedAppointments(status).length;
  }

  get trackingTotalPages(): number {
    return Math.max(1, Math.ceil(this.getTotalByStatus(this.trackingActiveTab) / this.trackingPageSize));
  }

  get trackingPageRange(): number[] {
    return Array.from({ length: this.trackingTotalPages }, (_, i) => i + 1);
  }

  setTrackingPage(page: number): void {
    if (page < 1 || page > this.trackingTotalPages) return;
    this.trackingPage = page;
  }

  setTrackingTab(status: string): void {
    this.trackingActiveTab = status;
    this.trackingPage = 1;
  }

  setTrackingSort(col: typeof this.trackingSortColumn): void {
    if (this.trackingSortColumn === col) {
      this.trackingSortDir = this.trackingSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.trackingSortColumn = col;
      this.trackingSortDir = 'asc';
    }
    this.trackingPage = 1;
  }

  sortIcon(col: string): string {
    if (this.trackingSortColumn !== col) return '↕';
    return this.trackingSortDir === 'asc' ? '↑' : '↓';
  }

  // Pacientes en espera de signos vitales SIN alerta pre-cita emitida aún (llegaron temprano)
  get earlyArrivals(): TrackedAppointment[] {
    return this.trackedAppointments.filter((apt) => {
      if (apt.status !== 'En espera de signos vitales') return false;
      const hasPreAlert = this.allEvents.some(
        (e) => e.type === 'pre_appointment_alert' && e.appointmentId === apt.id,
      );
      return !hasPreAlert;
    });
  }

  safeHtml(html: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  async sendChatMessage(): Promise<void> {
    const text = this.chatInput.trim();
    if (!text || this.isChatLoading) return;

    this.chatMessages.push({
      role: 'user',
      content: text,
      isHtml: false,
      timestamp: new Date().toISOString(),
    });
    this.chatInput = '';
    this.isChatLoading = true;

    try {
      const result = await this.eventsService.sendChatMessage(text, this.chatHistory);

      this.chatHistory.push({ role: 'user', content: text });
      this.chatHistory.push({ role: 'assistant', content: result.response });
      // Keep history bounded
      if (this.chatHistory.length > 20) {
        this.chatHistory = this.chatHistory.slice(-20);
      }

      this.chatMessages.push({
        role: 'zoe',
        content: result.response,
        isHtml: result.isHtml,
        confidence: result.confidence,
        route: result.route,
        tool: result.tool,
        timestamp: new Date().toISOString(),
      });
    } catch {
      this.chatMessages.push({
        role: 'zoe',
        content: 'Lo siento, tuve un problema al procesar tu consulta. Intenta de nuevo.',
        isHtml: false,
        timestamp: new Date().toISOString(),
      });
    } finally {
      this.isChatLoading = false;
    }
  }

  async submitZoeFeedback(
    userQuery: string,
    zoeResponse: string,
    feedback: 'correct' | 'incorrect' | 'incomplete' | 'confusing',
    correction?: string,
  ): Promise<void> {
    try {
      await this.learningClient
        .submitFeedback(userQuery, zoeResponse, feedback, correction)
        .toPromise();
    } catch (error) {
      console.error('Error submitting feedback:', error);
    }
  }

  async triggerEarlyVitalSigns(appointmentId: string): Promise<void> {
    await this.eventsService.triggerEarlyVitalSigns(appointmentId);
  }

  ngOnInit(): void {
    this.resetDailyUiState();
    this.refreshNotificationPermission();
    if (this.notificationPermission === 'granted') {
      void this.enableWebPushSubscription();
    }

    void this.refreshUiConfig();
    void this.refreshTrackedAppointments().finally(() => {
      this.startEventStream();
    });

    this.trackingTimer = setInterval(() => {
      this.flushPendingDoctorCalls();
      void this.refreshTrackedAppointments();
    }, 20000);

    this.dailyCheckTimer = setInterval(() => {
      void this.handleDayRollover();
    }, 60000);

    if (typeof window !== 'undefined') {
      document.addEventListener('click', this.unlockAlertAudio);
      document.addEventListener('keydown', this.unlockAlertAudio);
    }

    // Suscribirse a cola de llamadas por voz
    this.voiceQueueSub = this.voiceCallQueue.queue.subscribe((queue) => {
      this.voiceQueue = queue;
    });
    this.voiceCurrentSub = this.voiceCallQueue.currentCall.subscribe((call) => {
      this.currentVoiceCall = call;
    });
    this.voicePlayingSub = this.voiceCallQueue.isPlaying.subscribe((playing) => {
      this.isVoiceCallPlaying = playing;
    });
    this.voiceDiagnosticsSub = this.voiceCallQueue.diagnostics.subscribe((diagnostics) => {
      this.voiceDiagnostics = diagnostics;
    });
  }

  private startEventStream(): void {
    if (this.sub) return;

    this.sub = this.eventsService
      .streamWithReconnect((status, attempt) => {
        this.status = status;
        this.reconnectAttempts = attempt;
      })
      .subscribe((event) => {
        if (!this.isCurrentDay(event.scheduledAt)) return;

        if (this.isDuplicateDoctorCallEvent(event)) return;

        this.allEvents = [event, ...this.allEvents].slice(0, 50);
        this.applyEventToTrackedAppointments(event);
        this.handleVoiceCallEvent(event);
        this.maybeEmitDoctorCallFallback(event);
        this.pushOverlayAlert(event);
        this.triggerBrowserNotification(event);
        this.playAlertSound(event);
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.voiceQueueSub?.unsubscribe();
    this.voiceCurrentSub?.unsubscribe();
    this.voicePlayingSub?.unsubscribe();
    this.voiceDiagnosticsSub?.unsubscribe();
    if (this.trackingTimer) clearInterval(this.trackingTimer);
    if (this.dailyCheckTimer) clearInterval(this.dailyCheckTimer);

    if (typeof window !== 'undefined') {
      document.removeEventListener('click', this.unlockAlertAudio);
      document.removeEventListener('keydown', this.unlockAlertAudio);
    }

    if (this.alertAudioContext) {
      void this.alertAudioContext.close().catch(() => {
        // Ignorar errores de cierre de contexto.
      });
      this.alertAudioContext = null;
    }
  }

  setFilter(filter: Filter): void {
    this.activeFilter = filter;
  }

  setView(view: DashboardView): void {
    this.activeView = view;

    if (view === 'chat') {
      this.initializeGuidedChat();
    }
  }

  get chatMenuPrompt(): string {
    switch (this.currentChatMenu) {
      case 'patients':
        return 'Pacientes: consultas clínicas accionables.';
      case 'doctors':
        return 'Médicos: carga y estado de atención.';
      case 'status':
        return 'Estado operativo del día.';
      case 'schedules':
        return 'Agenda y horarios de hoy.';
      default:
        return 'Zoe operativa: selecciona una consulta útil.';
    }
  }

  get chatOptions(): ChatOption[] {
    const menus: Record<string, ChatOption[]> = {
      root: [
        { label: '👥 Pacientes', nextMenu: 'patients' },
        { label: '👨‍⚕️ Médicos', nextMenu: 'doctors' },
        { label: '📍 Estados de citas', nextMenu: 'status' },
        { label: '🕐 Horarios / Agenda', nextMenu: 'schedules' },
        { label: '📊 Resumen del día', prompt: 'resumen de citas del día', nextMenu: 'root' },
      ],
      patients: [
        { label: 'Pacientes de hoy', prompt: 'nombres de los pacientes de hoy', nextMenu: 'patients' },
        { label: 'Pacientes por especialidad', prompt: 'pacientes por especialidad', nextMenu: 'patients' },
        { label: 'Citas por especialidad y médico', prompt: 'tabla de citas por especialidad y médico', nextMenu: 'patients' },
        { label: '⬅ Volver al menú principal', nextMenu: 'root' },
      ],
      doctors: [
        { label: 'Doctores atendiendo', prompt: 'doctores que están atendiendo', nextMenu: 'doctors' },
        { label: 'Citas por doctor', prompt: 'citas por doctor', nextMenu: 'doctors' },
        { label: 'Atendidas por doctor', prompt: 'atendidas por doctor', nextMenu: 'doctors' },
        { label: '⬅ Volver al menú principal', nextMenu: 'root' },
      ],
      status: [
        { label: 'Estado actual operativo', prompt: 'estado actual', nextMenu: 'status' },
        { label: 'Citas reagendadas', prompt: 'citas reagendadas', nextMenu: 'status' },
        { label: 'Resumen de citas del día', prompt: 'resumen de citas del día', nextMenu: 'status' },
        { label: '⬅ Volver al menú principal', nextMenu: 'root' },
      ],
      schedules: [
        { label: 'Agenda del día', prompt: 'horarios', nextMenu: 'schedules' },
        { label: 'Citas de hoy', prompt: 'citas de hoy', nextMenu: 'schedules' },
        { label: 'Tabla de citas de hoy', prompt: 'tabla de citas de hoy', nextMenu: 'schedules' },
        { label: '⬅ Volver al menú principal', nextMenu: 'root' },
      ],
    };

    return menus[this.currentChatMenu] ?? menus['root'];
  }

  async selectChatOption(option: ChatOption): Promise<void> {
    if (this.isChatLoading) return;

    if (option.nextMenu && !option.prompt) {
      this.currentChatMenu = option.nextMenu;
      return;
    }

    if (option.prompt) {
      await this.sendPredefinedChatMessage(option.label, option.prompt);
    }

    if (option.nextMenu) {
      this.currentChatMenu = option.nextMenu;
    }
  }

  private initializeGuidedChat(): void {
    if (this.chatMessages.length > 0) return;

    this.chatMessages.push({
      role: 'zoe',
      content:
        'Hola. Soy Zoe. Trabajaremos con consultas clínicas claras y resultados operativos. Selecciona una categoría:',
      isHtml: false,
      timestamp: new Date().toISOString(),
      route: 'tool',
      confidence: 0.95,
      tool: 'guided_menu',
    });
  }

  private async sendPredefinedChatMessage(displayText: string, backendPrompt: string): Promise<void> {
    this.chatMessages.push({
      role: 'user',
      content: displayText,
      isHtml: false,
      timestamp: new Date().toISOString(),
    });

    this.isChatLoading = true;

    try {
      const result = await this.eventsService.sendChatMessage(backendPrompt, this.chatHistory);

      this.chatHistory.push({ role: 'user', content: backendPrompt });
      this.chatHistory.push({ role: 'assistant', content: result.response });
      if (this.chatHistory.length > 20) {
        this.chatHistory = this.chatHistory.slice(-20);
      }

      this.chatMessages.push({
        role: 'zoe',
        content: result.response,
        isHtml: result.isHtml,
        confidence: result.confidence,
        route: result.route,
        tool: result.tool,
        timestamp: new Date().toISOString(),
      });
    } catch {
      this.chatMessages.push({
        role: 'zoe',
        content: 'No pude procesar esa opción en este momento. Intenta otra opción del menú.',
        isHtml: false,
        timestamp: new Date().toISOString(),
      });
    } finally {
      this.isChatLoading = false;
    }
  }

  async markNurseAlertAsAttended(appointmentId: string): Promise<void> {
    await this.eventsService.completeVitalSigns(appointmentId);
  }

  async handleNurseAction(appointmentId: string): Promise<void> {
    this.voiceCallQueue.registerUserGesture();

    if (this.hasPreAppointmentAlert(appointmentId)) {
      await this.markNurseAlertAsAttended(appointmentId);
      return;
    }

    await this.triggerEarlyVitalSigns(appointmentId);
  }

  async handleLabOrStudiesCall(appointmentId: string): Promise<void> {
    this.voiceCallQueue.registerUserGesture();
    await this.triggerEarlyVitalSigns(appointmentId);
  }

  markPreparationStarted(appointmentId: string): void {
    if (!this.hasPreAppointmentAlert(appointmentId)) return;
    this.preparationStartedByAppointment.add(appointmentId);
  }

  isPreparationStarted(appointmentId: string): boolean {
    return this.preparationStartedByAppointment.has(appointmentId);
  }

  async handleLabOrStudiesComplete(appointmentId: string): Promise<void> {
    this.voiceCallQueue.registerUserGesture();
    await this.markNurseAlertAsAttended(appointmentId);
    this.preparationStartedByAppointment.delete(appointmentId);
  }

  nurseActionClass(appointmentId: string): string {
    return this.hasPreAppointmentAlert(appointmentId) ? 'btn-nurse-done' : 'btn-nurse-start';
  }

  nurseActionLabel(appointmentId: string): string {
    const preparationArea = this.getPreparationAreaByAppointmentId(appointmentId);
    return this.hasPreAppointmentAlert(appointmentId)
      ? '✓ Proceso completado'
      : `▶ Iniciar ${preparationArea}`;
  }

  private getPreparationAreaByAppointmentId(appointmentId: string): string {
    const appointment = this.trackedAppointments.find((item) => item.id === appointmentId);
    return this.getPreparationAreaBySpecialty(appointment?.specialty);
  }

  getVoiceCallAreaLabel(specialty?: string): string {
    return this.getPreparationAreaBySpecialty(specialty);
  }

  private getPreparationAreaBySpecialty(specialty?: string): string {
    const normalized = (specialty ?? '').trim().toLowerCase();
    if (normalized === 'toma de laboratorios') return 'toma de laboratorios';
    if (normalized === 'toma de estudios especiales') return 'toma de estudios especiales';
    return 'toma de signos vitales';
  }

  private isLaboratorySpecialty(specialty?: string): boolean {
    return (specialty ?? '').trim().toLowerCase() === 'toma de laboratorios';
  }

  private isSpecialStudiesSpecialty(specialty?: string): boolean {
    return (specialty ?? '').trim().toLowerCase() === 'toma de estudios especiales';
  }

  trackByAppointmentId(_index: number, item: TrackedAppointment): string {
    return item.id;
  }

  getVoiceCallStatusLabel(): string {
    if (this.isVoiceCallPlaying) {
      return '📢 En reproducción';
    }
    if (this.voiceQueue.length > 0) {
      return this.voiceQueue.length + ' en cola';
    }
    return 'Completado';
  }

  hasPreAppointmentAlert(appointmentId: string): boolean {
    return this.allEvents.some(
      (event) => event.type === 'pre_appointment_alert' && event.appointmentId === appointmentId,
    );
  }

  private handleVoiceCallEvent(event: AgentEvent): void {
    // Evitar procesar el mismo evento múltiples veces
    const eventKey = `${event.type}-${event.appointmentId}-${event.occurredAt}`;
    if (this.voiceCallsProcessed.has(eventKey)) return;
    this.voiceCallsProcessed.add(eventKey);

    if (event.type === 'pre_appointment_alert') {
      if (!this.shouldTriggerVitalSignsCall(event.appointmentId)) return;

      // Llamada para toma de signos vitales
      this.voiceCallQueue.addCall(
        event.appointmentId,
        event.patientName,
        event.specialty,
        'vital_signs',
      );
    } else if (event.type === 'patient_call_to_doctor') {
      if (this.hasAssignedDoctor(event.doctorName)) {
        this.doctorCallAnnouncedByAppointment.add(event.appointmentId);
      }

      // Llamada para pasar con el médico
      this.voiceCallQueue.addCall(
        event.appointmentId,
        event.patientName,
        event.specialty,
        'doctor_call',
      );
    }
  }

  private maybeEmitDoctorCallFallback(event: AgentEvent): void {
    if (event.type === 'patient_call_to_doctor') {
      if (this.hasAssignedDoctor(event.doctorName)) {
        this.doctorCallAnnouncedByAppointment.add(event.appointmentId);
        this.pendingDoctorCallByAppointment.delete(event.appointmentId);
      }
      return;
    }

    if (event.type !== 'vital_signs_completed') return;
    if (!this.hasAssignedDoctor(event.doctorName)) return;
    if (this.doctorCallAnnouncedByAppointment.has(event.appointmentId)) return;

    const now = new Date();
    const scheduledAt = new Date(event.scheduledAt);
    const endsAt = new Date(event.endsAt);

    if (now < scheduledAt) {
      this.pendingDoctorCallByAppointment.set(event.appointmentId, event);
      return;
    }

    if (now >= endsAt) return;

    this.emitDoctorCallEvent(event);
  }

  private emitDoctorCallEvent(baseEvent: AgentEvent): void {
    if (this.doctorCallAnnouncedByAppointment.has(baseEvent.appointmentId)) return;

    const doctorCallEvent: AgentEvent = {
      ...baseEvent,
      type: 'patient_call_to_doctor',
      occurredAt: new Date().toISOString(),
      actionText: `Paciente listo para pasar con el medico. ${this.doctorDisplayName(baseEvent.doctorName)}, favor recibir al paciente.`,
    };

    this.pendingDoctorCallByAppointment.delete(baseEvent.appointmentId);
    this.doctorCallAnnouncedByAppointment.add(baseEvent.appointmentId);
    this.allEvents = [doctorCallEvent, ...this.allEvents].slice(0, 50);
    this.handleVoiceCallEvent(doctorCallEvent);
    this.pushOverlayAlert(doctorCallEvent);
    this.triggerBrowserNotification(doctorCallEvent);
    this.playAlertSound(doctorCallEvent);
  }

  private flushPendingDoctorCalls(): void {
    const now = new Date();

    for (const [appointmentId, event] of this.pendingDoctorCallByAppointment) {
      const scheduledAt = new Date(event.scheduledAt);
      const endsAt = new Date(event.endsAt);

      if (now < scheduledAt) continue;

      if (now >= endsAt) {
        this.pendingDoctorCallByAppointment.delete(appointmentId);
        continue;
      }

      this.emitDoctorCallEvent(event);
    }
  }

  private isDuplicateDoctorCallEvent(event: AgentEvent): boolean {
    return event.type === 'patient_call_to_doctor'
      && this.hasAssignedDoctor(event.doctorName)
      && this.doctorCallAnnouncedByAppointment.has(event.appointmentId);
  }

  private shouldTriggerVitalSignsCall(appointmentId: string): boolean {
    const tracked = this.trackedAppointments.find((appointment) => appointment.id === appointmentId);
    if (!tracked) return true;

    if (tracked.vitalSignsTakenAt) return false;

    const blockedStatuses = new Set(['Lista para consulta', 'Iniciada', 'Reagendada']);
    return !blockedStatuses.has(tracked.status);
  }

  trackingStatusLabel(appointment: TrackedAppointment): string {
    if (appointment.status !== 'En espera de signos vitales') return appointment.status;

    if (this.isLaboratorySpecialty(appointment.specialty)) {
      return this.isPreparationStarted(appointment.id)
        ? 'En toma de laboratorios'
        : 'En espera de laboratorios';
    }

    if (this.isSpecialStudiesSpecialty(appointment.specialty)) {
      return this.isPreparationStarted(appointment.id)
        ? 'En toma de estudios especiales'
        : 'En espera de estudios especiales';
    }

    return this.isPreparationStarted(appointment.id)
      ? 'En toma de signos vitales'
      : 'En espera de signos vitales';
  }

  private trackingStatusGroupFor(appointment: TrackedAppointment): string {
    if (appointment.status !== 'En espera de signos vitales') return appointment.status;

    return this.isPreparationStarted(appointment.id)
      ? 'En toma de estudio'
      : 'En espera de estudio';
  }

  private hasAssignedDoctor(doctorName?: string): boolean {
    return (doctorName ?? '').trim().length > 0;
  }

  private syncTransientStates(): void {
    const stillOpenIds = new Set(
      this.trackedAppointments
        .filter((appointment) => appointment.status === 'En espera de signos vitales')
        .map((appointment) => appointment.id),
    );

    for (const id of this.preparationStartedByAppointment) {
      if (!stillOpenIds.has(id)) {
        this.preparationStartedByAppointment.delete(id);
      }
    }
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleString('es-CR');
  }

  doctorDisplayName(doctorName: string): string {
    const normalized = doctorName.trim();
    return normalized ? `Dr. ${normalized}` : 'No asignado';
  }

  /**
   * Get the last user message before a given message index (for feedback purposes)
   */
  getLastUserMessage(currentIndex: number): string {
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (this.chatMessages[i].role === 'user') {
        return this.chatMessages[i].content;
      }
    }
    return '';
  }

  /**
   * Generate confidence reason string based on route and metadata
   */
  getConfidenceReasons(msg: ChatMessage): string {
    const reasons: string[] = [];

    if (msg.route) {
      switch (msg.route) {
        case 'tool':
          reasons.push('Ejecutada por herramienta exacta');
          break;
        case 'llm_premium':
          reasons.push('Procesada por LLM Premium (OpenAI/OpenRouter)');
          break;
        case 'llm_local':
          reasons.push('Procesada por LLM Local (Ollama)');
          break;
        case 'learned':
          reasons.push('Reconocida como patrón aprendido');
          break;
        case 'fallback':
          reasons.push('Fallback genérico');
          break;
      }
    }

    if (msg.tool) {
      reasons.push(`Herramienta: ${msg.tool}`);
    }

    if (msg.confidence !== undefined) {
      const percent = Math.round(msg.confidence * 100);
      if (percent <= 50) {
        reasons.push('Confianza baja - Zoe fue honesta');
      } else if (percent <= 70) {
        reasons.push('Confianza media - Posible mejora');
      } else {
        reasons.push('Confianza alta - Respuesta segura');
      }
    }

    return reasons.join(' | ') || 'Basado en análisis de confianza';
  }

  humanType(type: AgentEvent['type']): string {
    switch (type) {
      case 'patient_arrived':
        return 'PACIENTE LLEGO';
      case 'pre_appointment_alert':
        return 'ALERTA PREVIA';
      case 'patient_call_to_doctor':
        return 'PASE CON EL MEDICO';
      case 'secretary_review':
        return 'REVISION EN SECRETARIA';
      case 'vital_signs_completed':
        return 'SIGNOS VITALES COMPLETADOS';
      case 'appointment_rescheduled':
        return 'CITA REAGENDADA';
      case 'appointment_started':
        return 'CITA INICIADA';
      case 'appointment_recommendation':
        return 'RECOMENDACION IA';
      case 'agent_thinking':
        return 'AGENTE ANALIZANDO';
      case 'agent_decision':
        return 'DECISION IA';
    }
  }

  notificationPermissionLabel(): string {
    switch (this.notificationPermission) {
      case 'granted':
        return 'Activadas';
      case 'denied':
        return 'Bloqueadas por el navegador';
      case 'default':
        return 'Pendiente de permiso';
      case 'unsupported':
        return 'No soportadas en este navegador';
    }
  }

  async enableBrowserNotifications(): Promise<void> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      this.notificationPermission = 'unsupported';
      this.notificationStatusMessage = 'Este navegador no soporta notificaciones.';
      return;
    }

    const currentPermission = Notification.permission;

    if (currentPermission === 'denied') {
      this.notificationPermission = 'denied';
      this.notificationStatusMessage = 'El navegador bloqueó notificaciones. Habilítalas en configuración del sitio.';
      return;
    }

    if (currentPermission === 'granted') {
      this.notificationPermission = 'granted';
      this.notificationStatusMessage = 'Notificaciones ya activadas.';

      try {
        await this.enableWebPushSubscription();
      } catch (error) {
        console.warn('No se pudo registrar Web Push:', error);
        this.notificationStatusMessage = 'Permiso activo, pero no se pudo registrar Web Push.';
      }
      return;
    }

    try {
      this.notificationPermission = await Notification.requestPermission();
      if (this.notificationPermission !== 'granted') {
        this.notificationStatusMessage = 'Permiso de notificaciones no concedido.';
        return;
      }

      try {
        await this.enableWebPushSubscription();
        this.notificationStatusMessage = 'Notificaciones activadas correctamente.';
      } catch (error) {
        console.warn('No se pudo registrar Web Push:', error);
        this.notificationStatusMessage = 'Permiso concedido, pero falló el registro Web Push.';
      }
    } catch (error) {
      console.error('Error solicitando permiso de notificaciones:', error);
      this.notificationPermission = Notification.permission;
      this.notificationStatusMessage = 'No se pudo solicitar permiso de notificaciones.';
    }
  }

  dismissOverlayAlert(alertId: number): void {
    this.overlayAlerts = this.overlayAlerts.filter((a) => a.id !== alertId);
  }

  async confirmRecommendation(event: AgentEvent): Promise<void> {
    if (event.type !== 'appointment_recommendation') return;
    if (!event.recommendation?.requiresHumanConfirmation) return;

    await this.eventsService.confirmRecommendation(event.appointmentId);
    await this.eventsService.sendRecommendationFeedback(event.appointmentId, 'accepted');
    this.recommendationFeedbackByAppointment[event.appointmentId] = 'accepted';

    this.allEvents = this.allEvents.map((item) => {
      if (item.appointmentId !== event.appointmentId) return item;
      if (!item.recommendation) return item;
      return {
        ...item,
        recommendation: {
          ...item.recommendation,
          confirmationStatus: 'confirmed',
        },
      };
    });
  }

  async markRecommendationIgnored(event: AgentEvent): Promise<void> {
    if (event.type !== 'appointment_recommendation') return;
    await this.eventsService.sendRecommendationFeedback(event.appointmentId, 'ignored');
    this.recommendationFeedbackByAppointment[event.appointmentId] = 'ignored';
  }

  async markRecommendationFalseAlarm(event: AgentEvent): Promise<void> {
    if (event.type !== 'appointment_recommendation') return;
    await this.eventsService.sendRecommendationFeedback(event.appointmentId, 'false_alarm');
    this.recommendationFeedbackByAppointment[event.appointmentId] = 'false_alarm';
  }

  recommendationFeedbackLabel(event: AgentEvent): string {
    const outcome = this.recommendationFeedbackByAppointment[event.appointmentId];
    if (outcome === 'accepted') return 'Feedback: aceptada';
    if (outcome === 'ignored') return 'Feedback: ignorada';
    if (outcome === 'false_alarm') return 'Feedback: falsa alarma';
    return 'Feedback: pendiente';
  }

  canSendFeedback(event: AgentEvent, outcome: 'ignored' | 'false_alarm'): boolean {
    return this.recommendationFeedbackByAppointment[event.appointmentId] !== outcome;
  }

  rowStatusClass(status: string): string {
    if (status.startsWith('En espera de') || status.startsWith('En toma de')) return 'row-waiting';
    if (status === 'Lista para consulta') return 'row-ready';
    if (status === 'Iniciada') return 'row-started';
    if (status === 'Reagendada') return 'row-rescheduled';
    if (status === 'En revision de secretaria') return 'row-secretary';
    return '';
  }

  recommendationStatusLabel(event: AgentEvent): string {
    if (event.type !== 'appointment_recommendation') return '';
    const status = event.recommendation?.confirmationStatus;
    if (status === 'pending') return 'Pendiente de confirmacion humana';
    if (status === 'confirmed') return 'Confirmada por humano';
    return 'No requiere confirmacion';
  }

  statusLabel(): string {
    switch (this.status) {
      case 'conectado':    return 'Conectado';
      case 'conectando':   return 'Conectando...';
      case 'reconectando': return `Reconectando... (intento ${this.reconnectAttempts})`;
      case 'desconectado': return 'Desconectado. Reinicie el agente.';
    }
  }

  private refreshNotificationPermission(): void {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      this.notificationPermission = 'unsupported';
      return;
    }

    this.notificationPermission = Notification.permission;
  }

  private async enableWebPushSubscription(): Promise<void> {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    const pushConfig = await this.eventsService.getPushPublicKey();
    if (!pushConfig.enabled || !pushConfig.publicKey) {
      return;
    }

    const registration = await navigator.serviceWorker.register('/assets/sw-push.js');
    const existingSubscription = await registration.pushManager.getSubscription();

    if (existingSubscription) {
      this.pushSubscription = existingSubscription;
      await this.eventsService.registerPushSubscription(existingSubscription);
      return;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: this.base64UrlToUint8Array(pushConfig.publicKey),
    });

    this.pushSubscription = subscription;
    await this.eventsService.registerPushSubscription(subscription);
  }

  private base64UrlToUint8Array(base64Url: string): Uint8Array {
    const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
    const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const output = new Uint8Array(raw.length);

    for (let i = 0; i < raw.length; i++) {
      output[i] = raw.charCodeAt(i);
    }

    return output;
  }

  private pushOverlayAlert(event: AgentEvent): void {
    if (!this.isMainAlertType(event.type)) return;
    if (event.type === 'pre_appointment_alert' && !this.shouldTriggerVitalSignsCall(event.appointmentId)) return;

    const level: UiAlertLevel =
      event.type === 'pre_appointment_alert' ? 'warning' : 'info';
    const title = this.toPlainText(this.humanType(event.type));
    const message = this.toPlainText(`${event.patientName} · ${event.specialty}. ${event.actionText}`);
    const alert: UiAlert = {
      id: this.alertIdSequence++,
      level,
      title,
      message,
    };

    this.overlayAlerts = [alert, ...this.overlayAlerts].slice(0, 4);

    const ttlMs =
      level === 'warning' ? this.uiConfig.overlayWarningTtlMs : this.uiConfig.overlayInfoTtlMs;
    setTimeout(() => {
      this.dismissOverlayAlert(alert.id);
    }, ttlMs);
  }

  private triggerBrowserNotification(event: AgentEvent): void {
    if (!this.isMainAlertType(event.type)) return;
    if (event.type === 'pre_appointment_alert' && !this.shouldTriggerVitalSignsCall(event.appointmentId)) return;

    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const title = this.toPlainText(`${this.humanType(event.type)}: ${event.patientName}`);
    const body = this.toPlainText(`${event.specialty} · ${event.actionText}`);
    const notification = new Notification(title, {
      body,
      tag: `${event.type}-${event.appointmentId}`,
      requireInteraction: event.type === 'pre_appointment_alert',
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }

  private playAlertSound(event: AgentEvent): void {
    if (!this.isSoundAlertType(event.type)) return;
    if (event.type === 'pre_appointment_alert' && !this.shouldTriggerVitalSignsCall(event.appointmentId)) return;

    if (typeof window === 'undefined') return;
    if (!this.alertAudioUnlocked) return;

    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.alertAudioContext) {
      try {
        this.alertAudioContext = new AudioCtx();
      } catch {
        return;
      }
    }

    const ctx = this.alertAudioContext;
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      void ctx.resume().then(() => {
        this.playAlertSound(event);
      }).catch(() => {
        // Si no se puede reanudar, se omite el beep sin llenar consola de warnings.
      });
      return;
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.frequency.value = event.type === 'pre_appointment_alert'
      ? 880
      : event.type === 'patient_arrived'
        ? 660
        : 740;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 1.2);
  }

  private toPlainText(input: string): string {
    const decoded = input
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&#x2F;/gi, '/')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/__(.*?)__/g, '$1');

    const noTags = decoded.replace(/<[^>]*>/g, ' ');
    return noTags
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async refreshTrackedAppointments(): Promise<void> {
    try {
      const tracked = await this.eventsService.getTrackedAppointments();
      this.trackedAppointments = tracked
        .filter((appointment) => this.isCurrentDay(appointment.scheduledAt))
        .sort((a, b) => this.compareTrackedAppointments(a, b));
      this.syncTransientStates();
    } catch {
      // Mantener ultimo snapshot valido cuando backend no este disponible.
    }
  }

  private applyEventToTrackedAppointments(event: AgentEvent): void {
    const existing = this.trackedAppointments.find((item) => item.id === event.appointmentId);

    const base: TrackedAppointment =
      existing ?? {
        id: event.appointmentId,
        patientName: event.patientName,
        doctorName: event.doctorName,
        specialty: event.specialty,
        scheduledAt: event.scheduledAt,
        endsAt: event.endsAt,
        status: 'Activa',
        checkedInAt: null,
        vitalSignsTakenAt: null,
        rescheduledTo: null,
      };

    const updated = this.applyDerivedStatus(base, event);

    this.trackedAppointments = [
      ...this.trackedAppointments.filter((item) => item.id !== updated.id),
      updated,
    ].sort((a, b) => this.compareTrackedAppointments(a, b));

    this.syncTransientStates();
  }

  private applyDerivedStatus(base: TrackedAppointment, event: AgentEvent): TrackedAppointment {
    switch (event.type) {
      case 'patient_arrived':
        return { ...base, status: 'En espera de signos vitales', checkedInAt: event.occurredAt };
      case 'secretary_review':
        return { ...base, status: 'En revision de secretaria', checkedInAt: event.occurredAt };
      case 'pre_appointment_alert':
        return { ...base, status: base.status === 'Activa' ? 'Activa' : base.status };
      case 'vital_signs_completed':
        return { ...base, status: 'Lista para consulta', vitalSignsTakenAt: event.occurredAt };
      case 'patient_call_to_doctor':
        return { ...base, status: 'Lista para consulta' };
      case 'appointment_started':
        return { ...base, status: 'Iniciada' };
      case 'appointment_rescheduled':
        return { ...base, status: 'Reagendada' };
      default:
        return base;
    }
  }


  private async refreshUiConfig(): Promise<void> {
    try {
      this.uiConfig = await this.eventsService.getUiConfig();
      this.voiceCallQueue.configureTtsMode(
        this.uiConfig.preferBrowserTts,
        this.uiConfig.serverTtsEnabled,
      );
    } catch {
      // Si no hay config remota, mantener valores por defecto.
    }
  }

  private compareTrackedAppointments(a: TrackedAppointment, b: TrackedAppointment): number {
    const bySchedule = new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    if (bySchedule !== 0) return bySchedule;

    // Stable tie-breakers prevent cards from jumping when one item is updated.
    const byDoctor = a.doctorName.localeCompare(b.doctorName, 'es');
    if (byDoctor !== 0) return byDoctor;

    return a.id.localeCompare(b.id, 'es', { numeric: true });
  }

  private async handleDayRollover(): Promise<void> {
    const todayKey = this.getDayKey(new Date());
    if (todayKey === this.currentDayKey) return;

    this.currentDayKey = todayKey;
    this.resetDailyUiState();
    await this.refreshTrackedAppointments();
  }

  private resetDailyUiState(): void {
    this.allEvents = [];
    this.overlayAlerts = [];
    this.trackedAppointments = [];
    this.recommendationFeedbackByAppointment = {};
    this.preparationStartedByAppointment.clear();
    this.doctorCallAnnouncedByAppointment.clear();
    this.pendingDoctorCallByAppointment.clear();
    this.voiceCallsProcessed.clear();
  }

  private getDayKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }

  private isCurrentDay(isoDate: string): boolean {
    return this.getDayKey(new Date(isoDate)) === this.currentDayKey;
  }

  private isMainAlertType(type: AgentEventType): boolean {
    return (
      type === 'pre_appointment_alert' ||
      type === 'patient_call_to_doctor'
    );
  }

  private isSoundAlertType(type: AgentEventType): boolean {
    return (
      type === 'pre_appointment_alert' ||
      type === 'patient_call_to_doctor' ||
      type === 'patient_arrived'
    );
  }

  private shouldHideMainAlert(event: AgentEvent): boolean {
    if (event.type !== 'pre_appointment_alert') return false;

    if (!this.shouldTriggerVitalSignsCall(event.appointmentId)) return true;

    return this.allEvents.some(
      (candidate) =>
        candidate.appointmentId === event.appointmentId &&
        (candidate.type === 'vital_signs_completed' ||
          candidate.type === 'appointment_started' ||
          candidate.type === 'appointment_rescheduled'),
    );
  }
}
