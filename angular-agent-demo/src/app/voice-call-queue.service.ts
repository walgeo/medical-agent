import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { MedicalAgentEventsService } from './medical-agent-events.service';

export interface VoiceCall {
  id: string;
  appointmentId: string;
  patientName: string;
  specialty: string;
  action: 'vital_signs' | 'doctor_call';
  status: 'pending' | 'playing' | 'completed';
  createdAt: string;
}

export interface VoiceDiagnostics {
  voicesDetected: number;
  selectedVoice: string;
  audioUnlocked: boolean;
  chunkedModeActive: boolean;
  lastFallbackReason: string | null;
  lastSynthesisError: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class VoiceCallQueueService {
  private readonly queue$ = new BehaviorSubject<VoiceCall[]>([]);
  private readonly currentCall$ = new BehaviorSubject<VoiceCall | null>(null);
  private readonly isPlaying$ = new BehaviorSubject<boolean>(false);
  private readonly diagnostics$ = new BehaviorSubject<VoiceDiagnostics>({
    voicesDetected: 0,
    selectedVoice: 'default',
    audioUnlocked: false,
    chunkedModeActive: false,
    lastFallbackReason: null,
    lastSynthesisError: null,
  });

  private synth: SpeechSynthesis | null = null;
  private callIdCounter = 0;
  private preferredVoice: SpeechSynthesisVoice | null = null;
  private audioUnlocked = false;
  private hasWarnedTtsFallback = false;
  private readonly debugLogging = false;
  private readonly serverAudioCache = new Map<string, ArrayBuffer>();
  private readonly serverAudioInFlight = new Map<string, Promise<ArrayBuffer | null>>();
  private readonly maxServerAudioCacheEntries = 40;
  private preferBrowserTts = false;
  private serverTtsEnabled = true;
  private voiceProbeAttempts = 0;
  private readonly maxVoiceProbeAttempts = 12;

  constructor(private readonly eventsService: MedicalAgentEventsService) {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
      this.debug('[VoiceCallQueue] Web Speech API inicializado');
      
      // Cargar voces disponibles
      const loadVoices = () => {
        if (this.synth) {
          const voices = this.synth.getVoices();
          this.debug(`[VoiceCallQueue] Voces disponibles: ${voices.length}`);
          
          // Intentar encontrar voz local de español para evitar synthesis-failed por voz remota/incompatible
          this.preferredVoice = voices.find((v) => v.lang.toLowerCase().startsWith('es') && v.localService)
            || voices.find((v) => v.lang.toLowerCase().startsWith('es'))
            || null;
          if (this.preferredVoice) {
            this.debug(`[VoiceCallQueue] Voz seleccionada: ${this.preferredVoice.name} (${this.preferredVoice.lang})`);
            this.updateDiagnostics({
              voicesDetected: voices.length,
              selectedVoice: `${this.preferredVoice.name} (${this.preferredVoice.lang})`,
            });
          } else {
            console.warn('[VoiceCallQueue] No se encontró voz en español, se usará voz por defecto del navegador.');
            this.updateDiagnostics({
              voicesDetected: voices.length,
              selectedVoice: 'default',
            });
          }
        }
      };
      
      // Las voces se cargan asincronamente
      if (this.synth.onvoiceschanged !== undefined) {
        this.synth.onvoiceschanged = loadVoices;
      }
      loadVoices();
      this.scheduleVoiceProbe();
      
      // Permitir interacción inicial
      this.enableAudioOnFirstInteraction();
    } else {
      console.warn('[VoiceCallQueue] Web Speech API no disponible en este navegador');
      this.updateDiagnostics({
        lastFallbackReason: 'web_speech_no_disponible',
      });
    }
  }

  private debug(message: string, ...args: unknown[]): void {
    if (this.debugLogging) {
      console.log(message, ...args);
    }
  }

  private enableAudioOnFirstInteraction(): void {
    if (typeof window === 'undefined') return;
    
    const enableAudio = () => {
      this.debug('[VoiceCallQueue] Interacción del usuario detectada - Audio desbloqueado');
      this.audioUnlocked = true;
      this.hasWarnedTtsFallback = false;
      this.updateDiagnostics({
        audioUnlocked: true,
      });
      
      // Intentar reanudar AudioContext si existe
      const audioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch((err: any) => {
          console.warn('[VoiceCallQueue] No se pudo reanudar AudioContext:', err);
        });
      }
      
      document.removeEventListener('click', enableAudio);
      document.removeEventListener('keydown', enableAudio);
    };

    document.addEventListener('click', enableAudio);
    document.addEventListener('keydown', enableAudio);
  }

  registerUserGesture(): void {
    this.audioUnlocked = true;
    this.hasWarnedTtsFallback = false;
    this.updateDiagnostics({
      audioUnlocked: true,
    });
  }

  configureTtsMode(preferBrowserTts: boolean, serverTtsEnabled: boolean): void {
    this.preferBrowserTts = preferBrowserTts;
    this.serverTtsEnabled = serverTtsEnabled;
  }

  private scheduleVoiceProbe(): void {
    if (!this.synth || typeof window === 'undefined') return;

    const probe = () => {
      if (!this.synth) return;

      const voices = this.synth.getVoices();
      if (voices.length > 0) {
        this.updateDiagnostics({
          voicesDetected: voices.length,
        });
        return;
      }

      this.voiceProbeAttempts += 1;
      if (this.voiceProbeAttempts >= this.maxVoiceProbeAttempts) {
        console.warn('[VoiceCallQueue] No se detectaron voces tras varios intentos. Revisa voces del sistema/navegador.');
        return;
      }

      setTimeout(probe, 1000);
    };

    setTimeout(probe, 700);
  }

  get queue(): Observable<VoiceCall[]> {
    return this.queue$.asObservable();
  }

  get currentCall(): Observable<VoiceCall | null> {
    return this.currentCall$.asObservable();
  }

  get isPlaying(): Observable<boolean> {
    return this.isPlaying$.asObservable();
  }

  get diagnostics(): Observable<VoiceDiagnostics> {
    return this.diagnostics$.asObservable();
  }

  private updateDiagnostics(patch: Partial<VoiceDiagnostics>): void {
    this.diagnostics$.next({
      ...this.diagnostics$.getValue(),
      ...patch,
    });
  }

  addCall(appointmentId: string, patientName: string, specialty: string, action: 'vital_signs' | 'doctor_call'): void {
    const call: VoiceCall = {
      id: `call-${++this.callIdCounter}`,
      appointmentId,
      patientName,
      specialty,
      action,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    this.debug(`[VoiceCallQueue] Agregando: ${patientName} (${action})`);
    const current = this.queue$.getValue();
    this.queue$.next([...current, call]);

    const messageSpanish = this.buildVoiceMessage(call);
    this.prefetchServerAudio(messageSpanish);

    if (!this.isPlaying$.getValue()) {
      this.debug('[VoiceCallQueue] Iniciando procesamiento de cola');
      void this.processQueue();
    }
  }

  clearQueue(): void {
    this.queue$.next([]);
    this.currentCall$.next(null);
    if (this.synth) {
      this.synth.cancel();
    }
    this.isPlaying$.next(false);
  }

  private async processQueue(): Promise<void> {
    while (this.queue$.getValue().length > 0) {
      const current = this.queue$.getValue()[0];
      if (!current) break;

      this.currentCall$.next(current);
      this.isPlaying$.next(true);

      const messageSpanish = this.buildVoiceMessage(current);
      this.debug(`[VoiceCallQueue] Reproduciendo: "${messageSpanish}"`);
      
      try {
        await this.playAudio(messageSpanish);
      } catch (error) {
        console.error('[VoiceCallQueue] Error al reproducir audio:', error);
      }

      // Marcar como completado y remover de cola
      const remaining = this.queue$.getValue().slice(1);
      this.queue$.next(remaining);
    }

    this.currentCall$.next(null);
    this.isPlaying$.next(false);
    this.debug('[VoiceCallQueue] Cola vacía, procesamiento completado');
  }

  private buildVoiceMessage(call: VoiceCall): string {
    if (call.action === 'vital_signs') {
      const normalizedSpecialty = call.specialty.trim().toLowerCase();
      if (normalizedSpecialty === 'toma de laboratorios') {
        return `${call.patientName}, por favor pasar a toma de laboratorios.`;
      }

      if (normalizedSpecialty === 'toma de estudios especiales') {
        return `${call.patientName}, por favor pasar a toma de estudios especiales.`;
      }

      return `${call.patientName}, por favor pasar a toma de signos vitales.`;
    }

    return `${call.patientName}, por favor pase a consulta a ${call.specialty}.`;
  }

  private playAudio(text: string): Promise<void> {
    if (!this.audioUnlocked) {
      if (!this.hasWarnedTtsFallback) {
        console.warn('[VoiceCallQueue] Audio no desbloqueado por interacción de usuario. Se intentará audio de servidor y, si falla, fallback.');
        this.hasWarnedTtsFallback = true;
      }
      this.updateDiagnostics({
        lastFallbackReason: 'audio_bloqueado_por_gesto',
      });
    }

    return new Promise((resolve) => {
      void this.playPreferredAudio(text).finally(() => resolve());
    });
  }

  private async playPreferredAudio(text: string): Promise<void> {
    if (this.preferBrowserTts) {
      const playedInBrowser = await this.playBrowserTtsWithResult(text);
      if (playedInBrowser) {
        this.hasWarnedTtsFallback = false;
        this.updateDiagnostics({
          lastSynthesisError: null,
          lastFallbackReason: null,
        });
        return;
      }

      if (!this.serverTtsEnabled) {
        this.updateDiagnostics({
          lastFallbackReason: 'browser_tts_unavailable',
        });
        await this.playFallbackAlert(text);
        return;
      }
    }

    if (this.serverTtsEnabled) {
      try {
        const playedOnServerAudio = await this.playServerGeneratedAudio(text);
        if (playedOnServerAudio) {
          this.hasWarnedTtsFallback = false;
          this.updateDiagnostics({
            lastSynthesisError: null,
            lastFallbackReason: null,
          });
          return;
        }

        this.updateDiagnostics({
          lastFallbackReason: 'server_audio_no_reproducido',
        });
      } catch {
        this.updateDiagnostics({
          lastFallbackReason: 'server_audio_error',
        });
      }
    }

    const playedInBrowser = await this.playBrowserTtsWithResult(text);
    if (playedInBrowser) {
      return;
    }

    await this.playFallbackAlert(text);
  }

  private async playBrowserTtsWithResult(text: string): Promise<boolean> {
    if (!this.synth) {
      return false;
    }

    try {
      await this.playBrowserTts(text);
      return true;
    } catch {
      return false;
    }
  }

  private async playServerGeneratedAudio(text: string): Promise<boolean> {
    try {
      const audioBuffer = await this.getServerAudioBuffer(text);
      if (!audioBuffer || audioBuffer.byteLength === 0) {
        return false;
      }

      const blob = new Blob([audioBuffer], { type: 'audio/wav' });
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);

      return await new Promise<boolean>((resolve) => {
        let finished = false;

        const done = (ok: boolean): void => {
          if (finished) return;
          finished = true;
          URL.revokeObjectURL(objectUrl);
          resolve(ok);
        };

        audio.onended = () => done(true);
        audio.onerror = () => done(false);

        const playAttempt = audio.play();
        if (playAttempt && typeof playAttempt.then === 'function') {
          playAttempt.catch(() => done(false));
        }
      });
    } catch {
      return false;
    }
  }

  private normalizeSpeechCacheKey(text: string): string {
    return text.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private prefetchServerAudio(text: string): void {
    const key = this.normalizeSpeechCacheKey(text);
    if (!key || this.serverAudioCache.has(key) || this.serverAudioInFlight.has(key)) {
      return;
    }

    const request = this.eventsService
      .synthesizeSpeech(text, 18000)
      .then((buffer) => {
        this.storeServerAudio(key, buffer);
        return buffer;
      })
      .catch(() => null)
      .finally(() => {
        this.serverAudioInFlight.delete(key);
      });

    this.serverAudioInFlight.set(key, request);
  }

  private async getServerAudioBuffer(text: string): Promise<ArrayBuffer | null> {
    const key = this.normalizeSpeechCacheKey(text);

    const cached = this.serverAudioCache.get(key);
    if (cached) {
      return cached;
    }

    const inFlight = this.serverAudioInFlight.get(key);
    if (inFlight) {
      const result = await inFlight;
      if (result && result.byteLength > 0) {
        return result;
      }
    }

    const generated = await this.eventsService.synthesizeSpeech(text, 18000);
    this.storeServerAudio(key, generated);
    return generated;
  }

  private storeServerAudio(key: string, audio: ArrayBuffer): void {
    if (!key || !audio || audio.byteLength === 0) {
      return;
    }

    this.serverAudioCache.set(key, audio);

    while (this.serverAudioCache.size > this.maxServerAudioCacheEntries) {
      const oldest = this.serverAudioCache.keys().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      this.serverAudioCache.delete(oldest);
    }
  }

  private playBrowserTts(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!this.synth) {
        resolve();
        return;
      }

      let notAllowedRetries = 0;
      const MAX_NOT_ALLOWED_RETRIES = 2;

      const getVoiceForLang = (lang: string): SpeechSynthesisVoice | null => {
        const normalized = lang.toLowerCase();
        const voices = this.synth?.getVoices() ?? [];

        const preferredMatchesLang = this.preferredVoice
          && this.preferredVoice.lang.toLowerCase().startsWith(normalized.split('-')[0]);
        if (preferredMatchesLang) {
          return this.preferredVoice;
        }

        const localMatch = voices.find((v) => v.lang.toLowerCase().startsWith(normalized.split('-')[0]) && v.localService);
        if (localMatch) {
          return localMatch;
        }

        return voices.find((v) => v.lang.toLowerCase().startsWith(normalized.split('-')[0])) || null;
      };
      
      const attemptSpeak = (lang: string, rate: number, retry: number) => {
        this.debug(`[VoiceCallQueue] Intento ${retry + 1}: lang=${lang}, rate=${rate}`);
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;
        utterance.rate = rate;
        utterance.pitch = 1;
        utterance.volume = 1;

        const selectedVoice = getVoiceForLang(lang);
        if (selectedVoice) {
          utterance.voice = selectedVoice;
          utterance.lang = selectedVoice.lang;
        }

        utterance.onstart = () => {
          this.debug('[VoiceCallQueue] Reproducción iniciada');
        };

        utterance.onend = () => {
          this.debug('[VoiceCallQueue] Reproducción completada');
          this.hasWarnedTtsFallback = false;
          this.updateDiagnostics({
            lastSynthesisError: null,
            lastFallbackReason: null,
          });
          resolve();
        };

        utterance.onerror = (event) => {
          console.error(`[VoiceCallQueue] Error de síntesis: ${event.error}`);
          this.updateDiagnostics({
            lastSynthesisError: event.error,
          });
          
          // Si es synthesis-failed, intentar con diferentes configuraciones
          if (event.error === 'synthesis-failed') {
            const configs = [
              { lang: 'es-ES', rate: 0.8 },
              { lang: 'es', rate: 0.9 },
              { lang: 'en-US', rate: 0.9 },
            ];

            if (retry < configs.length) {
              this.debug('[VoiceCallQueue] Síntesis falló, intentando con diferente configuración...');
              this.synth?.cancel();

              setTimeout(() => {
                const nextConfig = configs[retry];
                attemptSpeak(nextConfig.lang, nextConfig.rate, retry + 1);
              }, 200);
              return;
            }

            console.warn('[VoiceCallQueue] synthesis-failed persistente. Intentando lectura por segmentos...');
            void this.playChunkedSpeech(text)
              .then((played) => {
                if (!played) {
                  this.updateDiagnostics({
                    lastFallbackReason: 'synthesis_failed_persistente',
                  });
                  void this.playFallbackAlert(text);
                }
              })
              .finally(() => {
                resolve();
              });
          } else if (event.error === 'not-allowed') {
            notAllowedRetries++;
            this.debug(`[VoiceCallQueue] Síntesis bloqueada (not-allowed) - Reintento ${notAllowedRetries}/${MAX_NOT_ALLOWED_RETRIES}`);
            
            if (notAllowedRetries >= MAX_NOT_ALLOWED_RETRIES) {
              console.error('[VoiceCallQueue] Máximo numero de reintentos alcanzado para not-allowed. Síntesis deshabilitada.');
              this.updateDiagnostics({
                lastFallbackReason: 'not_allowed',
              });
              // Mostrar notificación alternativa en lugar de audio
              void this.playFallbackAlert(text);
              resolve();
              return;
            }
            
            this.synth?.cancel();
            setTimeout(() => {
              this.debug('[VoiceCallQueue] Reintentando después de cancelación...');
              try {
                this.synth?.speak(utterance);
              } catch (retryError) {
                console.error('[VoiceCallQueue] Fallo en reintento:', retryError);
                resolve();
              }
            }, 150);
          } else {
            console.error('[VoiceCallQueue] No se puede reintentar este error:', event.error);
            this.updateDiagnostics({
              lastFallbackReason: `error_${event.error}`,
            });
            void this.playFallbackAlert(text);
            resolve();
          }
        };

        try {
          this.synth!.speak(utterance);
        } catch (error) {
          console.error('[VoiceCallQueue] Error al llamar speak():', error);
          resolve();
        }
      };

      // Iniciar con es-ES y rate 0.9
      attemptSpeak('es-ES', 0.9, 0);
    });
  }

  private async playChunkedSpeech(text: string): Promise<boolean> {
    if (!this.synth) return false;

    this.updateDiagnostics({
      chunkedModeActive: true,
    });

    const chunks = this.splitSpeechText(text);
    if (chunks.length === 0) return false;

    let playedAtLeastOneChunk = false;

    for (const chunk of chunks) {
      const chunkPlayed = await new Promise<boolean>((resolve) => {
        if (!this.synth) {
          resolve(false);
          return;
        }

        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.rate = 0.9;
        utterance.pitch = 1;
        utterance.volume = 1;

        utterance.onend = () => resolve(true);
        utterance.onerror = () => resolve(false);

        try {
          // No forzamos voz/lang para permitir que el navegador elija la ruta más estable.
          this.synth.speak(utterance);
        } catch {
          resolve(false);
        }
      });

      if (!chunkPlayed) {
        this.updateDiagnostics({
          chunkedModeActive: false,
        });
        return playedAtLeastOneChunk;
      }

      playedAtLeastOneChunk = true;
      await this.wait(60);
    }

    this.updateDiagnostics({
      chunkedModeActive: false,
    });

    return playedAtLeastOneChunk;
  }

  private splitSpeechText(text: string): string[] {
    return text
      .replace(/\s+/g, ' ')
      .split(/([,.!?;:])/)
      .reduce<string[]>((acc, part) => {
        const chunk = part.trim();
        if (!chunk) return acc;

        if (acc.length === 0) {
          acc.push(chunk);
          return acc;
        }

        const last = acc[acc.length - 1];
        if ((last + ' ' + chunk).length <= 80) {
          acc[acc.length - 1] = `${last} ${chunk}`.trim();
        } else {
          acc.push(chunk);
        }

        return acc;
      }, []);
  }

  private async playFallbackAlert(text: string): Promise<void> {
    this.showVisualNotification(text);
    await this.playTone(880, 180);
    await this.wait(80);
    await this.playTone(660, 220);
  }

  private playTone(frequency: number, durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') {
        resolve();
        return;
      }

      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;

      if (!AudioCtx) {
        resolve();
        return;
      }

      try {
        const context = new AudioCtx();
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.value = 0.08;

        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.start();
        setTimeout(() => {
          oscillator.stop();
          void context.close();
          resolve();
        }, durationMs);
      } catch (error) {
        console.warn('[VoiceCallQueue] No se pudo reproducir tono fallback:', error);
        resolve();
      }
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => resolve(), ms);
    });
  }

  private showVisualNotification(text: string): void {
    this.debug('[VoiceCallQueue] Mostrando notificación visual alternativa:', text);
    // Crear notificación visual en el DOM
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #fbbf24;
      color: #000;
      padding: 16px;
      border-radius: 8px;
      font-weight: bold;
      font-size: 16px;
      z-index: 10000;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      animation: slideIn 0.3s ease-out;
    `;
    notification.textContent = text;
    document.body.appendChild(notification);
    
    // Remover después de 5 segundos
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => notification.remove(), 300);
    }, 5000);
  }
}
