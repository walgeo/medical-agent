import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ZoeLearningClient } from './zoe-learning.client';

/**
 * Component for displaying Zoe responses with feedback mechanism
 * Allows users to mark responses as correct/incorrect to help Zoe learn
 */
@Component({
  selector: 'app-zoe-response-with-feedback',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="zoe-response-container" [class.low-confidence]="confidence < 0.65">
      <div class="response-content" [innerHTML]="responseHtml"></div>

      <!-- Feedback section -->
      <div class="feedback-section" *ngIf="!feedbackSent && confidence >= 0.4">
        <div class="feedback-buttons">
          <button
            class="btn btn-correct"
            (click)="markAsCorrect()"
            [title]="
              'Marcas que la respuesta fue correcta. Zoe aprenderá de esto para responder mejor en el futuro.'
            "
          >
            ✅ Correcto
          </button>

          <button
            class="btn btn-incorrect"
            (click)="showCorrectionInput = true"
            [title]="'La respuesta fue incorrecta. Proporciona la respuesta correcta para que Zoe aprenda.'"
          >
            ❌ Incorrecto
          </button>

          <button
            class="btn btn-incomplete"
            (click)="markAsIncomplete()"
            [title]="'La respuesta es parcialmente correcta pero le falta información.'"
          >
            ⚠️ Incompleto
          </button>

          <button
            class="btn btn-confusing"
            (click)="markAsConfusing()"
            [title]="'La respuesta no fue clara o fue confusa.'"
          >
            🤔 Confuso
          </button>
        </div>

        <!-- Correction input for incorrect responses -->
        <div class="correction-input" *ngIf="showCorrectionInput">
          <textarea
            placeholder="¿Cuál fue la respuesta correcta? Proporciona aquí la corrección..."
            [(ngModel)]="correctionText"
            rows="3"
          ></textarea>
          <div class="correction-buttons">
            <button class="btn btn-submit" (click)="markAsIncorrectWithCorrection()">
              Enviar Corrección
            </button>
            <button class="btn btn-cancel" (click)="showCorrectionInput = false">
              Cancelar
            </button>
          </div>
        </div>
      </div>

    </div>
  `,
  styles: `
    .zoe-response-container {
      border-left: 4px solid #0f766e;
      background: #f0f9ff;
      padding: 16px;
      border-radius: 8px;
      margin: 12px 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .zoe-response-container.low-confidence {
      border-left-color: #f59e0b;
      background: #fffbeb;
    }

    .response-header {
      display: flex;
      line-height: 1.6;
      color: #0f172a;
    }

    .feedback-section {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #cbd5e1;
    }

    .feedback-buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .btn {
      padding: 6px 12px;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      background: white;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.2s;
    }

    .btn:hover {
      background: #f1f5f9;
    }

    .btn-correct {
      border-color: #16a34a;
      color: #16a34a;
    }

    .btn-correct:hover {
      background: #f0fdf4;
    }

    .btn-incorrect {
      border-color: #dc2626;
      color: #dc2626;
    }

    .btn-incorrect:hover {
      background: #fef2f2;
    }

    .btn-incomplete {
      border-color: #f59e0b;
      color: #f59e0b;
    }

    .btn-incomplete:hover {
      background: #fffbeb;
    }

    .btn-confusing {
      border-color: #6366f1;
      color: #6366f1;
    }

    .btn-confusing:hover {
      background: #f0f4ff;
    }

    .correction-input {
      margin-top: 12px;
      padding: 12px;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
    }

    textarea {
      width: 100%;
      padding: 8px;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      font-family: inherit;
      font-size: 13px;
      resize: vertical;
    }

    textarea:focus {
      outline: none;
      border-color: #0f766e;
      box-shadow: 0 0 0 2px #0f766e20;
    }

    .correction-buttons {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }

    .btn-submit {
      border-color: #16a34a;
      color: #16a34a;
      flex: 1;
    }

    .btn-submit:hover {
      background: #f0fdf4;
    }

    .btn-cancel {
      border-color: #94a3b8;
      color: #64748b;
    }

    .btn-cancel:hover {
      background: #f1f5f9;
    }

  `,
})
export class ZoeResponseWithFeedbackComponent {
  @Input() userQuery: string = '';
  @Input() zoeResponse: string = '';
  @Input() confidence: number = 0.75;
  @Input() confidenceReasons: string = 'Basado en: ruta de respuesta, calidad de datos, contexto';
  @Input() route: 'tool' | 'llm_premium' | 'llm_local' | 'fallback' | 'learned' = 'tool';
  @Input() isHtml: boolean = false;

  @Output('feedbackSubmitted') feedbackSubmittedEvent = new EventEmitter<{
    feedback: 'correct' | 'incorrect' | 'incomplete' | 'confusing';
    correction?: string;
  }>();

  showCorrectionInput = false;
  correctionText = '';
  feedbackSent = false;
  feedbackStats = {
    totalFeedback: 0,
    correctCount: 0,
    incorrectCount: 0,
    learnedPatterns: 0,
    avgConfidence: 0,
  };

  routeLabel: string = 'tool';

  constructor(
    private learningClient: ZoeLearningClient,
    private sanitizer: DomSanitizer,
  ) {}

  ngOnInit() {
    this.updateRouteLabel();
  }

  ngOnChanges() {
    this.updateRouteLabel();
  }

  private updateRouteLabel() {
    const labels: Record<string, string> = {
      tool: '🛠️ Tool',
      llm_premium: '⭐ Premium LLM',
      llm_local: '🖥️ Local LLM',
      fallback: '⚡ Fallback',
      learned: '🧠 Patrón Aprendido',
    };
    this.routeLabel = labels[this.route] || this.route;
  }

  get responseHtml(): SafeHtml | string {
    if (this.isHtml) {
      return this.sanitizer.bypassSecurityTrustHtml(this.zoeResponse);
    }
    // Escape HTML in plain text responses
    return this.zoeResponse
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .replace(/\n/g, '<br>');
  }

  markAsCorrect() {
    this.submitFeedback('correct');
  }

  markAsIncomplete() {
    this.submitFeedback('incomplete');
  }

  markAsConfusing() {
    this.submitFeedback('confusing');
  }

  markAsIncorrectWithCorrection() {
    if (this.correctionText.trim()) {
      this.submitFeedback('incorrect', this.correctionText.trim());
      this.showCorrectionInput = false;
      this.correctionText = '';
    }
  }

  private submitFeedback(
    feedback: 'correct' | 'incorrect' | 'incomplete' | 'confusing',
    correction?: string,
  ) {
    this.learningClient.submitFeedback(this.userQuery, this.zoeResponse, feedback, correction).subscribe(
      (response) => {
        this.feedbackStats = response.stats;
        this.feedbackSent = true;
        this.feedbackSubmittedEvent.emit({ feedback, correction });
      },
      (error) => {
        console.error('Error submitting feedback:', error);
        alert('Error registrando feedback. Por favor intenta de nuevo.');
      },
    );
  }
}
