import { ZoeFeedbackStore, ZoeFeedbackEntry } from './ZoeFeedbackStore';
import { ZoeConfidenceEngine, ConfidenceScore } from './ZoeConfidenceEngine';

/**
 * Central learning engine for Zoe
 * Manages confidence, feedback, pattern learning, and adaptive responses
 */
export class ZoeLearningEngine {
  private feedbackStore: ZoeFeedbackStore;
  private confidenceEngine: ZoeConfidenceEngine;
  private responseHistory: Map<string, string> = new Map(); // Cache of query→successful responses

  constructor(baseDir: string = './sdk') {
    this.feedbackStore = new ZoeFeedbackStore(baseDir);
    this.confidenceEngine = new ZoeConfidenceEngine();
  }

  /**
   * Main method: Process a Zoe response with confidence evaluation
   * Returns the potentially modified response (honest rejection + request for context if needed)
   */
  evaluateAndAdaptResponse(input: {
    userQuery: string;
    zoeResponse: string;
    route: 'tool' | 'llm_premium' | 'llm_local' | 'fallback';
    toolName?: string;
    llmConfidenceScore?: number;
  }): {
    finalResponse: string;
    confidence: ConfidenceScore;
    shouldRecordFeedback: boolean;
    feedbackEntry?: Partial<ZoeFeedbackEntry>;
  } {
    // 1. Only let learned patterns replace non-tool responses.
    // Tool responses come from current operational data and should stay authoritative.
    const canOverrideWithLearnedPattern = input.route !== 'tool';
    const learnedPattern = canOverrideWithLearnedPattern
      ? this.feedbackStore.getLearnerPattern(input.userQuery)
      : null;

    if (learnedPattern && learnedPattern.confidence > 0.85) {
      // Use learned response if highly confident
      const confidence = this.confidenceEngine.evaluateConfidence(
        input.userQuery,
        learnedPattern.correct_response,
        'learned',
        0.9, // High confidence for learned patterns
      );

      this.confidenceEngine.addToContext('zoe', learnedPattern.correct_response);

      return {
        finalResponse: learnedPattern.correct_response,
        confidence,
        shouldRecordFeedback: false,
      };
    }

    // 2. Evaluate confidence in current response
    const confidence = this.confidenceEngine.evaluateConfidence(
      input.userQuery,
      input.zoeResponse,
      input.route as any,
      input.llmConfidenceScore,
      input.toolName,
    );

    // 3. If not confident enough, generate honest response
    let finalResponse = input.zoeResponse;
    if (!confidence.shouldRespond && confidence.honestAlternative) {
      finalResponse = confidence.honestAlternative;
      this.confidenceEngine.addToContext('zoe', finalResponse);

      return {
        finalResponse,
        confidence,
        shouldRecordFeedback: true,
        feedbackEntry: {
          userQuery: input.userQuery,
          zoeResponse: finalResponse,
          responseRoute: input.route,
          confidenceScore: confidence.score,
          userFeedback: 'incomplete', // Mark as incomplete for feedback
        },
      };
    }

    // 4. Response was confident, add to context and return
    this.confidenceEngine.addToContext('zoe', finalResponse);

    const feedbackEntry: Partial<ZoeFeedbackEntry> = {
      userQuery: input.userQuery,
      zoeResponse: finalResponse,
      responseRoute: input.route,
      toolUsed: input.toolName,
      confidenceScore: confidence.score,
      // userFeedback will be set when feedback comes in
    };

    return {
      finalResponse,
      confidence,
      shouldRecordFeedback: true,
      feedbackEntry,
    };
  }

  /**
   * Record user feedback for a previous response
   */
  recordUserFeedback(input: {
    userQuery: string;
    zoeResponse: string;
    feedback: 'correct' | 'incorrect' | 'incomplete' | 'confusing';
    userCorrection?: string;
  }): void {
    const entry: ZoeFeedbackEntry = {
      id: '',
      timestamp: new Date().toISOString(),
      userQuery: input.userQuery,
      zoeResponse: input.zoeResponse,
      userFeedback: input.feedback,
      userCorrection: input.userCorrection,
    };

    this.feedbackStore.recordFeedback(entry);

    // If user provided correction, add to response cache for future use
    if (input.userCorrection) {
      this.responseHistory.set(input.userQuery, input.userCorrection);
    }
  }

  /**
   * Add user message to conversation context
   */
  addUserMessage(message: string): void {
    this.confidenceEngine.addToContext('user', message);
  }

  /**
   * Get feedback statistics
   */
  getStats() {
    return this.feedbackStore.getStats();
  }

  /**
   * Get recent feedback entries
   */
  getRecentFeedback(limit: number = 20) {
    return this.feedbackStore.getRecentFeedback(limit);
  }

  /**
   * Check if we learn something from a failed attempt and suggest improvement
   */
  getSuggestionForNextAttempt(userQuery: string, failedResponse: string): string | null {
    // Check if query pattern has been learned
    const pattern = this.feedbackStore.getLearnerPattern(userQuery);
    if (pattern && pattern.confidence > 0.5) {
      return pattern.correct_response;
    }

    // Check response history
    if (this.responseHistory.has(userQuery)) {
      return this.responseHistory.get(userQuery) || null;
    }

    // No learned suggestion
    return null;
  }

  /**
   * Reset conversation context for new session
   */
  resetConversationContext(): void {
    this.confidenceEngine.resetContext();
  }
}
