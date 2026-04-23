import { MedicalAppointmentAgent } from './application/agent/MedicalAppointmentAgent';
import { FetchTodayAppointments } from './application/use-cases/FetchTodayAppointments';
import { GenerateAppointmentRecommendations } from './application/use-cases/GenerateAppointmentRecommendations';
import { ProcessPatientArrival } from './application/use-cases/ProcessPatientArrival';
import { StartAppointment } from './application/use-cases/StartAppointment';
import { MockAppointmentService } from './infrastructure/services/MockAppointmentService';
import { MockAppointmentStore } from './infrastructure/services/MockAppointmentStore';
import { MockAppointmentUpdater } from './infrastructure/services/MockAppointmentUpdater';
import { ConsoleAlertNotifier } from './infrastructure/notifiers/ConsoleAlertNotifier';
import { ConsoleLogger } from './infrastructure/loggers/ConsoleLogger';
import { SseEventPublisher } from './infrastructure/events/SseEventPublisher';
import { FallbackRecommendationEngine } from './infrastructure/recommendations/FallbackRecommendationEngine';
import { HeuristicRecommendationEngine } from './infrastructure/recommendations/HeuristicRecommendationEngine';
import { InMemoryRecommendationGovernance } from './infrastructure/recommendations/InMemoryRecommendationGovernance';
import { LlmRecommendationEngine } from './infrastructure/recommendations/LlmRecommendationEngine';
import { LlmDecisionEngine } from './infrastructure/decisions/LlmDecisionEngine';
import { HeuristicDecisionEngine } from './infrastructure/decisions/HeuristicDecisionEngine';
import { FallbackDecisionEngine } from './infrastructure/decisions/FallbackDecisionEngine';

const logger = new ConsoleLogger();
const alertNotifier = new ConsoleAlertNotifier();
const recommendationGovernance = new InMemoryRecommendationGovernance();

const appointmentStore = new MockAppointmentStore();
const appointmentService = new MockAppointmentService(appointmentStore);
const appointmentUpdater = new MockAppointmentUpdater(appointmentStore);
const PORT = parseInt(process.env.PORT ?? '7071', 10);
const eventPublisher = new SseEventPublisher(
  PORT,
  '/events',
  logger,
  recommendationGovernance,
  appointmentService,
  appointmentUpdater,
);
const heuristicRecommendationEngine = new HeuristicRecommendationEngine();
const recommendationLlmUrl = process.env.RECOMMENDATION_LLM_URL ?? '';
const llmDisabledByEnv = (process.env.RECOMMENDATION_LLM_ENABLED ?? 'true').toLowerCase() === 'false';
const llmLocalhostInProd =
  process.env.NODE_ENV === 'production' && /(localhost|127\.0\.0\.1)/i.test(recommendationLlmUrl);
const enableLlmEngines = !llmDisabledByEnv && !llmLocalhostInProd && recommendationLlmUrl.length > 0;

const recommendationEngine = enableLlmEngines
  ? new FallbackRecommendationEngine(
      new LlmRecommendationEngine(logger),
      heuristicRecommendationEngine,
    )
  : heuristicRecommendationEngine;

if (!enableLlmEngines) {
  logger.log(
    'LLM_ENGINES_DISABLED',
    llmDisabledByEnv
      ? 'Motores LLM desactivados por RECOMMENDATION_LLM_ENABLED=false.'
      : llmLocalhostInProd
        ? 'Motores LLM desactivados: RECOMMENDATION_LLM_URL apunta a localhost en produccion.'
        : 'Motores LLM desactivados: URL no configurada.',
  );
}

const heuristicDecisionEngine = new HeuristicDecisionEngine();
const decisionEngine = enableLlmEngines
  ? new FallbackDecisionEngine(new LlmDecisionEngine(logger), heuristicDecisionEngine)
  : heuristicDecisionEngine;

const fetchTodayAppointments = new FetchTodayAppointments(appointmentService, logger);
const generateAppointmentRecommendations = new GenerateAppointmentRecommendations(
  recommendationEngine,
  recommendationGovernance,
  eventPublisher,
  logger,
);
const processPatientArrival = new ProcessPatientArrival(appointmentUpdater, eventPublisher, logger, decisionEngine);
const startAppointment = new StartAppointment(
  appointmentUpdater,
  alertNotifier,
  eventPublisher,
  logger,
);

const agent = new MedicalAppointmentAgent(
  fetchTodayAppointments,
  generateAppointmentRecommendations,
  processPatientArrival,
  startAppointment,
  logger,
);

eventPublisher.start();
agent.start();