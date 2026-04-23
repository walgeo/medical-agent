import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { ChildProcessWithoutNullStreams, spawn, spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { basename, extname, join } from 'path';
import { existsSync, readdirSync, statSync } from 'fs';
import { readFile, unlink, stat } from 'fs/promises';
import { randomUUID } from 'crypto';
import { AgentEvent } from '../../domain/events/AgentEvent';
import { IAppointmentUpdater } from '../../domain/ports/IAppointmentUpdater';
import { IEventPublisher } from '../../domain/ports/IEventPublisher';
import { IAppointmentService } from '../../domain/ports/IAppointmentService';
import { ILogger } from '../../domain/ports/ILogger';
import { IRecommendationGovernance } from '../../domain/ports/IRecommendationGovernance';
import { RecommendationFeedbackOutcome } from '../../domain/recommendations/RecommendationFeedback';
import webpush from 'web-push';
import { ZoeLearningEngine } from '../learning/ZoeLearningEngine';

type StoredPushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

type ZoeAppointmentView = {
  id: string;
  paciente: string;
  doctor: string;
  especialidad: string;
  inicio: string;
  fin: string;
  estado: string;
  llegada: string | null;
  signosVitales: string | null;
  reagendada: string | null;
};

type ZoeToolResponse = {
  response: string;
  isHtml: boolean;
  tool: string;
  route: 'tool' | 'fallback'; // Only tool or fallback, not llm (llm is handled separately)
  suggestedAction?: string;
};

type ZoeLlmConfig = {
  name: 'premium' | 'local';
  url: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
};

type DetectedTtsCommand = {
  command: 'piper' | 'piper-tts' | 'espeak-ng' | 'espeak' | 'pico2wave';
  executable?: string;
  viaHost: boolean;
};

type PersistentPiperSession = {
  key: string;
  child: ChildProcessWithoutNullStreams;
};

export class SseEventPublisher implements IEventPublisher {
  private readonly clients = new Set<ServerResponse>();
  private readonly eventHistory: AgentEvent[] = [];
  private readonly maxHistorySize = 100;
  private readonly pushSubscriptions = new Map<string, StoredPushSubscription>();
  private readonly pushPublicKey = process.env.VAPID_PUBLIC_KEY ?? '';
  private readonly pushPrivateKey = process.env.VAPID_PRIVATE_KEY ?? '';
  private readonly pushSubject = process.env.VAPID_SUBJECT ?? 'mailto:admin@medical-agent.local';
  private server: Server | null = null;
  private pushEnabled = false;
  private detectedTtsCommand: DetectedTtsCommand | null | undefined;
  private readonly learningEngine: ZoeLearningEngine = new ZoeLearningEngine();
  private piperSession: PersistentPiperSession | null = null;
  private piperWriteChain: Promise<void> = Promise.resolve();
  private readonly persistentPiperEnabled = (process.env.TTS_PIPER_PERSISTENT ?? 'true').toLowerCase() !== 'false';

  constructor(
    private readonly port: number,
    private readonly path: string,
    private readonly logger: ILogger,
    private readonly recommendationGovernance?: IRecommendationGovernance,
    private readonly appointmentService?: IAppointmentService,
    private readonly appointmentUpdater?: IAppointmentUpdater,
  ) {}

  start(): void {
    if (this.server) return;

    this.configureWebPush();

    this.server = createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }

      const requestUrl = new URL(req.url, `http://${req.headers.host ?? `localhost:${this.port}`}`);

      this.setCorsHeaders(res);

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      if (requestUrl.pathname === this.path && req.method === 'GET') {
        this.handleSseConnection(req, res);
        return;
      }

      if (requestUrl.pathname === '/push/public-key' && req.method === 'GET') {
        this.sendJson(res, 200, {
          enabled: this.pushEnabled,
          publicKey: this.pushPublicKey,
        });
        return;
      }

      if (requestUrl.pathname === '/push/subscribe' && req.method === 'POST') {
        void this.handleSubscribe(req, res);
        return;
      }

      if (requestUrl.pathname === '/push/unsubscribe' && req.method === 'POST') {
        void this.handleUnsubscribe(req, res);
        return;
      }

      if (requestUrl.pathname === '/recommendations/confirm' && req.method === 'POST') {
        void this.handleRecommendationConfirm(req, res);
        return;
      }

      if (requestUrl.pathname === '/recommendations/feedback' && req.method === 'POST') {
        void this.handleRecommendationFeedback(req, res);
        return;
      }

      if (requestUrl.pathname === '/recommendations/metrics' && req.method === 'GET') {
        this.handleRecommendationMetrics(res);
        return;
      }

      if (requestUrl.pathname === '/appointments/tracking' && req.method === 'GET') {
        void this.handleAppointmentsTracking(res);
        return;
      }

      if (requestUrl.pathname === '/ui/config' && req.method === 'GET') {
        this.handleUiConfig(res);
        return;
      }

      if (requestUrl.pathname === '/appointments/complete-vital-signs' && req.method === 'POST') {
        void this.handleCompleteVitalSigns(req, res);
        return;
      }

      if (requestUrl.pathname === '/appointments/trigger-early-vital-signs' && req.method === 'POST') {
        void this.handleTriggerEarlyVitalSigns(req, res);
        return;
      }

      if (requestUrl.pathname === '/chat' && req.method === 'POST') {
        void this.handleZoeChat(req, res);
        return;
      }

      if (requestUrl.pathname === '/tts/synthesize' && req.method === 'POST') {
        void this.handleSynthesizeSpeech(req, res);
        return;
      }

      if (requestUrl.pathname === '/zoe/feedback' && req.method === 'POST') {
        void this.handleZoeFeedback(req, res);
        return;
      }

      if (requestUrl.pathname === '/zoe/learning-stats' && req.method === 'GET') {
        this.sendJson(res, 200, this.learningEngine.getStats());
        return;
      }

      if (requestUrl.pathname === '/zoe/recent-feedback' && req.method === 'GET') {
        const limit = parseInt(requestUrl.searchParams.get('limit') ?? '20', 10);
        this.sendJson(res, 200, this.learningEngine.getRecentFeedback(limit));
        return;
      }

      // Serve Angular static files
      const staticDir = process.env.STATIC_DIR ?? join(process.cwd(), 'public', 'browser');
      void this.serveStaticFile(req, res, staticDir);
    });

    this.server.listen(this.port, () => {
      this.logger.log('SSE_SERVER_START', `SSE activo en http://localhost:${this.port}${this.path}`);
    });
  }

  publish(event: AgentEvent): void {
    this.storeEvent(event);
    const payload = this.formatSse(event);

    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch {
        this.clients.delete(client);
      }
    }

    if (this.pushEnabled && this.pushSubscriptions.size > 0 && this.shouldSendPushAlert(event)) {
      void this.publishPush(event);
    }
  }

  private shouldSendPushAlert(event: AgentEvent): boolean {
    return (
      event.type === 'pre_appointment_alert' ||
      event.type === 'patient_call_to_doctor'
    );
  }

  private configureWebPush(): void {
    if (!this.pushPublicKey || !this.pushPrivateKey) {
      this.pushEnabled = false;
      this.logger.log(
        'WEB_PUSH_DISABLED',
        'Web Push desactivado: faltan VAPID_PUBLIC_KEY y/o VAPID_PRIVATE_KEY en variables de entorno.',
      );
      return;
    }

    webpush.setVapidDetails(this.pushSubject, this.pushPublicKey, this.pushPrivateKey);
    this.pushEnabled = true;
    this.logger.log('WEB_PUSH_ENABLED', 'Web Push habilitado.');
  }

  private handleSseConnection(req: IncomingMessage, res: ServerResponse): void {
    this.setupSseHeaders(res);
    this.clients.add(res);
    this.replayRecentEvents(res);

    this.logger.log('SSE_CLIENT_CONNECTED', `Cliente SSE conectado. Total: ${this.clients.size}`);

    req.on('close', () => {
      this.clients.delete(res);
      this.logger.log(
        'SSE_CLIENT_DISCONNECTED',
        `Cliente SSE desconectado. Total: ${this.clients.size}`,
      );
    });
  }

  private async handleSubscribe(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.pushEnabled) {
      this.sendJson(res, 503, { message: 'Web Push no esta habilitado en el servidor.' });
      return;
    }

    try {
      const body = await this.readJsonBody(req);
      const subscription = this.parseSubscription(body);
      const key = this.subscriptionKey(subscription);

      this.pushSubscriptions.set(key, subscription);

      this.logger.log(
        'WEB_PUSH_SUBSCRIBED',
        `Suscriptor Push registrado. Total: ${this.pushSubscriptions.size}`,
      );

      this.sendJson(res, 201, { success: true });
    } catch (error) {
      this.sendJson(res, 400, {
        message: 'Suscripcion invalida.',
        error: error instanceof Error ? error.message : 'Error desconocido',
      });
    }
  }

  private async handleUnsubscribe(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = (await this.readJsonBody(req)) as { endpoint?: unknown };
      const endpoint = typeof body.endpoint === 'string' ? body.endpoint : null;

      if (!endpoint) {
        this.sendJson(res, 400, { message: 'endpoint es requerido.' });
        return;
      }

      for (const [key, subscription] of this.pushSubscriptions.entries()) {
        if (subscription.endpoint === endpoint) {
          this.pushSubscriptions.delete(key);
        }
      }

      this.sendJson(res, 200, { success: true });
    } catch (error) {
      this.sendJson(res, 400, {
        message: 'No se pudo procesar la baja de suscripcion.',
        error: error instanceof Error ? error.message : 'Error desconocido',
      });
    }
  }

  private async handleRecommendationConfirm(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (!this.recommendationGovernance) {
      this.sendJson(res, 503, { message: 'Governance de recomendaciones no habilitada.' });
      return;
    }

    try {
      const body = (await this.readJsonBody(req)) as { appointmentId?: unknown };
      const appointmentId = typeof body.appointmentId === 'string' ? body.appointmentId : '';

      if (!appointmentId) {
        this.sendJson(res, 400, { message: 'appointmentId es requerido.' });
        return;
      }

      const confirmed = this.recommendationGovernance.confirmRecommendation(appointmentId);
      if (!confirmed) {
        this.sendJson(res, 404, { message: 'No hay recomendacion pendiente para confirmar.' });
        return;
      }

      this.logger.log('RECOMMENDATION_CONFIRMED', `appointmentId=${appointmentId}`);
      this.sendJson(res, 200, { success: true });
    } catch (error) {
      this.sendJson(res, 400, {
        message: 'Solicitud de confirmacion invalida.',
        error: error instanceof Error ? error.message : 'Error desconocido',
      });
    }
  }

  private async handleRecommendationFeedback(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (!this.recommendationGovernance) {
      this.sendJson(res, 503, { message: 'Governance de recomendaciones no habilitada.' });
      return;
    }

    try {
      const body = (await this.readJsonBody(req)) as {
        appointmentId?: unknown;
        outcome?: unknown;
      };

      const appointmentId = typeof body.appointmentId === 'string' ? body.appointmentId : '';
      const outcome = this.parseFeedbackOutcome(body.outcome);

      if (!appointmentId) {
        this.sendJson(res, 400, { message: 'appointmentId es requerido.' });
        return;
      }

      if (!outcome) {
        this.sendJson(res, 400, {
          message: "outcome invalido. Use: 'accepted'|'ignored'|'false_alarm'.",
        });
        return;
      }

      const updated = this.recommendationGovernance.addFeedback(appointmentId, outcome);
      if (!updated) {
        this.sendJson(res, 404, { message: 'No existe recomendacion para ese appointmentId.' });
        return;
      }

      this.logger.log('RECOMMENDATION_FEEDBACK', `appointmentId=${appointmentId}, outcome=${outcome}`);
      this.sendJson(res, 200, { success: true });
    } catch (error) {
      this.sendJson(res, 400, {
        message: 'Solicitud de feedback invalida.',
        error: error instanceof Error ? error.message : 'Error desconocido',
      });
    }
  }

  private handleRecommendationMetrics(res: ServerResponse): void {
    if (!this.recommendationGovernance) {
      this.sendJson(res, 503, { message: 'Governance de recomendaciones no habilitada.' });
      return;
    }

    this.sendJson(res, 200, this.recommendationGovernance.getMetrics());
  }

  private async handleAppointmentsTracking(res: ServerResponse): Promise<void> {
    if (!this.appointmentService) {
      this.sendJson(res, 503, { message: 'Servicio de seguimiento no habilitado.' });
      return;
    }

    const tracked = await this.appointmentService.getTodayTrackedAppointments();

    this.sendJson(
      res,
      200,
      tracked.map((appointment) => ({
        id: appointment.id,
        patientName: appointment.patientName,
        doctorName: appointment.doctorName,
        specialty: appointment.specialty,
        scheduledAt: appointment.scheduledAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        status: appointment.status,
        checkedInAt: appointment.checkedInAt?.toISOString() ?? null,
        vitalSignsTakenAt: appointment.vitalSignsTakenAt?.toISOString() ?? null,
        rescheduledTo: appointment.rescheduledTo?.toISOString() ?? null,
      })),
    );
  }

  private handleUiConfig(res: ServerResponse): void {
    const mainAlertWindowMs = this.readPositiveIntEnv('MAIN_ALERT_WINDOW_MS', 15 * 60_000);
    const overlayWarningTtlMs = this.readPositiveIntEnv('OVERLAY_WARNING_TTL_MS', 25_000);
    const overlayInfoTtlMs = this.readPositiveIntEnv('OVERLAY_INFO_TTL_MS', 12_000);

    this.sendJson(res, 200, {
      mainAlertWindowMs,
      overlayWarningTtlMs,
      overlayInfoTtlMs,
    });
  }

  private async handleCompleteVitalSigns(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (!this.appointmentService || !this.appointmentUpdater) {
      this.sendJson(res, 503, { message: 'Flujo de enfermeria no habilitado.' });
      return;
    }

    if (!this.isNurseRequest(req)) {
      this.sendJson(res, 403, {
        message: 'Operacion permitida solo para enfermeria.',
      });
      return;
    }

    try {
      const body = (await this.readJsonBody(req)) as { appointmentId?: unknown };
      const appointmentId = typeof body.appointmentId === 'string' ? body.appointmentId : '';

      if (!appointmentId) {
        this.sendJson(res, 400, { message: 'appointmentId es requerido.' });
        return;
      }

      const tracked = await this.appointmentService.getTodayTrackedAppointments();
      const appointment = tracked.find((item) => item.id === appointmentId);

      if (!appointment) {
        this.sendJson(res, 404, { message: 'No se encontro la cita solicitada.' });
        return;
      }

      await this.appointmentUpdater.markAsReadyForAppointment(appointment.id, new Date());

      this.publish({
        version: 1,
        type: 'vital_signs_completed',
        occurredAt: new Date().toISOString(),
        appointmentId: appointment.id,
        patientName: appointment.patientName,
        doctorName: appointment.doctorName,
        specialty: appointment.specialty,
        scheduledAt: appointment.scheduledAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        actionText: 'Signos vitales completados. Paciente listo para pasar con el medico.',
      });

      this.logger.log('VITAL_SIGNS_COMPLETED_MANUAL', `appointmentId=${appointmentId}`);
      this.sendJson(res, 200, { success: true });
    } catch (error) {
      this.sendJson(res, 400, {
        message: 'No se pudo completar signos vitales.',
        error: error instanceof Error ? error.message : 'Error desconocido',
      });
    }
  }

  private async handleTriggerEarlyVitalSigns(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (!this.appointmentService) {
      this.sendJson(res, 503, { message: 'Servicio de citas no habilitado.' });
      return;
    }

    if (!this.isNurseRequest(req)) {
      this.sendJson(res, 403, {
        message: 'Operacion permitida solo para enfermeria.',
      });
      return;
    }

    try {
      const body = (await this.readJsonBody(req)) as { appointmentId?: unknown };
      const appointmentId = typeof body.appointmentId === 'string' ? body.appointmentId : '';

      if (!appointmentId) {
        this.sendJson(res, 400, { message: 'appointmentId es requerido.' });
        return;
      }

      const tracked = await this.appointmentService.getTodayTrackedAppointments();
      const appointment = tracked.find((item) => item.id === appointmentId);

      if (!appointment) {
        this.sendJson(res, 404, { message: 'No se encontro la cita solicitada.' });
        return;
      }

      const preparationArea = this.getPreparationArea(appointment.specialty);

      this.publish({
        version: 1,
        type: 'pre_appointment_alert',
        occurredAt: new Date().toISOString(),
        appointmentId: appointment.id,
        patientName: appointment.patientName,
        doctorName: appointment.doctorName,
        specialty: appointment.specialty,
        scheduledAt: appointment.scheduledAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        actionText: `Enfermería llamó a ${appointment.patientName} para ${preparationArea}. Pasar a ${preparationArea}.`,
      });

      this.logger.log('EARLY_VITAL_SIGNS_TRIGGERED', `appointmentId=${appointmentId}, patient=${appointment.patientName}`);
      this.sendJson(res, 200, { success: true });
    } catch (error) {
      this.sendJson(res, 400, {
        message: 'No se pudo iniciar la toma de signos vitales.',
        error: error instanceof Error ? error.message : 'Error desconocido',
      });
    }
  }

  private isNurseRequest(req: IncomingMessage): boolean {
    const roleHeader = req.headers['x-staff-role'];
    if (typeof roleHeader !== 'string') return false;
    return roleHeader.trim().toLowerCase() === 'nurse';
  }

  private getPreparationArea(specialty: string): string {
    const normalized = specialty.trim().toLowerCase();
    if (normalized === 'toma de laboratorios') return 'toma de laboratorios';
    if (normalized === 'toma de estudios especiales') return 'toma de estudios especiales';
    return 'toma de signos vitales';
  }

  private async handleZoeChat(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    try {
      const body = (await this.readJsonBody(req)) as {
        message?: unknown;
        history?: unknown;
      };

      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!message) {
        this.sendJson(res, 400, { message: 'message es requerido.' });
        return;
      }

      const history = Array.isArray(body.history) ? body.history : [];
      const recentUserMessages = this.findRecentUserMessages(history, 3);

      const appointments = this.appointmentService
        ? await this.appointmentService.getTodayTrackedAppointments()
        : [];

      const appointmentsContext: ZoeAppointmentView[] = appointments.map((a) => ({
        id: a.id,
        paciente: a.patientName,
        doctor: a.doctorName,
        especialidad: a.specialty,
        inicio: a.scheduledAt.toISOString(),
        fin: a.endsAt.toISOString(),
        estado: a.status,
        llegada: a.checkedInAt?.toISOString() ?? null,
        signosVitales: a.vitalSignsTakenAt?.toISOString() ?? null,
        reagendada: a.rescheduledTo?.toISOString() ?? null,
      }));

      const toolResponse = this.executeZoeTooling(message, recentUserMessages, appointmentsContext);
      if (toolResponse) {
        const adapted = this.adaptZoeResponse(
          message,
          toolResponse.response,
          toolResponse.isHtml,
          toolResponse.route,
          toolResponse.tool,
        );
        this.sendJson(res, 200, { ...adapted, ...toolResponse });
        return;
      }

      const deterministic = this.zoeDeterministicReply(message, appointmentsContext, recentUserMessages);
      if (deterministic) {
        const adapted = this.adaptZoeResponse(message, deterministic.response, deterministic.isHtml, 'fallback');
        this.sendJson(res, 200, { ...adapted, tool: 'deterministic', route: 'fallback' });
        return;
      }

      if (!this.shouldUseLlmForMessage(message)) {
        const fallback = this.zoeFallback(message, appointmentsContext, recentUserMessages);
        const adapted = this.adaptZoeResponse(message, fallback.response, fallback.isHtml, 'fallback', 'fallback');
        this.sendJson(res, 200, { ...adapted, tool: 'fallback', route: 'fallback' });
        return;
      }

      const systemPrompt = `Eres Zoe, una asistente de inteligencia artificial especializada en gestión de citas médicas.
    Tu nombre significa "vida" y tu prioridad es la vida del paciente.
    Hablas en español con estilo operativo: clara, breve, precisa y útil.

    RESTRICCIÓN IMPORTANTE:
    - Solo respondes sobre citas médicas, pacientes, doctores, especialidades y operación clínica.
    - Si te preguntan algo fuera de ese ámbito: "Mi especialidad son las citas médicas. Si quieres, te ayudo con eso."

    ESTILO DE RESPUESTA:
    - Primero da la respuesta directa en una oración.
    - Luego agrega 1-2 datos concretos de soporte si aportan valor.
    - Evita rodeos, disculpas innecesarias y texto genérico.
    - No inventes datos; usa únicamente la información recibida.

    Datos de citas de hoy (${new Date().toLocaleDateString('es-CR')}):
    ${JSON.stringify(appointmentsContext, null, 2)}

    INSTRUCCIONES DE FORMATO:
    - Para respuestas conversacionales: texto plano en español.
    - Cuando el usuario pida tablas, gráficos, estadísticos o visualizaciones: responde ÚNICAMENTE con HTML.
    - El HTML usa estilos inline o un bloque <style> al inicio del fragmento.
    - Paleta de colores: fondo #f0f9ff, acentos #0f766e y #1d4ed8, texto #0f172a.
    - Gráficas de barras: divs con width en % proporcional al valor máximo.
    - NO uses JavaScript en el HTML. NO uses librerías externas.
    - El HTML es un fragmento (sin html/head/body).
    - Para indicar que la respuesta es HTML, envuélvela exactamente así: <<<HTML>>>...contenido html...<<<END_HTML>>>`;

      const llmConfigs = this.buildZoeLlmConfigs();
      if (llmConfigs.length === 0) {
        const fallback = this.zoeFallback(message, appointmentsContext, recentUserMessages);
        const adapted = this.adaptZoeResponse(message, fallback.response, fallback.isHtml, 'fallback', 'fallback');
        this.sendJson(res, 200, { ...adapted, tool: 'fallback', route: 'fallback' });
        return;
      }

      for (const config of llmConfigs) {
        try {
          const llmResult = await this.requestZoeLlm(config, systemPrompt, history, message);
          const route = config.name === 'premium' ? 'llm_premium' : 'llm_local';
          const adapted = this.adaptZoeResponse(message, llmResult.response, llmResult.isHtml, route as any, route);
          this.sendJson(res, 200, { ...adapted, tool: route, route: 'llm' });
          return;
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'unknown error';
          this.logger.log('ZOE_LLM_ROUTE_FAILED', `route=${config.name}, detail=${detail}`);
        }
      }

      const finalFallback = this.zoeFallback(message, appointmentsContext, recentUserMessages);
      const finalAdapted = this.adaptZoeResponse(message, finalFallback.response, finalFallback.isHtml, 'fallback', 'fallback');
      this.sendJson(res, 200, { ...finalAdapted, tool: 'fallback', route: 'fallback' });
    } catch (error) {
      this.sendJson(res, 400, {
        message: 'Error procesando la solicitud.',
        error: error instanceof Error ? error.message : 'Error desconocido',
      });
    }
  }

  private async handleZoeFeedback(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    try {
      const body = (await this.readJsonBody(req)) as {
        userQuery?: unknown;
        zoeResponse?: unknown;
        feedback?: unknown;
        userCorrection?: unknown;
      };

      const userQuery = typeof body.userQuery === 'string' ? body.userQuery.trim() : '';
      const zoeResponse = typeof body.zoeResponse === 'string' ? body.zoeResponse.trim() : '';
      const feedback = body.feedback as string;
      const userCorrection = typeof body.userCorrection === 'string' ? body.userCorrection.trim() : undefined;

      if (!userQuery || !zoeResponse || !feedback) {
        this.sendJson(res, 400, {
          message: 'userQuery, zoeResponse, and feedback son requeridos.',
        });
        return;
      }

      if (!['correct', 'incorrect', 'incomplete', 'confusing'].includes(feedback)) {
        this.sendJson(res, 400, {
          message: 'feedback debe ser: correct, incorrect, incomplete o confusing.',
        });
        return;
      }

      this.learningEngine.recordUserFeedback({
        userQuery,
        zoeResponse,
        feedback: feedback as 'correct' | 'incorrect' | 'incomplete' | 'confusing',
        userCorrection,
      });

      this.sendJson(res, 200, {
        message: 'Feedback registrado. Gracias por ayudarnos a mejorar.',
        stats: this.learningEngine.getStats(),
      });
    } catch (error) {
      this.sendJson(res, 400, {
        message: 'Error registrando feedback.',
        error: error instanceof Error ? error.message : 'Error desconocido',
      });
    }
  }

  /**
   * Adapt a Zoe response using the learning engine
   * Applies confidence evaluation and may replace response if confidence is too low
   */
  private adaptZoeResponse(
    userQuery: string,
    response: string,
    isHtml: boolean,
    route: 'tool' | 'llm_premium' | 'llm_local' | 'fallback',
    toolName?: string,
    llmConfidenceScore?: number,
  ): { response: string; isHtml: boolean; confidence: number; adapted: boolean } {
    // Add to user context
    this.learningEngine.addUserMessage(userQuery);

    // Evaluate and adapt
    const adapted = this.learningEngine.evaluateAndAdaptResponse({
      userQuery,
      zoeResponse: response,
      route,
      toolName,
      llmConfidenceScore,
    });

    return {
      response: adapted.finalResponse,
      isHtml,
      confidence: adapted.confidence.score,
      adapted: adapted.finalResponse !== response,
    };
  }



  private zoeFallback(
    message: string,
    appointments: Array<{ paciente: string; especialidad: string; estado: string; doctor: string; reagendada: string | null }>,
    recentUserMessages: string[] = [],
  ): { response: string; isHtml: boolean } {
    const lower = this.normalizeText(message);

    if (this.isGreetingMessage(lower)) {
      return {
        response:
          'Hola. Soy Zoe, tu asistente de citas médicas. Puedo ayudarte con doctores, pacientes, especialidades, horarios y reportes del día. ¿Qué necesitas ver primero?',
        isHtml: false,
      };
    }

    if (this.isIdentityQuestion(lower)) {
      return {
        response:
          'Soy Zoe, tu asistente de citas médicas. Mi nombre significa "vida" y mi prioridad es ayudarte a proteger el flujo de atención del paciente.',
        isHtml: false,
      };
    }

    const total = appointments.length;
    const atendidas = appointments.filter((a) => a.estado === 'Iniciada' || a.estado === 'Lista para consulta').length;
    const reagendadas = appointments.filter((a) => a.estado === 'Reagendada').length;
    const enEspera = appointments.filter((a) => a.estado === 'En espera de signos vitales').length;

    if (lower.includes('cuantas') || lower.includes('total') || lower.includes('resumen')) {
      return {
        response: `Hoy hay ${total} cita(s) registradas: ${atendidas} en atención o listas, ${enEspera} esperando signos vitales y ${reagendadas} reagendadas.`,
        isHtml: false,
      };
    }

    if (lower.includes('reagend')) {
      const lista = appointments.filter((a) => a.estado === 'Reagendada').map((a) => a.paciente).join(', ');
      return {
        response: reagendadas > 0
          ? `Hay ${reagendadas} cita(s) reagendadas hoy: ${lista}.`
          : 'No hay citas reagendadas hoy.',
        isHtml: false,
      };
    }

    const askTable = lower.includes('tabla') || lower.includes('resumen');
    const askDoctor = lower.includes('doctor') || lower.includes('medico') || lower.includes('médico');
    const askChart =
      lower.includes('grafico') ||
      lower.includes('grafica') ||
      lower.includes('gráfico') ||
      lower.includes('gráfica') ||
      lower.includes('circular') ||
      lower.includes('barra');

    if ((askTable && askDoctor) || lower.includes('citas por especialidad')) {
      return {
        response: this.buildSpecialtyDoctorTableHtml(appointments),
        isHtml: true,
      };
    }

    if (askChart) {
      return {
        response: this.buildStatusChartHtml(atendidas, enEspera, reagendadas, total),
        isHtml: true,
      };
    }

    if (askTable) {
      return {
        response: this.buildSummaryTableHtml(atendidas, enEspera, reagendadas, total),
        isHtml: true,
      };
    }

    return {
      response:
        `Puedo ayudarte con ${total} cita(s) de hoy. Pídeme algo específico, por ejemplo: ` +
        `"cuántas citas hay en Cardiología", "pacientes de Medicina General" o "tabla de citas por especialidad y médico".`,
      isHtml: false,
    };
  }

  private executeZoeTooling(
    message: string,
    recentUserMessages: string[],
    appointments: ZoeAppointmentView[],
  ): ZoeToolResponse | null {
    const lower = this.normalizeText(message);
    const previousMessages = recentUserMessages.map((item) => this.normalizeText(item));
    const currentIntent = this.detectUserIntent(lower);
    const previousIntent = this.detectIntentFromHistory(previousMessages);

    const total = appointments.length;
    const atendidas = appointments.filter(
      (a) => a.estado === 'Iniciada' || a.estado === 'Lista para consulta',
    ).length;
    const reagendadas = appointments.filter((a) => a.estado === 'Reagendada').length;
    const enEspera = appointments.filter((a) => a.estado === 'En espera de signos vitales').length;

    const askTable = lower.includes('tabla') || lower.includes('resumen');
    const askDoctor = lower.includes('doctor') || lower.includes('medico') || lower.includes('médico');
    const askChart =
      lower.includes('grafico') ||
      lower.includes('grafica') ||
      lower.includes('gráfico') ||
      lower.includes('gráfica') ||
      lower.includes('circular') ||
      lower.includes('barra');
    const askStatusChart =
      askChart &&
      (lower.includes('estado') ||
        lower.includes('signos') ||
        lower.includes('reagend') ||
        lower.includes('listas'));
    const askOnlyDoctors =
      lower.includes('solo los doctores') ||
      lower.includes('nombres de doctores') ||
      lower.includes('nombres de los doctores') ||
      lower.includes('que doctores estan atendiendo') ||
      lower.includes('qué doctores están atendiendo') ||
      lower.includes('que doctores atienden') ||
      lower.includes('qué doctores atienden') ||
      lower === 'doctores' ||
      lower === 'doctor';
    const askSpecialtyChart =
      askChart &&
      (lower.includes('especialidad') ||
        lower.includes('especialidades') ||
        lower.includes('consultas') ||
        lower.includes('citas'));
    const askSpecialtyCounts =
      lower.includes('consultas por especialidad') ||
      lower.includes('citas por especialidad') ||
      lower.includes('cantidad de consultas por especialidad') ||
      lower.includes('cantidad de citas por especialidad') ||
      lower.includes('especialidad y consultas') ||
      lower.includes('especialidad y citas');
    const askCatalog =
      lower.includes('catalogo') ||
      lower.includes('catálogo') ||
      lower.includes('que puedes atender') ||
      lower.includes('qué puedes atender') ||
      lower.includes('que puedes consultar') ||
      lower.includes('qué puedes consultar') ||
      lower.includes('menu de consultas') ||
      lower.includes('menú de consultas') ||
      lower.includes('ayuda');
    const askSchedules =
      lower.includes('horarios') ||
      lower.includes('horario de citas') ||
      lower.includes('agenda del dia') ||
      lower.includes('agenda del día');
    const askAppointmentsByDoctor =
      lower.includes('citas por doctor') ||
      lower.includes('consultas por doctor') ||
      lower.includes('pacientes por doctor');
    const askAttendedByDoctor =
      lower.includes('atendidas por doctor') ||
      lower.includes('consultas atendidas por doctor') ||
      lower.includes('citas atendidas por doctor');
    const askRescheduled =
      lower.includes('reagendadas') ||
      lower.includes('citas reagendadas') ||
      lower.includes('consultas reagendadas');
    const askPatientsBySpecialty =
      lower.includes('pacientes por especialidad') ||
      lower.includes('a que especialidades vienen') ||
      lower.includes('a que especialidad vienen') ||
      lower.includes('especialidades vienen');
    const askPatientNames = currentIntent === 'patients';
    const askTodayAppointments =
      lower.includes('citas de hoy') ||
      lower.includes('que citas tenemos hoy') ||
      lower.includes('qué citas tenemos hoy') ||
      lower.includes('dime las citas de hoy') ||
      lower.includes('cuales son las citas de hoy') ||
      lower.includes('cuáles son las citas de hoy');
    const askTodayPatients =
      lower.includes('pacientes de hoy') ||
      lower.includes('nombres de los pacientes de hoy') ||
      lower.includes('dame los nombres de los pacientes de hoy') ||
      lower.includes('quienes son los pacientes de hoy') ||
      lower.includes('quiénes son los pacientes de hoy');

    if (this.isGreetingMessage(lower)) {
      return {
        response:
          `Hola. Soy Zoe, tu asistente de citas médicas. Hoy tengo ${total} cita(s) cargadas. ¿Quieres ver doctores, pacientes, especialidades o una gráfica?`,
        isHtml: false,
        tool: 'greeting',
        route: 'tool',
        suggestedAction: 'Pide cualquier consulta operativa: doctores, pacientes, especialidades, horarios o gráficos.',
      };
    }

    if (askCatalog) {
      return {
        response: this.buildCapabilitiesCatalogHtml(),
        isHtml: true,
        tool: 'capabilities_catalog',
        route: 'tool',
        suggestedAction: 'Usa este catálogo como guía para preguntar en lenguaje natural.',
      };
    }

    if (askTodayAppointments) {
      return {
        response: this.buildTodayAppointmentsTableHtml(appointments),
        isHtml: true,
        tool: 'today_appointments_table',
        route: 'tool',
        suggestedAction: 'Usa esta vista para validar estado y prioridad de cada cita del día.',
      };
    }

    if (askTodayPatients) {
      const patients = Array.from(new Set(appointments.map((a) => a.paciente)));
      return {
        response:
          patients.length > 0
            ? `Pacientes de hoy: ${patients.join(', ')}.`
            : 'Hoy no hay pacientes agendados.',
        isHtml: false,
        tool: 'today_patients_list',
        route: 'tool',
        suggestedAction:
          patients.length > 0
            ? 'Puedes pedirme los pacientes por especialidad o estado para priorizar atención.'
            : 'Verifica si la agenda del día ya fue cargada.',
      };
    }

    if (askOnlyDoctors) {
      return {
        response: this.buildDoctorsListHtml(appointments),
        isHtml: true,
        tool: 'doctors_list',
        route: 'tool',
        suggestedAction: 'Usa esta lista para identificar rápidamente qué médico está atendiendo cada especialidad.',
      };
    }

    if (askSchedules) {
      return {
        response: this.buildTodayAppointmentsTableHtml(appointments),
        isHtml: true,
        tool: 'appointments_schedule_table',
        route: 'tool',
        suggestedAction: 'Puedes filtrar después por especialidad, doctor o estado.',
      };
    }

    if (askAppointmentsByDoctor) {
      return {
        response: this.buildAppointmentsByDoctorTableHtml(appointments),
        isHtml: true,
        tool: 'appointments_by_doctor_table',
        route: 'tool',
        suggestedAction: 'Te muestra carga total por médico para balance de agenda.',
      };
    }

    if (askAttendedByDoctor) {
      return {
        response: this.buildAttendedByDoctorTableHtml(appointments),
        isHtml: true,
        tool: 'attended_by_doctor_table',
        route: 'tool',
        suggestedAction: 'Úsalo para seguimiento de productividad por médico.',
      };
    }

    if (askRescheduled) {
      return {
        response: this.buildRescheduledTableHtml(appointments),
        isHtml: true,
        tool: 'rescheduled_appointments_table',
        route: 'tool',
        suggestedAction: 'Sirve para identificar saturación y reasignación de agenda.',
      };
    }

    if (askPatientsBySpecialty) {
      return {
        response: this.buildPatientsBySpecialtyHtml(appointments),
        isHtml: true,
        tool: 'patients_by_specialty_table',
        route: 'tool',
        suggestedAction: 'Usa esta vista para coordinar pacientes por consultorio y especialidad.',
      };
    }

    const patientMatch = this.extractMatchingValue(
      lower,
      Array.from(new Set(appointments.map((a) => a.paciente))),
    );
    const askPatientSpecialty =
      Boolean(patientMatch) &&
      (lower.includes('especialidad') || lower.includes('asiste') || lower.includes('viene'));

    if (patientMatch && askPatientSpecialty) {
      const patientAppointment = appointments.find(
        (a) => this.normalizeText(a.paciente) === this.normalizeText(patientMatch),
      );

      if (patientAppointment) {
        return {
          response: `${patientAppointment.paciente} asiste a ${patientAppointment.especialidad} con el Dr. ${patientAppointment.doctor}.`,
          isHtml: false,
          tool: 'patient_specialty_lookup',
          route: 'tool',
          suggestedAction: 'Puedes pedirme también la hora, estado o doctor de ese paciente.',
        };
      }
    }

    if (askSpecialtyCounts) {
      return {
        response: this.buildSpecialtyCountsTableHtml(appointments),
        isHtml: true,
        tool: 'specialty_counts_table',
        route: 'tool',
        suggestedAction: 'Úsalo para ver carga operativa por especialidad.',
      };
    }

    if ((askTable && askDoctor) || lower.includes('citas por especialidad')) {
      return {
        response: this.buildSpecialtyDoctorTableHtml(appointments),
        isHtml: true,
        tool: 'table_by_specialty_doctor',
        route: 'tool',
        suggestedAction: 'Revisa las filas con mayor cantidad para balancear carga por médico.',
      };
    }

    if (askChart && !askStatusChart && !askSpecialtyChart) {
      return {
        response: this.buildStatusChartHtml(atendidas, enEspera, reagendadas, total),
        isHtml: true,
        tool: 'default_chart',
        route: 'tool',
        suggestedAction: 'Si quieres otra visualización, dime: gráfica por especialidad o gráfica de estados.',
      };
    }

    if (askSpecialtyChart && !askStatusChart) {
      return {
        response: lower.includes('circular')
          ? this.buildSpecialtyPieChartHtml(appointments)
          : this.buildSpecialtyBarChartHtml(appointments),
        isHtml: true,
        tool: 'specialty_chart',
        route: 'tool',
        suggestedAction: 'Compara la carga por especialidad para balancear agenda y consultorios.',
      };
    }

    if (askStatusChart) {
      return {
        response: this.buildStatusChartHtml(atendidas, enEspera, reagendadas, total),
        isHtml: true,
        tool: 'status_chart',
        route: 'tool',
        suggestedAction: 'Prioriza pacientes en espera de signos vitales para reducir atrasos.',
      };
    }

    if (askTable) {
      return {
        response: this.buildSummaryTableHtml(atendidas, enEspera, reagendadas, total),
        isHtml: true,
        tool: 'summary_table',
        route: 'tool',
        suggestedAction: 'Usa este resumen para validar cuellos de botella en tiempo real.',
      };
    }

    const specialtyTarget = this.extractSpecialtyTarget(
      message,
      recentUserMessages,
      Array.from(new Set(appointments.map((a) => a.especialidad))),
    );

    if (specialtyTarget && askPatientNames) {
      const patients = appointments
        .filter((a) => this.normalizeText(a.especialidad) === specialtyTarget.normalized)
        .map((a) => a.paciente);

      return {
        response:
          patients.length === 0
            ? `Hoy no hay pacientes agendados en ${specialtyTarget.label}.`
            : `Pacientes de ${specialtyTarget.label}: ${patients.join(', ')}.`,
        isHtml: false,
        tool: 'patients_by_specialty',
        route: 'tool',
        suggestedAction:
          patients.length === 0
            ? 'Verifica si hay reasignaciones pendientes para esa especialidad.'
            : 'Coordina preparación de consultorio para esos pacientes.',
      };
    }

    const askCount = this.isCountIntent(lower, previousMessages, currentIntent, previousIntent);
    if (specialtyTarget && askCount) {
      const count = appointments.filter(
        (a) => this.normalizeText(a.especialidad) === specialtyTarget.normalized,
      ).length;
      return {
        response: `Hoy hay ${count} cita(s) en ${specialtyTarget.label}.`,
        isHtml: false,
        tool: 'count_by_specialty',
        route: 'tool',
        suggestedAction:
          count > 0
            ? 'Si hay pacientes por llegar, confirma el área de preparación para esta especialidad.'
            : 'No se requieren acciones inmediatas para esa especialidad.',
      };
    }

    const doctorMatch = this.extractMatchingValue(
      lower,
      Array.from(new Set(appointments.map((a) => a.doctor))),
    );
    if (doctorMatch && askCount) {
      const count = appointments.filter(
        (a) => this.normalizeText(a.doctor) === this.normalizeText(doctorMatch),
      ).length;
      return {
        response: `Hoy el Dr. ${doctorMatch} tiene ${count} cita(s) asignadas.`,
        isHtml: false,
        tool: 'count_by_doctor',
        route: 'tool',
        suggestedAction: 'Monitorea continuidad del flujo del doctor para evitar solapamientos.',
      };
    }

    if (lower.includes('estado actual') || lower.includes('como vamos') || lower.includes('cómo vamos')) {
      return {
        response:
          `Estado actual: ${atendidas} en atención/listas, ${enEspera} en área de preparación y ${reagendadas} reagendadas (total: ${total}).`,
        isHtml: false,
        tool: 'operational_summary',
        route: 'tool',
        suggestedAction: 'Atiende primero las colas activas para mantener puntualidad.',
      };
    }

    return null;
  }

  private zoeDeterministicReply(
    message: string,
    appointments: Array<{ paciente: string; especialidad: string; estado: string; doctor: string; reagendada: string | null }>,
    recentUserMessages: string[],
  ): { response: string; isHtml: boolean } | null {
    const lower = this.normalizeText(message);
    const previousMessagesNormalized = recentUserMessages.map((item) => this.normalizeText(item));
    const currentIntent = this.detectUserIntent(lower);
    const previousIntent = this.detectIntentFromHistory(previousMessagesNormalized);
    const total = appointments.length;
    const atendidas = appointments.filter(
      (a) => a.estado === 'Iniciada' || a.estado === 'Lista para consulta',
    ).length;
    const reagendadas = appointments.filter((a) => a.estado === 'Reagendada').length;
    const enEspera = appointments.filter((a) => a.estado === 'En espera de signos vitales').length;

    if (this.isGreetingMessage(lower)) {
      return {
        response:
          `Hola. Soy Zoe, tu asistente de citas médicas. Hoy tengo ${total} cita(s) registradas. ¿Qué quieres consultar?`,
        isHtml: false,
      };
    }

    if (this.isIdentityQuestion(lower)) {
      return {
        response:
          'Soy Zoe. Mi nombre significa "vida" y mi función es darte respuestas operativas sobre citas médicas en tiempo real.',
        isHtml: false,
      };
    }

    const askTable = lower.includes('tabla') || lower.includes('resumen');
    const askDoctor = lower.includes('doctor') || lower.includes('medico') || lower.includes('médico');
    const askChart =
      lower.includes('grafico') ||
      lower.includes('grafica') ||
      lower.includes('gráfico') ||
      lower.includes('gráfica') ||
      lower.includes('circular') ||
      lower.includes('barra');
    const askStatusChart =
      askChart &&
      (lower.includes('estado') ||
        lower.includes('signos') ||
        lower.includes('reagend') ||
        lower.includes('listas'));
    const askOnlyDoctors =
      lower.includes('solo los doctores') ||
      lower.includes('nombres de doctores') ||
      lower.includes('nombres de los doctores') ||
      lower.includes('que doctores estan atendiendo') ||
      lower.includes('qué doctores están atendiendo') ||
      lower.includes('que doctores atienden') ||
      lower.includes('qué doctores atienden') ||
      lower === 'doctores' ||
      lower === 'doctor';
    const askSpecialtyChart =
      askChart &&
      (lower.includes('especialidad') ||
        lower.includes('especialidades') ||
        lower.includes('consultas') ||
        lower.includes('citas'));
    const askSpecialtyCounts =
      lower.includes('consultas por especialidad') ||
      lower.includes('citas por especialidad') ||
      lower.includes('cantidad de consultas por especialidad') ||
      lower.includes('cantidad de citas por especialidad') ||
      lower.includes('especialidad y consultas') ||
      lower.includes('especialidad y citas');
    const askPatientsBySpecialty =
      lower.includes('pacientes por especialidad') ||
      lower.includes('a que especialidades vienen') ||
      lower.includes('a que especialidad vienen') ||
      lower.includes('especialidades vienen');

    if (askOnlyDoctors) {
      return {
        response: this.buildDoctorsListHtml(appointments),
        isHtml: true,
      };
    }

    if (askPatientsBySpecialty) {
      return {
        response: this.buildPatientsBySpecialtyHtml(appointments),
        isHtml: true,
      };
    }

    const patientMatch = this.extractMatchingValue(
      lower,
      Array.from(new Set(appointments.map((a) => a.paciente))),
    );
    const askPatientSpecialty =
      Boolean(patientMatch) &&
      (lower.includes('especialidad') || lower.includes('asiste') || lower.includes('viene'));

    if (patientMatch && askPatientSpecialty) {
      const patientAppointment = appointments.find(
        (a) => this.normalizeText(a.paciente) === this.normalizeText(patientMatch),
      );

      if (patientAppointment) {
        return {
          response: `${patientAppointment.paciente} asiste a ${patientAppointment.especialidad} con el Dr. ${patientAppointment.doctor}.`,
          isHtml: false,
        };
      }
    }

    if (askSpecialtyCounts) {
      return {
        response: this.buildSpecialtyCountsTableHtml(appointments),
        isHtml: true,
      };
    }

    if ((askTable && askDoctor) || lower.includes('citas por especialidad')) {
      return {
        response: this.buildSpecialtyDoctorTableHtml(appointments),
        isHtml: true,
      };
    }

    if (askChart && !askStatusChart && !askSpecialtyChart) {
      return {
        response: this.buildStatusChartHtml(atendidas, enEspera, reagendadas, total),
        isHtml: true,
      };
    }

    if (askSpecialtyChart && !askStatusChart) {
      return {
        response: lower.includes('circular')
          ? this.buildSpecialtyPieChartHtml(appointments)
          : this.buildSpecialtyBarChartHtml(appointments),
        isHtml: true,
      };
    }

    if (askStatusChart) {
      return {
        response: this.buildStatusChartHtml(atendidas, enEspera, reagendadas, total),
        isHtml: true,
      };
    }

    if (askTable) {
      return {
        response: this.buildSummaryTableHtml(atendidas, enEspera, reagendadas, total),
        isHtml: true,
      };
    }

    const specialtyTarget = this.extractSpecialtyTarget(
      message,
      recentUserMessages,
      Array.from(new Set(appointments.map((a) => a.especialidad))),
    );
    const askCount = this.isCountIntent(
      lower,
      previousMessagesNormalized,
      currentIntent,
      previousIntent,
    );
    const askPatientNames = currentIntent === 'patients';

    if (specialtyTarget && askCount) {
      const count = appointments.filter(
        (a) => this.normalizeText(a.especialidad) === specialtyTarget.normalized,
      ).length;
      return {
        response: `Hoy hay ${count} cita(s) en ${specialtyTarget.label}.`,
        isHtml: false,
      };
    }

    if (specialtyTarget && askPatientNames) {
      const patients = appointments
        .filter((a) => this.normalizeText(a.especialidad) === specialtyTarget.normalized)
        .map((a) => a.paciente);

      if (patients.length === 0) {
        return {
          response: `Hoy no hay pacientes agendados en ${specialtyTarget.label}.`,
          isHtml: false,
        };
      }

      return {
        response: `Pacientes de ${specialtyTarget.label}: ${patients.join(', ')}.`,
        isHtml: false,
      };
    }

    const doctorMatch = this.extractMatchingValue(
      lower,
      Array.from(new Set(appointments.map((a) => a.doctor))),
    );
    if (doctorMatch && (lower.includes('cuantas') || lower.includes('cuántas') || lower.includes('total'))) {
      const count = appointments.filter(
        (a) => this.normalizeText(a.doctor) === this.normalizeText(doctorMatch),
      ).length;
      return {
        response: `Hoy el Dr. ${doctorMatch} tiene ${count} cita(s) asignadas.`,
        isHtml: false,
      };
    }

    if (lower.includes('estado actual') || lower.includes('como vamos') || lower.includes('cómo vamos')) {
      return {
        response:
          `Estado actual: ${atendidas} en atención/listas, ${enEspera} esperando signos vitales y ${reagendadas} reagendadas (total: ${total}).`,
        isHtml: false,
      };
    }

    return null;
  }

  private shouldUseLlmForMessage(message: string): boolean {
    const lower = this.normalizeText(message);

    const deepAnalysisKeywords = [
      'analiza',
      'analizar',
      'explica',
      'explicar',
      'justifica',
      'justificar',
      'compara',
      'comparar',
      'pronostica',
      'pronosticar',
      'estrategia',
      'optimiza',
      'optimizar',
      'recomendacion',
      'recomendación',
      'causa raiz',
      'causa raíz',
      'porque',
      'por qué',
    ];

    return deepAnalysisKeywords.some((keyword) => lower.includes(keyword));
  }

  private isIdentityQuestion(normalizedMessage: string): boolean {
    return (
      normalizedMessage.includes('quien eres') ||
      normalizedMessage.includes('como te llamas') ||
      normalizedMessage.includes('cual es tu nombre') ||
      normalizedMessage.includes('tu nombre')
    );
  }

  private isGreetingMessage(normalizedMessage: string): boolean {
    return (
      normalizedMessage === 'hola' ||
      normalizedMessage === 'hola zoe' ||
      normalizedMessage === 'buenos dias' ||
      normalizedMessage === 'buenas tardes' ||
      normalizedMessage === 'buenas noches' ||
      normalizedMessage.startsWith('hola ') ||
      normalizedMessage.includes('saludos')
    );
  }

  private isCountIntent(
    normalizedMessage: string,
    previousNormalizedMessages: string[],
    currentIntent: 'count' | 'patients' | null,
    previousIntent: 'count' | 'patients' | null,
  ): boolean {
    const hasCountKeywords =
      normalizedMessage.includes('cuantas') ||
      normalizedMessage.includes('cuantos') ||
      normalizedMessage.includes('total') ||
      normalizedMessage.includes('numero de citas') ||
      normalizedMessage.includes('cantidad de citas');

    if (hasCountKeywords || currentIntent === 'count') return true;

    const isSpecialtyFollowUp =
      normalizedMessage.startsWith('en ') || normalizedMessage.startsWith('de ');
    const previousHadCountIntent = previousNormalizedMessages.some(
      (msg) => msg.includes('cuantas') || msg.includes('cuantos') || msg.includes('total'),
    );

    return isSpecialtyFollowUp && (previousHadCountIntent || previousIntent === 'count');
  }

  private detectUserIntent(normalizedMessage: string): 'count' | 'patients' | null {
    const asksPatients =
      normalizedMessage.includes('nombre de los pacientes') ||
      normalizedMessage.includes('nombres de pacientes') ||
      normalizedMessage.includes('pacientes de') ||
      normalizedMessage.includes('pacientes en') ||
      normalizedMessage.includes('lista de pacientes') ||
      normalizedMessage.includes('quienes son los pacientes') ||
      normalizedMessage.includes('quienes estan en');
    if (asksPatients) return 'patients';

    const asksCount =
      normalizedMessage.includes('cuantas') ||
      normalizedMessage.includes('cuantos') ||
      normalizedMessage.includes('total') ||
      normalizedMessage.includes('numero de citas') ||
      normalizedMessage.includes('cantidad de citas') ||
      normalizedMessage.includes('cuantas citas hay') ||
      normalizedMessage.includes('cuantas hay');
    if (asksCount) return 'count';

    return null;
  }

  private detectIntentFromHistory(
    previousNormalizedMessages: string[],
  ): 'count' | 'patients' | null {
    for (const msg of previousNormalizedMessages) {
      const intent = this.detectUserIntent(msg);
      if (intent) return intent;
    }

    return null;
  }

  private extractSpecialtyTarget(
    message: string,
    recentUserMessages: string[],
    specialties: string[],
  ): { label: string; normalized: string } | null {
    const normalizedMessage = this.normalizeText(message);

    const matched = this.extractMatchingValue(normalizedMessage, specialties);
    if (matched) {
      return { label: matched, normalized: this.normalizeText(matched) };
    }

    const rawCandidate =
      this.extractSpecialtyPhrase(message) ??
      recentUserMessages
        .map((msg) => this.extractSpecialtyPhrase(msg))
        .find((value): value is string => Boolean(value));
    if (!rawCandidate) return null;

    const normalizedCandidate = this.normalizeText(rawCandidate);
    const existing = specialties.find((s) => this.normalizeText(s) === normalizedCandidate);

    if (existing) {
      return { label: existing, normalized: normalizedCandidate };
    }

    return {
      label: rawCandidate,
      normalized: normalizedCandidate,
    };
  }

  private extractSpecialtyPhrase(text: string): string | null {
    const match = text.match(/\b(?:en|de)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]+)\??\s*$/i);
    if (!match) return null;

    const value = match[1].trim().replace(/\s+/g, ' ');
    const normalized = this.normalizeText(value);
    if (
      normalized.includes('pacientes de hoy') ||
      normalized.includes('citas de hoy') ||
      normalized === 'hoy' ||
      normalized === 'los pacientes de hoy' ||
      normalized === 'las citas de hoy'
    ) {
      return null;
    }
    return value.length >= 3 ? value : null;
  }

  private findRecentUserMessages(history: unknown[], limit: number): string[] {
    const result: string[] = [];

    for (let index = history.length - 1; index >= 0 && result.length < limit; index -= 1) {
      const item = history[index];
      if (!item || typeof item !== 'object') continue;

      const role = (item as { role?: unknown }).role;
      const content = (item as { content?: unknown }).content;
      if (role === 'user' && typeof content === 'string' && content.trim()) {
        result.push(content.trim());
      }
    }

    return result;
  }

  private normalizeText(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  private buildZoeLlmConfigs(): ZoeLlmConfig[] {
    const configs: ZoeLlmConfig[] = [];

    const premiumUrl = process.env.ZOE_PREMIUM_LLM_URL ?? '';
    const premiumModel = process.env.ZOE_PREMIUM_LLM_MODEL ?? '';
    if (premiumUrl && premiumModel) {
      configs.push({
        name: 'premium',
        url: premiumUrl,
        apiKey: process.env.ZOE_PREMIUM_LLM_API_KEY ?? '',
        model: premiumModel,
        timeoutMs: this.readPositiveIntEnv('ZOE_PREMIUM_CHAT_TIMEOUT_MS', 9000),
      });
    }

    const localUrl = process.env.RECOMMENDATION_LLM_URL ?? '';
    const localModel = process.env.RECOMMENDATION_LLM_MODEL ?? '';
    if (localUrl && localModel) {
      configs.push({
        name: 'local',
        url: localUrl,
        apiKey: process.env.RECOMMENDATION_LLM_API_KEY ?? '',
        model: localModel,
        timeoutMs: this.readPositiveIntEnv('ZOE_CHAT_TIMEOUT_MS', 7000),
      });
    }

    return configs;
  }

  private async requestZoeLlm(
    config: ZoeLlmConfig,
    systemPrompt: string,
    history: unknown[],
    message: string,
  ): Promise<{ response: string; isHtml: boolean }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (config.apiKey) {
        headers.Authorization = `Bearer ${config.apiKey}`;
      }

      const response = await fetch(config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...history,
            { role: 'user', content: message },
          ],
          temperature: 0.2,
          max_tokens: 700,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data.choices?.[0]?.message?.content?.trim() ?? '';
      if (!content) {
        throw new Error('Empty LLM response');
      }

      const htmlMatch = content.match(/<<<HTML>>>([\s\S]*?)<<<END_HTML>>>/);
      if (htmlMatch) {
        return { response: htmlMatch[1].trim(), isHtml: true };
      }

      return { response: content, isHtml: false };
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  private extractMatchingValue(input: string, candidates: string[]): string | null {
    const normalizedInput = this.normalizeText(input);

    for (const candidate of candidates) {
      const normalizedCandidate = this.normalizeText(candidate);
      if (!normalizedCandidate) continue;
      if (normalizedInput.includes(normalizedCandidate)) {
        return candidate;
      }
    }

    return null;
  }

  private buildSummaryTableHtml(
    atendidas: number,
    enEspera: number,
    reagendadas: number,
    total: number,
  ): string {
    return `
<style>
  .zoe-card { background:#f0f9ff; border:1px solid #bae6fd; border-radius:12px; padding:12px; color:#0f172a; }
  .zoe-title { margin:0 0 8px; color:#0f766e; font-size:1.05rem; }
  .zoe-table { width:100%; border-collapse:collapse; font-size:0.92rem; }
  .zoe-table th, .zoe-table td { border-bottom:1px solid #dbeafe; padding:8px; text-align:left; }
  .zoe-table th { background:#e0f2fe; color:#1d4ed8; }
</style>
<div class="zoe-card">
  <h3 class="zoe-title">Resumen de citas del día</h3>
  <table class="zoe-table">
    <thead><tr><th>Indicador</th><th>Valor</th></tr></thead>
    <tbody>
      <tr><td>Total de citas</td><td>${total}</td></tr>
      <tr><td>En atención o listas</td><td>${atendidas}</td></tr>
      <tr><td>Esperando signos vitales</td><td>${enEspera}</td></tr>
      <tr><td>Reagendadas</td><td>${reagendadas}</td></tr>
    </tbody>
  </table>
</div>`;
  }

  private buildCapabilitiesCatalogHtml(): string {
    return `
<style>
  .zoe-card { background:#f8fafc; border:1px solid #cbd5e1; border-radius:12px; padding:14px; color:#0f172a; }
  .zoe-title { margin:0 0 10px; color:#1d4ed8; font-size:1.1rem; }
  .zoe-subtitle { margin:14px 0 6px; color:#0f766e; font-size:0.98rem; }
  .zoe-list { margin:0; padding-left:18px; }
  .zoe-list li { margin-bottom:4px; }
  .zoe-table { width:100%; border-collapse:collapse; margin-top:8px; font-size:0.9rem; }
  .zoe-table th, .zoe-table td { border-bottom:1px solid #e2e8f0; padding:8px; text-align:left; }
  .zoe-table th { background:#eff6ff; }
</style>
<div class="zoe-card">
  <h3 class="zoe-title">Catálogo Operativo de Zoe</h3>

  <h4 class="zoe-subtitle">Temas que puedo atender</h4>
  <ul class="zoe-list">
    <li>Pacientes del día y por especialidad</li>
    <li>Horarios y agenda completa (07:00 a 19:00 cada 30 min)</li>
    <li>Especialidades y carga de consultas</li>
    <li>Médicos y citas atendidas por médico</li>
    <li>Estados de citas (activa, revisión secretaria, espera signos, iniciada, reagendada)</li>
  </ul>

  <h4 class="zoe-subtitle">Preguntas que puedes hacer</h4>
  <table class="zoe-table">
    <thead><tr><th>Categoría</th><th>Ejemplos</th></tr></thead>
    <tbody>
      <tr><td>Pacientes</td><td>"nombres de los pacientes de hoy", "pacientes por especialidad", "a qué especialidad asiste Mario Vega"</td></tr>
      <tr><td>Horarios</td><td>"horarios", "agenda del día", "tabla de citas de hoy"</td></tr>
      <tr><td>Especialidades</td><td>"consultas por especialidad", "cantidad de citas por especialidad"</td></tr>
      <tr><td>Médicos</td><td>"doctores que están atendiendo", "citas por doctor", "atendidas por doctor"</td></tr>
      <tr><td>Estados</td><td>"estado actual", "citas reagendadas", "reagendadas por especialidad"</td></tr>
    </tbody>
  </table>

  <h4 class="zoe-subtitle">Gráficas disponibles</h4>
  <ul class="zoe-list">
    <li>Gráfica de barras por especialidad</li>
    <li>Gráfico circular por especialidad</li>
    <li>Gráfico circular de estados de citas</li>
    <li>Gráfica por defecto del estado del día si pides "una gráfica"</li>
  </ul>
</div>`;
  }

  private buildAppointmentsByDoctorTableHtml(
    appointments: Array<{ paciente: string; especialidad: string; estado: string; doctor: string; reagendada: string | null }>,
  ): string {
    const grouped = new Map<string, { doctor: string; total: number; especialidades: Set<string> }>();

    for (const item of appointments) {
      const current = grouped.get(item.doctor) ?? {
        doctor: item.doctor,
        total: 0,
        especialidades: new Set<string>(),
      };
      current.total += 1;
      current.especialidades.add(item.especialidad);
      grouped.set(item.doctor, current);
    }

    const rows = Array.from(grouped.values())
      .sort((a, b) => b.total - a.total)
      .map(
        (row) =>
          `<tr><td>Dr. ${row.doctor}</td><td>${Array.from(row.especialidades).join(', ')}</td><td>${row.total}</td></tr>`,
      )
      .join('');

    return `
<style>
  .zoe-card { background:#f8fafc; border:1px solid #cbd5e1; border-radius:12px; padding:12px; color:#0f172a; }
  .zoe-title { margin:0 0 8px; color:#1d4ed8; font-size:1.05rem; }
  .zoe-table { width:100%; border-collapse:collapse; font-size:0.9rem; }
  .zoe-table th, .zoe-table td { border-bottom:1px solid #e2e8f0; padding:8px; text-align:left; }
  .zoe-table th { background:#eff6ff; }
</style>
<div class="zoe-card">
  <h3 class="zoe-title">Citas por doctor</h3>
  <table class="zoe-table">
    <thead><tr><th>Médico</th><th>Especialidad</th><th>Total citas</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="3">No hay datos disponibles.</td></tr>'}</tbody>
  </table>
</div>`;
  }

  private buildAttendedByDoctorTableHtml(
    appointments: Array<{ paciente: string; especialidad: string; estado: string; doctor: string; reagendada: string | null }>,
  ): string {
    const attendedStates = new Set(['Iniciada', 'Lista para consulta', 'Completada']);
    const grouped = new Map<string, { doctor: string; atendidas: number; total: number }>();

    for (const item of appointments) {
      const current = grouped.get(item.doctor) ?? {
        doctor: item.doctor,
        atendidas: 0,
        total: 0,
      };
      current.total += 1;
      if (attendedStates.has(item.estado)) {
        current.atendidas += 1;
      }
      grouped.set(item.doctor, current);
    }

    const rows = Array.from(grouped.values())
      .sort((a, b) => b.atendidas - a.atendidas)
      .map(
        (row) =>
          `<tr><td>Dr. ${row.doctor}</td><td>${row.atendidas}</td><td>${row.total}</td></tr>`,
      )
      .join('');

    return `
<style>
  .zoe-card { background:#f8fafc; border:1px solid #cbd5e1; border-radius:12px; padding:12px; color:#0f172a; }
  .zoe-title { margin:0 0 8px; color:#1d4ed8; font-size:1.05rem; }
  .zoe-table { width:100%; border-collapse:collapse; font-size:0.9rem; }
  .zoe-table th, .zoe-table td { border-bottom:1px solid #e2e8f0; padding:8px; text-align:left; }
  .zoe-table th { background:#eff6ff; }
</style>
<div class="zoe-card">
  <h3 class="zoe-title">Consultas atendidas por doctor</h3>
  <table class="zoe-table">
    <thead><tr><th>Médico</th><th>Atendidas</th><th>Total citas</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="3">No hay datos disponibles.</td></tr>'}</tbody>
  </table>
</div>`;
  }

  private buildRescheduledTableHtml(
    appointments: Array<{ paciente: string; especialidad: string; estado: string; doctor: string; reagendada: string | null }>,
  ): string {
    const rows = appointments
      .filter((item) => item.estado === 'Reagendada' || item.reagendada)
      .map(
        (item) =>
          `<tr><td>${item.paciente}</td><td>${item.especialidad}</td><td>Dr. ${item.doctor}</td><td>${item.reagendada ? new Date(item.reagendada).toLocaleString('es-CR') : 'Pendiente'}</td></tr>`,
      )
      .join('');

    return `
<style>
  .zoe-card { background:#f8fafc; border:1px solid #cbd5e1; border-radius:12px; padding:12px; color:#0f172a; }
  .zoe-title { margin:0 0 8px; color:#1d4ed8; font-size:1.05rem; }
  .zoe-table { width:100%; border-collapse:collapse; font-size:0.9rem; }
  .zoe-table th, .zoe-table td { border-bottom:1px solid #e2e8f0; padding:8px; text-align:left; }
  .zoe-table th { background:#eff6ff; }
</style>
<div class="zoe-card">
  <h3 class="zoe-title">Citas reagendadas</h3>
  <table class="zoe-table">
    <thead><tr><th>Paciente</th><th>Especialidad</th><th>Médico</th><th>Nuevo horario</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">No hay citas reagendadas actualmente.</td></tr>'}</tbody>
  </table>
</div>`;
  }

  private buildTodayAppointmentsTableHtml(appointments: ZoeAppointmentView[]): string {
    const rows = appointments
      .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime())
      .map(
        (a) =>
          `<tr><td>${new Date(a.inicio).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}</td><td>${a.paciente}</td><td>${a.especialidad}</td><td>Dr. ${a.doctor}</td><td>${a.estado}</td></tr>`,
      )
      .join('');

    return `
<style>
  .zoe-card { background:#f8fafc; border:1px solid #cbd5e1; border-radius:12px; padding:12px; color:#0f172a; }
  .zoe-title { margin:0 0 8px; color:#1d4ed8; font-size:1.05rem; }
  .zoe-table { width:100%; border-collapse:collapse; font-size:0.9rem; }
  .zoe-table th, .zoe-table td { border-bottom:1px solid #e2e8f0; padding:8px; text-align:left; }
  .zoe-table th { background:#eff6ff; }
</style>
<div class="zoe-card">
  <h3 class="zoe-title">Citas de hoy</h3>
  <table class="zoe-table">
    <thead><tr><th>Hora</th><th>Paciente</th><th>Especialidad</th><th>Médico</th><th>Estado</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5">No hay citas agendadas hoy.</td></tr>'}</tbody>
  </table>
</div>`;
  }

  private buildSpecialtyDoctorTableHtml(
    appointments: Array<{ paciente: string; especialidad: string; estado: string; doctor: string; reagendada: string | null }>,
  ): string {
    const grouped = new Map<string, { especialidad: string; doctor: string; total: number; reagendadas: number }>();

    for (const item of appointments) {
      const key = `${item.especialidad}::${item.doctor}`;
      const current = grouped.get(key) ?? {
        especialidad: item.especialidad,
        doctor: item.doctor,
        total: 0,
        reagendadas: 0,
      };
      current.total += 1;
      if (item.estado === 'Reagendada' || item.reagendada) current.reagendadas += 1;
      grouped.set(key, current);
    }

    const rows = Array.from(grouped.values())
      .sort((a, b) => b.total - a.total)
      .map(
        (r) =>
          `<tr><td>${r.especialidad}</td><td>Dr. ${r.doctor}</td><td>${r.total}</td><td>${r.reagendadas}</td></tr>`,
      )
      .join('');

    return `
<style>
  .zoe-card { background:#f8fafc; border:1px solid #cbd5e1; border-radius:12px; padding:12px; color:#0f172a; }
  .zoe-title { margin:0 0 8px; color:#1d4ed8; font-size:1.05rem; }
  .zoe-table { width:100%; border-collapse:collapse; font-size:0.9rem; }
  .zoe-table th, .zoe-table td { border-bottom:1px solid #e2e8f0; padding:8px; text-align:left; }
  .zoe-table th { background:#eff6ff; }
</style>
<div class="zoe-card">
  <h3 class="zoe-title">Citas por especialidad y médico</h3>
  <table class="zoe-table">
    <thead><tr><th>Especialidad</th><th>Médico</th><th>Total citas</th><th>Reagendadas</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">No hay datos disponibles.</td></tr>'}</tbody>
  </table>
</div>`;
  }

  private buildDoctorsListHtml(
    appointments: Array<{ paciente: string; especialidad: string; estado: string; doctor: string; reagendada: string | null }>,
  ): string {
    const grouped = new Map<string, { doctor: string; especialidades: Set<string>; pacientes: number }>();

    for (const item of appointments) {
      const current = grouped.get(item.doctor) ?? {
        doctor: item.doctor,
        especialidades: new Set<string>(),
        pacientes: 0,
      };
      current.especialidades.add(item.especialidad);
      current.pacientes += 1;
      grouped.set(item.doctor, current);
    }

    const rows = Array.from(grouped.values())
      .sort((a, b) => a.doctor.localeCompare(b.doctor))
      .map(
        (r) =>
          `<tr><td>Dr. ${r.doctor}</td><td>${Array.from(r.especialidades).join(', ')}</td><td>${r.pacientes}</td></tr>`,
      )
      .join('');

    return `
<style>
  .zoe-card { background:#f8fafc; border:1px solid #cbd5e1; border-radius:12px; padding:12px; color:#0f172a; }
  .zoe-title { margin:0 0 8px; color:#1d4ed8; font-size:1.05rem; }
  .zoe-table { width:100%; border-collapse:collapse; font-size:0.9rem; }
  .zoe-table th, .zoe-table td { border-bottom:1px solid #e2e8f0; padding:8px; text-align:left; }
  .zoe-table th { background:#eff6ff; }
</style>
<div class="zoe-card">
  <h3 class="zoe-title">Doctores que están atendiendo</h3>
  <table class="zoe-table">
    <thead><tr><th>Médico</th><th>Especialidad</th><th>Citas hoy</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="3">No hay doctores con citas activas.</td></tr>'}</tbody>
  </table>
</div>`;
  }

  private buildSpecialtyBarChartHtml(
    appointments: Array<{ paciente: string; especialidad: string; estado: string; doctor: string; reagendada: string | null }>,
  ): string {
    const counts = new Map<string, number>();

    for (const item of appointments) {
      counts.set(item.especialidad, (counts.get(item.especialidad) ?? 0) + 1);
    }

    const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const max = Math.max(...entries.map(([, count]) => count), 1);
    const bars = entries
      .map(([especialidad, count]) => {
        const width = Math.round((count / max) * 100);
        return `
          <div class="zoe-bar-row">
            <div class="zoe-bar-label">${especialidad}</div>
            <div class="zoe-bar-track"><div class="zoe-bar-fill" style="width:${width}%">${count}</div></div>
          </div>`;
      })
      .join('');

    return `
<style>
  .zoe-chart-card { background:#f8fafc; border:1px solid #cbd5e1; border-radius:12px; padding:14px; color:#0f172a; }
  .zoe-chart-title { margin:0 0 10px; color:#1d4ed8; font-size:1.05rem; }
  .zoe-bar-row { display:grid; grid-template-columns: 180px 1fr; gap:10px; align-items:center; margin-bottom:10px; }
  .zoe-bar-label { font-size:0.92rem; }
  .zoe-bar-track { background:#e2e8f0; border-radius:999px; height:24px; overflow:hidden; }
  .zoe-bar-fill { background:#2563eb; color:white; height:100%; display:flex; align-items:center; justify-content:flex-end; padding:0 8px; font-weight:600; min-width:36px; }
</style>
<div class="zoe-chart-card">
  <h3 class="zoe-chart-title">Gráfica de barras de consultas por especialidad</h3>
  ${bars || '<p>No hay citas cargadas para graficar.</p>'}
</div>`;
  }

  private buildSpecialtyCountsTableHtml(
    appointments: Array<{ paciente: string; especialidad: string; estado: string; doctor: string; reagendada: string | null }>,
  ): string {
    const grouped = new Map<string, { especialidad: string; total: number; pacientes: string[] }>();

    for (const item of appointments) {
      const current = grouped.get(item.especialidad) ?? {
        especialidad: item.especialidad,
        total: 0,
        pacientes: [],
      };
      current.total += 1;
      current.pacientes.push(item.paciente);
      grouped.set(item.especialidad, current);
    }

    const rows = Array.from(grouped.values())
      .sort((a, b) => b.total - a.total)
      .map(
        (row) =>
          `<tr><td>${row.especialidad}</td><td>${row.total}</td><td>${row.pacientes.join(', ')}</td></tr>`,
      )
      .join('');

    return `
<style>
  .zoe-card { background:#f8fafc; border:1px solid #cbd5e1; border-radius:12px; padding:12px; color:#0f172a; }
  .zoe-title { margin:0 0 8px; color:#1d4ed8; font-size:1.05rem; }
  .zoe-table { width:100%; border-collapse:collapse; font-size:0.9rem; }
  .zoe-table th, .zoe-table td { border-bottom:1px solid #e2e8f0; padding:8px; text-align:left; }
  .zoe-table th { background:#eff6ff; }
</style>
<div class="zoe-card">
  <h3 class="zoe-title">Cantidad de consultas por especialidad</h3>
  <table class="zoe-table">
    <thead><tr><th>Especialidad</th><th>Consultas</th><th>Pacientes</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="3">No hay datos disponibles.</td></tr>'}</tbody>
  </table>
</div>`;
  }

  private buildPatientsBySpecialtyHtml(
    appointments: Array<{ paciente: string; especialidad: string; estado: string; doctor: string; reagendada: string | null }>,
  ): string {
    const grouped = new Map<string, string[]>();

    for (const item of appointments) {
      const current = grouped.get(item.especialidad) ?? [];
      current.push(item.paciente);
      grouped.set(item.especialidad, current);
    }

    const rows = Array.from(grouped.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(
        ([especialidad, pacientes]) =>
          `<tr><td>${especialidad}</td><td>${pacientes.join(', ')}</td><td>${pacientes.length}</td></tr>`,
      )
      .join('');

    return `
<style>
  .zoe-card { background:#f8fafc; border:1px solid #cbd5e1; border-radius:12px; padding:12px; color:#0f172a; }
  .zoe-title { margin:0 0 8px; color:#1d4ed8; font-size:1.05rem; }
  .zoe-table { width:100%; border-collapse:collapse; font-size:0.9rem; }
  .zoe-table th, .zoe-table td { border-bottom:1px solid #e2e8f0; padding:8px; text-align:left; }
  .zoe-table th { background:#eff6ff; }
</style>
<div class="zoe-card">
  <h3 class="zoe-title">Pacientes por especialidad</h3>
  <table class="zoe-table">
    <thead><tr><th>Especialidad</th><th>Pacientes</th><th>Total</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="3">No hay pacientes agendados.</td></tr>'}</tbody>
  </table>
</div>`;
  }

  private buildSpecialtyPieChartHtml(
    appointments: Array<{ paciente: string; especialidad: string; estado: string; doctor: string; reagendada: string | null }>,
  ): string {
    const grouped = new Map<string, number>();

    for (const item of appointments) {
      grouped.set(item.especialidad, (grouped.get(item.especialidad) ?? 0) + 1);
    }

    const entries = Array.from(grouped.entries());
    const total = entries.reduce((sum, [, count]) => sum + count, 0) || 1;
    const colors = ['#2563eb', '#0f766e', '#f59e0b', '#7c3aed', '#ef4444'];
    let accumulated = 0;
    const segments = entries
      .map(([especialidad, count], index) => {
        const start = accumulated;
        const percentage = Math.round((count / total) * 100);
        accumulated += percentage;
        return {
          especialidad,
          count,
          color: colors[index % colors.length],
          start,
          end: accumulated,
          percentage,
        };
      });

    const gradient = segments.length
      ? segments
          .map((segment) => `${segment.color} ${segment.start}% ${segment.end}%`)
          .join(', ')
      : '#cbd5e1 0 100%';

    const legend = segments
      .map(
        (segment) =>
          `<div class="item"><span class="dot" style="background:${segment.color}"></span>${segment.especialidad}: ${segment.count} (${segment.percentage}%)</div>`,
      )
      .join('');

    return `
<style>
  .zoe-chart-card { background:#f8fafc; border:1px solid #cbd5e1; border-radius:12px; padding:14px; color:#0f172a; }
  .zoe-chart-title { margin:0 0 10px; color:#1d4ed8; font-size:1.05rem; }
  .pie { width:180px; height:180px; border-radius:50%; margin:0 auto 12px; background: conic-gradient(${gradient}); border: 2px solid #cbd5e1; }
  .legend { display:grid; gap:6px; font-size:0.92rem; }
  .item { display:flex; align-items:center; gap:8px; }
  .dot { width:12px; height:12px; border-radius:50%; }
</style>
<div class="zoe-chart-card">
  <h3 class="zoe-chart-title">Gráfico circular de consultas por especialidad</h3>
  <div class="pie" aria-label="Grafico circular por especialidad"></div>
  <div class="legend">${legend || '<div class="item">No hay datos disponibles.</div>'}</div>
</div>`;
  }

  private buildStatusChartHtml(
    atendidas: number,
    enEspera: number,
    reagendadas: number,
    total: number,
  ): string {
    const safeTotal = total > 0 ? total : 1;
    const pAtendidas = Math.round((atendidas / safeTotal) * 100);
    const pEspera = Math.round((enEspera / safeTotal) * 100);
    const pReag = Math.max(0, 100 - pAtendidas - pEspera);

    return `
<style>
  .zoe-chart-card { background:#f0f9ff; border:1px solid #bae6fd; border-radius:12px; padding:14px; color:#0f172a; }
  .zoe-chart-title { margin:0 0 10px; color:#0f766e; font-size:1.05rem; }
  .pie { width:180px; height:180px; border-radius:50%; margin:0 auto 12px;
    background: conic-gradient(#16a34a 0 ${pAtendidas}%, #0ea5e9 ${pAtendidas}% ${pAtendidas + pEspera}%, #ef4444 ${pAtendidas + pEspera}% 100%);
    border: 2px solid #cbd5e1;
  }
  .legend { display:grid; gap:6px; font-size:0.92rem; }
  .item { display:flex; align-items:center; gap:8px; }
  .dot { width:12px; height:12px; border-radius:50%; }
</style>
<div class="zoe-chart-card">
  <h3 class="zoe-chart-title">Gráfico circular de estado de citas</h3>
  <div class="pie" aria-label="Grafico circular de citas"></div>
  <div class="legend">
    <div class="item"><span class="dot" style="background:#16a34a"></span> Atendidas/Listas: ${atendidas} (${pAtendidas}%)</div>
    <div class="item"><span class="dot" style="background:#0ea5e9"></span> En espera de signos: ${enEspera} (${pEspera}%)</div>
    <div class="item"><span class="dot" style="background:#ef4444"></span> Reagendadas: ${reagendadas} (${pReag}%)</div>
  </div>
</div>`;
  }

  private async publishPush(event: AgentEvent): Promise<void> {
    const payload = JSON.stringify({
      title: this.toPlainText(this.pushTitle(event)),
      body: this.toPlainText(`${event.specialty}: ${event.actionText}`),
      tag: `${event.type}-${event.appointmentId}`,
      requireInteraction: event.type === 'pre_appointment_alert',
      event,
    });

    for (const [key, subscription] of this.pushSubscriptions.entries()) {
      try {
        await webpush.sendNotification(subscription, payload);
      } catch (error) {
        const statusCode = this.extractStatusCode(error);

        if (statusCode === 404 || statusCode === 410) {
          this.pushSubscriptions.delete(key);
        }

        this.logger.log(
          'WEB_PUSH_SEND_FAILED',
          `No se pudo enviar push a un suscriptor. status=${statusCode ?? 'n/a'}`,
        );
      }
    }
  }

  private pushTitle(event: AgentEvent): string {
    if (event.type === 'pre_appointment_alert') {
      return `ALERTA PREVIA: ${event.patientName}`;
    }

    if (event.type === 'patient_call_to_doctor') {
      return `PASE CON MEDICO: ${event.patientName}`;
    }

    if (event.type === 'patient_arrived') {
      return `PACIENTE LLEGO: ${event.patientName}`;
    }

    if (event.type === 'secretary_review') {
      return `REVISION SECRETARIA: ${event.patientName}`;
    }

    if (event.type === 'vital_signs_completed') {
      return `SIGNOS COMPLETADOS: ${event.patientName}`;
    }

    if (event.type === 'appointment_rescheduled') {
      return `CITA REAGENDADA: ${event.patientName}`;
    }

    if (event.type === 'appointment_started') {
      return `CITA INICIADA: ${event.patientName}`;
    }

    if (event.type === 'agent_thinking') {
      return `AGENTE IA: Analizando...`;
    }

    if (event.type === 'agent_decision') {
      return `AGENTE IA: Decision tomada`;
    }

    return `RECOMENDACION IA: ${event.patientName}`;
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

  private subscriptionKey(subscription: StoredPushSubscription): string {
    return JSON.stringify({
      endpoint: subscription.endpoint,
      keys: subscription.keys,
    });
  }

  private extractStatusCode(error: unknown): number | null {
    if (!error || typeof error !== 'object') return null;
    const maybeStatusCode = (error as { statusCode?: unknown }).statusCode;
    return typeof maybeStatusCode === 'number' ? maybeStatusCode : null;
  }

  private parseFeedbackOutcome(value: unknown): RecommendationFeedbackOutcome | null {
    if (value === 'accepted' || value === 'ignored' || value === 'false_alarm') {
      return value;
    }

    return null;
  }

  private readPositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      this.logger.log('UI_CONFIG_INVALID', `Valor invalido para ${name}=${raw}. Usando ${fallback}.`);
      return fallback;
    }

    return Math.round(parsed);
  }

  private parseSubscription(body: unknown): StoredPushSubscription {
    if (!body || typeof body !== 'object') {
      throw new Error('El cuerpo debe ser un objeto JSON.');
    }

    const candidate = body as {
      endpoint?: unknown;
      expirationTime?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
    };

    if (typeof candidate.endpoint !== 'string' || !candidate.endpoint) {
      throw new Error('endpoint invalido.');
    }

    if (!candidate.keys || typeof candidate.keys !== 'object') {
      throw new Error('keys invalido.');
    }

    if (typeof candidate.keys.p256dh !== 'string' || typeof candidate.keys.auth !== 'string') {
      throw new Error('keys.p256dh/auth invalidos.');
    }

    return {
      endpoint: candidate.endpoint,
      expirationTime:
        candidate.expirationTime == null
          ? null
          : (candidate.expirationTime as number | null),
      keys: {
        p256dh: candidate.keys.p256dh,
        auth: candidate.keys.auth,
      },
    };
  }

  private async readJsonBody(req: IncomingMessage): Promise<unknown> {
    const chunks: string[] = [];

    await new Promise<void>((resolve, reject) => {
      req.setEncoding('utf8');
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve());
      req.on('error', (error) => reject(error));
    });

    const raw = chunks.join('').trim();
    if (!raw) return {};

    return JSON.parse(raw) as unknown;
  }

  private async handleSynthesizeSpeech(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = (await this.readJsonBody(req)) as { text?: unknown };
      const text = typeof body.text === 'string' ? body.text.trim() : '';

      if (!text) {
        this.sendJson(res, 400, { message: 'text es requerido.' });
        return;
      }

      const normalizedText = text.slice(0, 260);
      const audio = await this.generateSpeechWav(normalizedText);

      res.statusCode = 200;
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.end(audio);
    } catch (error) {
      this.logger.log(
        'TTS_SYNTH_ERROR',
        error instanceof Error ? error.message : 'Error desconocido',
      );
      this.sendJson(res, 503, {
        message: 'No se pudo sintetizar audio en servidor.',
        error: error instanceof Error ? error.message : 'Error desconocido',
      });
    }
  }

  private async generateSpeechWav(text: string): Promise<Buffer> {
    const command = this.resolveTtsCommand();
    if (!command) {
      throw new Error('No se encontro motor TTS del sistema (piper/espeak-ng/espeak/pico2wave).');
    }

    const executable = command.executable ?? command.command;

    if (command.command === 'piper' || command.command === 'piper-tts') {
      return await this.generatePiperWav(text, executable, command.viaHost);
    }

    if (command.command === 'espeak-ng' || command.command === 'espeak') {
      const voice = process.env.TTS_ESPEAK_VOICE ?? 'es-la+f3';
      const speed = this.readPositiveIntEnv('TTS_ESPEAK_SPEED', 140);
      const pitch = this.readPositiveIntEnv('TTS_ESPEAK_PITCH', 42);
      const args = ['-v', voice, '-s', String(speed), '-p', String(pitch), '--stdout', text];
      return await this.runCommandCapture(executable, args, command.viaHost);
    }

    const tempFile = join(tmpdir(), `medical-agent-tts-${randomUUID()}.wav`);

    try {
      const args = this.buildTtsFileArgs(command.command, tempFile, text);
      await this.runCommand(executable, args, command.viaHost);
      return await readFile(tempFile);
    } finally {
      void unlink(tempFile).catch(() => {
        // Ignorar errores de limpieza de archivo temporal.
      });
    }
  }

  private resolveTtsCommand(): DetectedTtsCommand | null {
    if (this.detectedTtsCommand !== undefined) {
      return this.detectedTtsCommand;
    }

    const bundledPiper = this.findBundledPiperExecutable();
    const bundledModel = this.resolvePiperModelPath();
    if (bundledPiper && bundledModel) {
      const bundledProbe = spawnSync(bundledPiper, ['--help'], { encoding: 'utf8' });
      const bundledHelp = `${bundledProbe.stdout ?? ''}${bundledProbe.stderr ?? ''}`;
      if (!bundledProbe.error && this.isPiperTtsHelp(bundledHelp)) {
        this.detectedTtsCommand = {
          command: 'piper',
          executable: bundledPiper,
          viaHost: false,
        };
        this.logger.log('TTS_COMMAND_SELECTED', `Motor seleccionado: ${bundledPiper} (bundle del proyecto)`);
        return this.detectedTtsCommand;
      }
    }

    const explicitPiperBin = (process.env.TTS_PIPER_BIN ?? '').trim();
    if (explicitPiperBin) {
      const localProbe = spawnSync(explicitPiperBin, ['--help'], { encoding: 'utf8' });
      const localHelp = `${localProbe.stdout ?? ''}${localProbe.stderr ?? ''}`;
      if (!localProbe.error && this.isPiperTtsHelp(localHelp)) {
        this.detectedTtsCommand = {
          command: 'piper',
          executable: explicitPiperBin,
          viaHost: false,
        };
        this.logger.log('TTS_COMMAND_SELECTED', `Motor seleccionado: ${explicitPiperBin} (ruta explicita local)`);
        return this.detectedTtsCommand;
      }

      const hostProbe = spawnSync('flatpak-spawn', ['--host', explicitPiperBin, '--help'], { encoding: 'utf8' });
      const hostHelp = `${hostProbe.stdout ?? ''}${hostProbe.stderr ?? ''}`;
      if (!hostProbe.error && hostProbe.status === 0 && this.isPiperTtsHelp(hostHelp)) {
        this.detectedTtsCommand = {
          command: 'piper',
          executable: explicitPiperBin,
          viaHost: true,
        };
        this.logger.log('TTS_COMMAND_SELECTED', `Motor seleccionado: ${explicitPiperBin} (ruta explicita host)`);
        return this.detectedTtsCommand;
      }

      this.logger.log('TTS_PIPER_BIN_INVALID', `Ruta TTS_PIPER_BIN invalida o no compatible: ${explicitPiperBin}`);
    }

    const preferredEngine = (process.env.TTS_ENGINE ?? '').trim().toLowerCase();
    const defaultOrder: Array<'piper' | 'piper-tts' | 'pico2wave' | 'espeak-ng' | 'espeak'> = ['piper-tts', 'piper', 'pico2wave', 'espeak-ng', 'espeak'];
    const candidates: Array<'piper' | 'piper-tts' | 'espeak-ng' | 'espeak' | 'pico2wave'> = preferredEngine === 'piper' || preferredEngine === 'piper-tts'
      ? ['piper-tts', 'piper', 'pico2wave', 'espeak-ng', 'espeak']
      : preferredEngine === 'pico2wave'
        ? ['pico2wave', 'piper-tts', 'piper', 'espeak-ng', 'espeak']
        : preferredEngine === 'espeak' || preferredEngine === 'espeak-ng'
          ? ['espeak-ng', 'espeak', 'piper-tts', 'piper', 'pico2wave']
          : defaultOrder;

    for (const candidate of candidates) {
      const localProbe = spawnSync(candidate, ['--help'], { encoding: 'utf8' });
      const localHelp = `${localProbe.stdout ?? ''}${localProbe.stderr ?? ''}`;
      const localLooksLikePiperTts = candidate !== 'piper' && candidate !== 'piper-tts'
        ? true
        : this.isPiperTtsHelp(localHelp);

      if (!localProbe.error && localLooksLikePiperTts) {
        this.detectedTtsCommand = {
          command: candidate,
          viaHost: false,
        };
        this.logger.log('TTS_COMMAND_SELECTED', `Motor seleccionado: ${candidate} (local runtime)`);
        return this.detectedTtsCommand;
      }

      const hostProbe = spawnSync('flatpak-spawn', ['--host', candidate, '--help'], { encoding: 'utf8' });
      const hostHelp = `${hostProbe.stdout ?? ''}${hostProbe.stderr ?? ''}`;
      const hostLooksLikePiperTts = candidate !== 'piper' && candidate !== 'piper-tts'
        ? true
        : this.isPiperTtsHelp(hostHelp);

      if (!hostProbe.error && hostProbe.status === 0 && hostLooksLikePiperTts) {
        this.detectedTtsCommand = {
          command: candidate,
          viaHost: true,
        };
        this.logger.log('TTS_COMMAND_SELECTED', `Motor seleccionado: ${candidate} (host via flatpak-spawn)`);
        return this.detectedTtsCommand;
      }

      if ((candidate === 'piper' || candidate === 'piper-tts') && (localProbe.status === 0 || hostProbe.status === 0)) {
        this.logger.log('TTS_PIPER_INCOMPATIBLE', `Se detecto binario ${candidate} pero no es Piper TTS CLI compatible.`);
      }
    }

    this.detectedTtsCommand = null;
    return null;
  }

  private isPiperTtsHelp(helpText: string): boolean {
    const normalized = helpText.toLowerCase();
    return normalized.includes('--model') || normalized.includes('--output_file') || normalized.includes('--output-raw');
  }

  private buildTtsFileArgs(
    command: 'espeak-ng' | 'espeak' | 'pico2wave',
    outputFile: string,
    text: string,
  ): string[] {
    if (command === 'pico2wave') {
      const language = process.env.TTS_PICO_LANG ?? 'es-ES';
      return ['-l', language, '-w', outputFile, text];
    }

    const voice = process.env.TTS_ESPEAK_VOICE ?? 'es-la+f3';
    const speed = this.readPositiveIntEnv('TTS_ESPEAK_SPEED', 140);
    const pitch = this.readPositiveIntEnv('TTS_ESPEAK_PITCH', 42);
    return ['-v', voice, '-s', String(speed), '-p', String(pitch), '-w', outputFile, text];
  }

  private async generatePiperWav(text: string, piperExecutable: string, viaHost: boolean): Promise<Buffer> {
    const modelPath = this.resolvePiperModelPath();
    if (!modelPath) {
      throw new Error('TTS_PIPER_MODEL no configurado para usar piper.');
    }

    const lengthScaleRaw = process.env.TTS_PIPER_LENGTH_SCALE ?? '1.0';
    const noiseScaleRaw = process.env.TTS_PIPER_NOISE_SCALE ?? '0.5';
    const noiseWRaw = process.env.TTS_PIPER_NOISE_W ?? '0.8';

    const lengthScale = Number(lengthScaleRaw);
    const noiseScale = Number(noiseScaleRaw);
    const noiseW = Number(noiseWRaw);

    if (this.persistentPiperEnabled && !viaHost) {
      try {
        return await this.generatePiperWavWithPersistentProcess(text, piperExecutable, modelPath, lengthScale, noiseScale, noiseW);
      } catch (error) {
        this.logger.log(
          'TTS_PIPER_PERSISTENT_FALLBACK',
          `Fallo modo persistente, usando ejecucion unica. ${error instanceof Error ? error.message : 'Error desconocido'}`,
        );
      }
    }

    const tempFile = join(tmpdir(), `medical-agent-piper-${randomUUID()}.wav`);

    const args = [
      '--model', modelPath,
      '--output_file', tempFile,
      '--length_scale', Number.isFinite(lengthScale) ? String(lengthScale) : '1.0',
      '--noise_scale', Number.isFinite(noiseScale) ? String(noiseScale) : '0.5',
      '--noise_w', Number.isFinite(noiseW) ? String(noiseW) : '0.8',
    ];

    await this.runCommandWithInput(piperExecutable, args, text, viaHost);

    try {
      return await readFile(tempFile);
    } finally {
      void unlink(tempFile).catch(() => {
        // Ignorar errores de limpieza.
      });
    }
  }

  private async generatePiperWavWithPersistentProcess(
    text: string,
    piperExecutable: string,
    modelPath: string,
    lengthScale: number,
    noiseScale: number,
    noiseW: number,
  ): Promise<Buffer> {
    const timeoutMs = this.readPositiveIntEnv('TTS_PIPER_REQUEST_TIMEOUT_MS', 30000);
    const session = this.ensurePersistentPiperSession(piperExecutable, modelPath, lengthScale, noiseScale, noiseW);
    const outputFileName = `medical-agent-piper-${randomUUID()}.wav`;
    const tempFile = join(tmpdir(), outputFileName);

    const payload = JSON.stringify({ text, output_file: outputFileName });
    await this.enqueuePersistentPiperWrite(session, payload, timeoutMs);

    await this.waitForFile(tempFile, timeoutMs);

    try {
      return await readFile(tempFile);
    } finally {
      void unlink(tempFile).catch(() => {
        // Ignorar errores de limpieza.
      });
    }
  }

  private ensurePersistentPiperSession(
    piperExecutable: string,
    modelPath: string,
    lengthScale: number,
    noiseScale: number,
    noiseW: number,
  ): PersistentPiperSession {
    const lengthArg = Number.isFinite(lengthScale) ? String(lengthScale) : '1.0';
    const noiseArg = Number.isFinite(noiseScale) ? String(noiseScale) : '0.5';
    const noiseWArg = Number.isFinite(noiseW) ? String(noiseW) : '0.8';
    const key = [piperExecutable, modelPath, lengthArg, noiseArg, noiseWArg].join('|');

    if (this.piperSession && this.piperSession.key === key) {
      return this.piperSession;
    }

    this.stopPersistentPiperSession();

    const args = [
      '--model', modelPath,
      '--output_dir', tmpdir(),
      '--json-input',
      '--length_scale', lengthArg,
      '--noise_scale', noiseArg,
      '--noise_w', noiseWArg,
    ];

    const child = spawn(piperExecutable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const session: PersistentPiperSession = {
      key,
      child,
    };

    child.on('error', (error) => {
      this.handlePersistentPiperExit(session, `Error en proceso persistente Piper: ${error.message}`);
    });

    child.on('close', (code) => {
      this.handlePersistentPiperExit(session, `Proceso persistente Piper finalizo con codigo ${code ?? 'null'}.`);
    });

    this.piperSession = session;
    this.logger.log('TTS_PIPER_PERSISTENT_READY', 'Proceso Piper persistente inicializado.');
    return session;
  }

  private async enqueuePersistentPiperWrite(session: PersistentPiperSession, payload: string, timeoutMs: number): Promise<void> {
    const writeOperation = this.piperWriteChain.then(async () => {
      await new Promise<void>((resolve, reject) => {
        if (!session.child.stdin.writable) {
          reject(new Error('Pipe stdin de Piper no disponible.'));
          return;
        }

        const timeoutId = setTimeout(() => {
          reject(new Error('Timeout escribiendo request a Piper persistente.'));
        }, timeoutMs);

        session.child.stdin.write(`${payload}\n`, (error) => {
          clearTimeout(timeoutId);
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    });

    this.piperWriteChain = writeOperation.catch(() => {
      // Mantener la cola operativa para futuras solicitudes.
    });

    await writeOperation;
  }

  private handlePersistentPiperExit(session: PersistentPiperSession, message: string): void {
    if (this.piperSession !== session) {
      return;
    }

    this.piperSession = null;
    this.logger.log('TTS_PIPER_PERSISTENT_EXIT', message);
  }

  private stopPersistentPiperSession(): void {
    const current = this.piperSession;
    if (!current) {
      return;
    }

    this.piperSession = null;

    try {
      current.child.kill('SIGTERM');
    } catch {
      // Ignorar errores al terminar el proceso.
    }
  }

  private async waitForFile(filePath: string, timeoutMs: number): Promise<void> {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      try {
        const stats = await stat(filePath);
        if (stats.isFile() && stats.size > 44) {
          return;
        }
      } catch {
        // El archivo aun no esta disponible.
      }

      await this.delay(40);
    }

    throw new Error(`No se genero el archivo de audio esperado: ${basename(filePath)}`);
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private async runCommand(command: string, args: string[], viaHost: boolean): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const spawnCommand = viaHost ? 'flatpak-spawn' : command;
      const spawnArgs = viaHost ? ['--host', command, ...args] : args;
      const child = spawn(spawnCommand, spawnArgs, { stdio: 'ignore' });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Comando ${command} finalizo con codigo ${code ?? 'null'}.`));
        }
      });
    });
  }

  private resolvePiperModelPath(): string {
    const explicitModel = process.env.TTS_PIPER_MODEL?.trim() ?? '';
    if (explicitModel) {
      return explicitModel;
    }

    const bundleRoot = process.env.TTS_BUNDLED_DIR?.trim() || join(process.cwd(), 'vendor', 'tts');
    const bundledModel = process.env.TTS_BUNDLED_MODEL?.trim();
    if (bundledModel && existsSync(bundledModel)) {
      return bundledModel;
    }

    const preferredModels = [
      join(bundleRoot, 'models', 'es_MX-claude-high.onnx'),
      join(bundleRoot, 'models', 'es_MX-ald-medium.onnx'),
    ];

    for (const modelPath of preferredModels) {
      if (existsSync(modelPath)) {
        return modelPath;
      }
    }

    return '';
  }

  private findBundledPiperExecutable(): string | null {
    const bundleRoot = process.env.TTS_BUNDLED_DIR?.trim() || join(process.cwd(), 'vendor', 'tts');
    const piperDir = join(bundleRoot, 'piper');
    if (!existsSync(piperDir)) {
      return null;
    }

    const isWindows = process.platform === 'win32';
    const candidateNames = isWindows ? ['piper.exe'] : ['piper'];

    for (const name of candidateNames) {
      const direct = join(piperDir, name);
      if (existsSync(direct) && statSync(direct).isFile()) {
        return direct;
      }
    }

    const stack: string[] = [piperDir];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;

      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const fullPath = join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        if (candidateNames.includes(entry.name)) {
          return fullPath;
        }
      }
    }

    return null;
  }

  private async runCommandCapture(command: string, args: string[], viaHost: boolean): Promise<Buffer> {
    return await new Promise<Buffer>((resolve, reject) => {
      const spawnCommand = viaHost ? 'flatpak-spawn' : command;
      const spawnArgs = viaHost ? ['--host', command, ...args] : args;
      const child = spawn(spawnCommand, spawnArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        errChunks.push(chunk);
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        if (code !== 0) {
          const detail = Buffer.concat(errChunks).toString('utf8').trim();
          reject(new Error(`Comando ${command} finalizo con codigo ${code ?? 'null'}. ${detail}`));
          return;
        }

        const output = Buffer.concat(chunks);
        if (output.length === 0) {
          reject(new Error(`Comando ${command} no devolvio audio.`));
          return;
        }

        resolve(output);
      });
    });
  }

  private async runCommandWithInput(command: string, args: string[], input: string, viaHost: boolean): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const spawnCommand = viaHost ? 'flatpak-spawn' : command;
      const spawnArgs = viaHost ? ['--host', command, ...args] : args;
      const child = spawn(spawnCommand, spawnArgs, { stdio: ['pipe', 'ignore', 'pipe'] });
      const errChunks: Buffer[] = [];

      child.stderr.on('data', (chunk: Buffer) => {
        errChunks.push(chunk);
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        const detail = Buffer.concat(errChunks).toString('utf8').trim();
        reject(new Error(`Comando ${command} finalizo con codigo ${code ?? 'null'}. ${detail}`));
      });

      child.stdin.write(input);
      child.stdin.end();
    });
  }

  private sendJson(res: ServerResponse, statusCode: number, payload: object): void {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
  }

  private async serveStaticFile(req: IncomingMessage, res: ServerResponse, staticDir: string): Promise<void> {
    const MIME: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.ico': 'image/x-icon',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
      '.ttf': 'font/ttf',
    };
    const urlPath = new URL(req.url ?? '/', `http://localhost`).pathname;
    let filePath = join(staticDir, urlPath === '/' ? 'index.html' : urlPath);

    try {
      await stat(filePath);
    } catch {
      // SPA fallback: serve index.html for Angular routing
      filePath = join(staticDir, 'index.html');
    }

    try {
      let content = await readFile(filePath);
      const ext = extname(filePath);
      const mimeType = MIME[ext] ?? 'application/octet-stream';
      res.statusCode = 200;
      res.setHeader('Content-Type', mimeType);
      // Inject API base URL into index.html for Angular
      if (filePath.endsWith('index.html')) {
        const host = req.headers.host ?? `localhost:${this.port}`;
        const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
        const apiBase = `${protocol}://${host}`;
        const injected = content.toString().replace(
          '<head>',
          `<head><script>window.__API_BASE_URL__="${apiBase}";</script>`,
        );
        res.end(injected);
        return;
      }
      res.end(content);
    } catch {
      res.statusCode = 404;
      res.end('Not Found');
    }
  }

  private setCorsHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-staff-role');
  }

  private setupSseHeaders(res: ServerResponse): void {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write('retry: 5000\n\n');
  }

  private formatSse(event: AgentEvent): string {
    return `id: ${Date.now()}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  }

  private storeEvent(event: AgentEvent): void {
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  private replayRecentEvents(client: ServerResponse): void {
    for (const event of this.eventHistory) {
      try {
        client.write(this.formatSse(event));
      } catch {
        break;
      }
    }
  }
}
