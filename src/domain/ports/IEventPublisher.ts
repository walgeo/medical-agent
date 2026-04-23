import { AgentEvent } from '../events/AgentEvent';

export interface IEventPublisher {
  publish(event: AgentEvent): void;
}
