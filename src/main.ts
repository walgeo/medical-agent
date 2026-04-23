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
const eventPublisher = new SseEventPublisher(
  7071,
  '/events',
  logger,
  recommendationGovernance,
  appointmentService,
  appointmentUpdater,
);
const heuristicRecommendationEngine = new HeuristicRecommendationEngine();
const llmRecommendationEngine = new LlmRecommendationEngine(logger);
const recommendationEngine = new FallbackRecommendationEngine(
  llmRecommendationEngine,
  heuristicRecommendationEngine,
);

const llmDecisionEngine = new LlmDecisionEngine(logger);
const heuristicDecisionEngine = new HeuristicDecisionEngine();
const decisionEngine = new FallbackDecisionEngine(llmDecisionEngine, heuristicDecisionEngine);

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