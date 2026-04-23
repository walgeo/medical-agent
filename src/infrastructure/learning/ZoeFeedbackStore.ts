import * as fs from 'fs';
import * as path from 'path';

/**
 * Feedback on a Zoe response
 */
export type ZoeFeedbackEntry = {
  id: string;
  timestamp: string;
  userQuery: string;
  zoeResponse: string;
  userFeedback: 'correct' | 'incorrect' | 'incomplete' | 'confusing';
  userCorrection?: string; // What the correct answer should have been
  intentDetected?: string; // Intent that was detected
  confidenceScore?: number; // LLM confidence 0-1
  responseRoute?: 'tool' | 'llm_premium' | 'llm_local' | 'fallback'; // Which route produced response
  toolUsed?: string; // If route was 'tool', which tool
};

export type ZoeLearnedPattern = {
  query_pattern: string; // Fuzzy match pattern
  correct_response: string;
  feedback_count: number;
  last_updated: string;
  confidence: number; // 0-1 based on feedback consistency
};

export class ZoeFeedbackStore {
  private feedbackDir: string;
  private feedbackFile: string;
  private patternsFile: string;
  private feedbackBuffer: ZoeFeedbackEntry[] = [];
  private learnedPatterns: Map<string, ZoeLearnedPattern> = new Map();

  constructor(baseDir: string = './sdk') {
    this.feedbackDir = baseDir;
    this.feedbackFile = path.join(this.feedbackDir, 'zoe-feedback.jsonl');
    this.patternsFile = path.join(this.feedbackDir, 'zoe-learned-patterns.json');

    // Ensure directory exists
    if (!fs.existsSync(this.feedbackDir)) {
      fs.mkdirSync(this.feedbackDir, { recursive: true });
    }

    // Load existing patterns
    this.loadPatterns();
  }

  /**
   * Record feedback for a Zoe response
   */
  recordFeedback(entry: ZoeFeedbackEntry): void {
    entry.id = entry.id || `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    entry.timestamp = entry.timestamp || new Date().toISOString();

    this.feedbackBuffer.push(entry);

    // Write immediately (append-only log)
    try {
      fs.appendFileSync(this.feedbackFile, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err) {
      console.error('Error writing feedback:', err);
    }

    // If user provided correction, learn the pattern
    if (entry.userFeedback === 'incorrect' && entry.userCorrection) {
      this.learnPattern(entry.userQuery, entry.userCorrection, false);
    } else if (entry.userFeedback === 'correct') {
      this.learnPattern(entry.userQuery, entry.zoeResponse, true);
    }
  }

  /**
   * Learn a successful/unsuccessful response pattern
   */
  private learnPattern(query: string, response: string, successful: boolean): void {
    const patternKey = this.extractPatternKey(query);
    const existing = this.learnedPatterns.get(patternKey);

    if (existing) {
      // Update confidence based on feedback
      existing.feedback_count += 1;
      if (successful) {
        existing.confidence = Math.min(1, existing.confidence + 0.1);
      } else {
        existing.confidence = Math.max(0, existing.confidence - 0.15);
      }
      existing.last_updated = new Date().toISOString();
      if (successful) {
        existing.correct_response = response; // Update with latest correct answer
      }
    } else {
      // New pattern
      this.learnedPatterns.set(patternKey, {
        query_pattern: patternKey,
        correct_response: response,
        feedback_count: 1,
        last_updated: new Date().toISOString(),
        confidence: successful ? 0.7 : 0.3,
      });
    }

    this.savePatterns();
  }

  /**
   * Extract a fuzzy pattern key from query (remove specifics like names, numbers)
   */
  private extractPatternKey(query: string): string {
    // Remove specific names, numbers, dates
    let pattern = query
      .toLowerCase()
      .replace(/\b(juan|maria|carlos|diana|pedro|camila|roberto|daniel|laura|sofia|mario|ana)\b/gi, '[NAME]')
      .replace(/\d+/g, '[NUM]')
      .replace(/\b(hoy|mañana|ayer|lunes|martes|miércoles|jueves|viernes|sábado|domingo)\b/gi, '[DATE]')
      .replace(/\b(odontología|odontologia|cardiología|cardiologia|medicina general|pediatría|pediatria|psiquiatría|psiquiatria|dermatología|dermatologia)\b/gi, '[SPECIALTY]')
      .trim();

    // Keep only first 50 chars as pattern
    return pattern.substring(0, 50);
  }

  /**
   * Get learned pattern for a query (fuzzy match)
   */
  getLearnerPattern(query: string): ZoeLearnedPattern | null {
    const patternKey = this.extractPatternKey(query);

    // Exact match
    if (this.learnedPatterns.has(patternKey)) {
      const pattern = this.learnedPatterns.get(patternKey)!;
      if (pattern.confidence > 0.5) {
        return pattern;
      }
    }

    // Fuzzy match: look for patterns with similar keywords
    const queryWords = query.toLowerCase().split(/\s+/);
    let bestMatch: ZoeLearnedPattern | null = null;
    let bestScore = 0;

    for (const [, pattern] of this.learnedPatterns) {
      if (pattern.confidence > 0.5) {
        const patternWords = pattern.query_pattern.split(/\s+/);
        const commonWords = queryWords.filter((w) => patternWords.some((pw) => pw.includes(w) || w.includes(pw)));
        const score = commonWords.length / Math.max(queryWords.length, patternWords.length);

        if (score > bestScore) {
          bestScore = score;
          bestMatch = pattern;
        }
      }
    }

    return bestScore > 0.5 ? bestMatch : null;
  }

  /**
   * Get recent feedback for analysis/debugging
   */
  getRecentFeedback(limit: number = 50): ZoeFeedbackEntry[] {
    return this.feedbackBuffer.slice(-limit);
  }

  /**
   * Get stats about feedback
   */
  getStats(): {
    totalFeedback: number;
    correctCount: number;
    incorrectCount: number;
    learnedPatterns: number;
    avgConfidence: number;
  } {
    const correct = this.feedbackBuffer.filter((f) => f.userFeedback === 'correct').length;
    const incorrect = this.feedbackBuffer.filter((f) => f.userFeedback === 'incorrect').length;
    const avgConfidence =
      this.learnedPatterns.size > 0
        ? Array.from(this.learnedPatterns.values()).reduce((sum, p) => sum + p.confidence, 0) /
          this.learnedPatterns.size
        : 0;

    return {
      totalFeedback: this.feedbackBuffer.length,
      correctCount: correct,
      incorrectCount: incorrect,
      learnedPatterns: this.learnedPatterns.size,
      avgConfidence,
    };
  }

  /**
   * Save patterns to disk
   */
  private savePatterns(): void {
    try {
      const patterns = Array.from(this.learnedPatterns.values());
      fs.writeFileSync(this.patternsFile, JSON.stringify(patterns, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error saving learned patterns:', err);
    }
  }

  /**
   * Load patterns from disk
   */
  private loadPatterns(): void {
    try {
      if (fs.existsSync(this.patternsFile)) {
        const data = fs.readFileSync(this.patternsFile, 'utf-8');
        const parsed = JSON.parse(data) as unknown;

        const patterns: ZoeLearnedPattern[] = Array.isArray(parsed)
          ? parsed as ZoeLearnedPattern[]
          : [];

        if (!Array.isArray(parsed)) {
          console.warn('Learned patterns file has unexpected format. Rebuilding from empty patterns map.');
        }

        patterns.forEach((p) => {
          if (!p || typeof p.query_pattern !== 'string') return;
          this.learnedPatterns.set(p.query_pattern, p);
        });
      }
    } catch (err) {
      console.error('Error loading learned patterns:', err);
    }
  }
}
