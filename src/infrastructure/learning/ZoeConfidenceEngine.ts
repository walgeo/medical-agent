/**
 * Confidence scoring and honesty detection for Zoe
 */

export type ConfidenceScore = {
  score: number; // 0-1
  reasoning: string;
  shouldRespond: boolean; // Can Zoe confidently respond?
  honestAlternative?: string; // What Zoe should say if not confident
};

export class ZoeConfidenceEngine {
  private readonly minConfidenceThreshold = 0.65; // Below this, Zoe should say "I don't know"
  private readonly minToolConfidence = 0.80; // Tools need higher confidence
  private readonly conversationContext: Array<{ role: 'user' | 'zoe'; text: string }> = [];

  constructor() {}

  /**
   * Evaluate confidence in a response based on multiple factors
   */
  evaluateConfidence(
    userQuery: string,
    responseText: string,
    route: 'tool' | 'llm' | 'fallback' | string,
    llmConfidenceScore?: number,
    toolName?: string,
  ): ConfidenceScore {
    let confidence = 0.5; // Base confidence
    const factors: string[] = [];

    // 1. Route-based confidence
    if (route === 'tool') {
      confidence = 0.85; // Tools are generally reliable
      factors.push('tool-based:+0.35');
    } else if (route === 'llm_premium') {
      confidence = 0.78;
      factors.push('llm-premium:+0.28');
    } else if (route === 'llm_local') {
      confidence = 0.65;
      factors.push('llm-local:+0.15');
    } else if (route === 'fallback') {
      confidence = 0.40; // Fallback is generic, low confidence
      factors.push('fallback:-0.10');
    }

    // 2. LLM provided confidence score
    if (llmConfidenceScore !== undefined) {
      const llmBoost = llmConfidenceScore * 0.3; // Up to +0.3
      confidence += llmBoost;
      factors.push(`llm-score:${(llmConfidenceScore * 100).toFixed(1)}% (+${(llmBoost * 100).toFixed(0)}%)`);
    }

    // 3. Response quality signals
    if (this.isVagueResponse(responseText)) {
      confidence -= 0.15;
      factors.push('vague-response:-0.15');
    }

    if (this.hasQualifiers(responseText)) {
      confidence -= 0.10; // "might", "maybe", "could" signals uncertainty
      factors.push('has-qualifiers:-0.10');
    }

    if (this.isHtmlOrStructured(responseText)) {
      confidence += 0.10; // Structured data is more reliable
      factors.push('structured-data:+0.10');
    }

    // 4. Context-based confidence
    if (this.lastResponseWasFailed()) {
      confidence -= 0.15; // If Zoe just failed, lower confidence in follow-up
      factors.push('recent-failure:-0.15');
    }

    if (this.isFollowupQuestion(userQuery)) {
      confidence -= 0.05; // Follow-ups are trickier
      factors.push('follow-up-query:-0.05');
    }

    // Clamp to 0-1
    confidence = Math.max(0, Math.min(1, confidence));

    // Determine if Zoe should respond
    const thresholdToUse = toolName ? this.minToolConfidence : this.minConfidenceThreshold;
    const shouldRespond = confidence >= thresholdToUse;

    const reasoning = `${factors.join(' | ')} → ${(confidence * 100).toFixed(0)}%`;

    return {
      score: confidence,
      reasoning,
      shouldRespond,
      honestAlternative: !shouldRespond
        ? this.generateHonestResponse(userQuery, confidence)
        : undefined,
    };
  }

  /**
   * Generate an honest response when Zoe doesn't know
   */
  private generateHonestResponse(userQuery: string, _confidence: number): string {
    const isCount = /cuántos|cuantos|contar|total|número|numero/.test(userQuery.toLowerCase());
    const isPatient = /paciente|patient|doctor|médico/.test(userQuery.toLowerCase());
    const isSchedule = /agendar|schedule|cita|appointment|hora/.test(userQuery.toLowerCase());

    if (isCount) {
      return "No estoy completamente segura de ese conteo. ¿Podrías darme más contexto? Por ejemplo: ¿de qué período o especialidad necesitas el conteo?";
    }

    if (isPatient) {
      return "Sobre eso no tengo suficiente información. ¿Podrías especificar qué datos necesitas del paciente o doctor?";
    }

    if (isSchedule) {
      return "No estoy segura de cómo proceder con eso. ¿Podrías decirme más detalles de la cita o del paciente?";
    }

    return "No tengo una respuesta confiable para eso en este momento. ¿Puedo ayudarte con algo más específico? Dime qué información necesitas exactamente.";
  }

  /**
   * Check if response is too vague
   */
  private isVagueResponse(text: string): boolean {
    const vaguePatterns = [
      /^parece que|^probablemente|^tal vez|^creo que$/i,
      /^no sé\s*/i,
      /lamentablemente no tengo/i,
      /^ok|^bueno|^sí|^claro$/i, // Single word responses
    ];
    return vaguePatterns.some((p) => p.test(text));
  }

  /**
   * Check if response has uncertainty qualifiers
   */
  private hasQualifiers(text: string): boolean {
    const qualifiers = /\b(might|may|could|possibly|perhaps|potentially|aproximadamente|más o menos|creo|parece)\b/i;
    return qualifiers.test(text);
  }

  /**
   * Check if response is structured (HTML, JSON, table, etc.)
   */
  private isHtmlOrStructured(text: string): boolean {
    return /<table|<tr|<td|<div|{.*}|\[.*\]|^[\d\s,.:;-]+$/i.test(text);
  }

  /**
   * Check if last Zoe response was a failure/fallback
   */
  private lastResponseWasFailed(): boolean {
    if (this.conversationContext.length < 2) return false;
    const lastZoeResponse = this.conversationContext[this.conversationContext.length - 2];
    if (lastZoeResponse.role !== 'zoe') return false;

    // Check for fallback indicators (hardcoded generic responses)
    return /ayuda|help me|más información|more context/i.test(lastZoeResponse.text);
  }

  /**
   * Check if current query is a follow-up
   */
  private isFollowupQuestion(query: string): boolean {
    const followupPatterns = /\b(y|en|eso|esos|de ese|sobre eso|en relación|after|then|and)\b/i;
    return followupPatterns.test(query) || !query.includes('?');
  }

  /**
   * Add message to conversation context
   */
  addToContext(role: 'user' | 'zoe', text: string): void {
    this.conversationContext.push({ role, text });
    // Keep only last 10 messages for context
    if (this.conversationContext.length > 10) {
      this.conversationContext.shift();
    }
  }

  /**
   * Reset context (new conversation)
   */
  resetContext(): void {
    this.conversationContext.length = 0;
  }
}
