import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * Client for Zoe's Learning Engine
 * Handles feedback submission and learning statistics
 */
@Injectable({
  providedIn: 'root',
})
export class ZoeLearningClient {
  private apiUrl = '/api'; // Adjust to match your API base URL

  constructor(private http: HttpClient) {}

  /**
   * Submit feedback for a Zoe response
   * @param userQuery The original user query
   * @param zoeResponse The response Zoe provided
   * @param feedback How the user rates the response
   * @param userCorrection If feedback='incorrect', provide the correct answer
   */
  submitFeedback(
    userQuery: string,
    zoeResponse: string,
    feedback: 'correct' | 'incorrect' | 'incomplete' | 'confusing',
    userCorrection?: string,
  ): Observable<{
    message: string;
    stats: {
      totalFeedback: number;
      correctCount: number;
      incorrectCount: number;
      learnedPatterns: number;
      avgConfidence: number;
    };
  }> {
    const payload = {
      userQuery,
      zoeResponse,
      feedback,
      userCorrection,
    };

    return this.http.post<any>(`${this.apiUrl}/zoe/feedback`, payload);
  }

  /**
   * Get learning statistics
   */
  getLearningStats(): Observable<{
    totalFeedback: number;
    correctCount: number;
    incorrectCount: number;
    learnedPatterns: number;
    avgConfidence: number;
  }> {
    return this.http.get<any>(`${this.apiUrl}/zoe/learning-stats`);
  }

  /**
   * Get recent feedback entries
   * @param limit Number of recent feedbacks to retrieve (default: 20)
   */
  getRecentFeedback(limit: number = 20): Observable<
    Array<{
      id: string;
      timestamp: string;
      userQuery: string;
      zoeResponse: string;
      userFeedback: 'correct' | 'incorrect' | 'incomplete' | 'confusing';
      userCorrection?: string;
      confidenceScore?: number;
      responseRoute?: string;
    }>
  > {
    return this.http.get<any>(`${this.apiUrl}/zoe/recent-feedback?limit=${limit}`);
  }
}
