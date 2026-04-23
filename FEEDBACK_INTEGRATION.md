# Integración de Componente de Feedback en Angular UI

Documento sobre la integración del componente `ZoeResponseWithFeedbackComponent` en la interfaz médica.

---

## 📱 Resumen de Cambios

### Backend
- ✅ Endpoint `/chat` ahora devuelve `confidence`, `route`, `tool` además de `response` e `isHtml`
- ✅ Endpoint `/zoe/feedback` disponible para registrar feedback del usuario
- ✅ Endpoint `/zoe/learning-stats` disponible para ver estadísticas de aprendizaje

### Frontend Angular
- ✅ Importado `ZoeResponseWithFeedbackComponent` en `app.component.ts`
- ✅ Inyectado `ZoeLearningClient` para comunicarse con el servidor
- ✅ Actualizada interfaz `ChatMessage` con campos de confianza y ruta
- ✅ Método `submitZoeFeedback()` para registrar feedback
- ✅ Métodos helper `getLastUserMessage()` y `getConfidenceReasons()`
- ✅ HTML actualizado para usar el componente de feedback en chat-panel
- ✅ CSS mejorado para adaptar el layout al componente

---

## 🎯 Cambios Principales

### 1. app.component.ts

#### Importaciones
```typescript
import { ZoeLearningClient } from './zoe-learning.client';
import { ZoeResponseWithFeedbackComponent } from './zoe-response-with-feedback.component';
```

#### Interfaz ChatMessage Mejorada
```typescript
interface ChatMessage {
  role: 'user' | 'zoe';
  content: string;
  isHtml: boolean;
  timestamp: string;
  confidence?: number;        // ← NUEVO
  route?: ChatResponseRoute;  // ← NUEVO
  tool?: string;              // ← NUEVO
}
```

#### En el componente
```typescript
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ZoeResponseWithFeedbackComponent],
  // ...
})
export class AppComponent implements OnInit, OnDestroy {
  constructor(
    private readonly eventsService: MedicalAgentEventsService,
    private readonly sanitizer: DomSanitizer,
    private readonly learningClient: ZoeLearningClient,  // ← NUEVO
  ) {}
```

#### Método mejorado sendChatMessage()
```typescript
// Antes: solo capturaba response e isHtml
this.chatMessages.push({
  role: 'zoe',
  content: result.response,
  isHtml: result.isHtml,
  timestamp: new Date().toISOString(),
});

// Ahora: CAPTURA METADATA COMPLETA
this.chatMessages.push({
  role: 'zoe',
  content: result.response,
  isHtml: result.isHtml,
  confidence: result.confidence,    // ← NUEVO
  route: result.route,               // ← NUEVO
  tool: result.tool,                 // ← NUEVO
  timestamp: new Date().toISOString(),
});
```

#### Nuevo método submitZoeFeedback()
```typescript
async submitZoeFeedback(
  userQuery: string,
  zoeResponse: string,
  feedback: 'correct' | 'incorrect' | 'incomplete' | 'confusing',
  correction?: string,
): Promise<void> {
  try {
    await this.learningClient
      .submitFeedback(userQuery, zoeResponse, feedback, correction)
      .toPromise();
  } catch (error) {
    console.error('Error submitting feedback:', error);
  }
}
```

#### Métodos helper
```typescript
// Obtener el último mensaje del usuario (para feedback)
getLastUserMessage(currentIndex: number): string {
  for (let i = currentIndex - 1; i >= 0; i--) {
    if (this.chatMessages[i].role === 'user') {
      return this.chatMessages[i].content;
    }
  }
  return '';
}

// Generar descripción de por qué Zoe tiene esa confianza
getConfidenceReasons(msg: ChatMessage): string {
  const reasons: string[] = [];
  
  if (msg.route) {
    switch (msg.route) {
      case 'tool':
        reasons.push('Ejecutada por herramienta exacta');
        break;
      case 'llm_premium':
        reasons.push('Procesada por LLM Premium');
        break;
      case 'llm_local':
        reasons.push('Procesada por LLM Local (Ollama)');
        break;
      case 'learned':
        reasons.push('Reconocida como patrón aprendido');
        break;
      case 'fallback':
        reasons.push('Fallback genérico');
        break;
    }
  }
  
  if (msg.tool) {
    reasons.push(`Herramienta: ${msg.tool}`);
  }
  
  return reasons.join(' | ');
}
```

### 2. app.component.html

**ANTES (vista simple de mensajes):**
```html
<div class="chat-message"
  *ngFor="let msg of chatMessages"
  [class.msg-user]="msg.role === 'user'"
  [class.msg-zoe]="msg.role === 'zoe'"
>
  <div class="msg-avatar">{{ msg.role === 'user' ? '👤' : '🤖' }}</div>
  <div class="msg-body">
    <div class="msg-html" *ngIf="msg.isHtml" [innerHTML]="safeHtml(msg.content)"></div>
    <p class="msg-text" *ngIf="!msg.isHtml">{{ msg.content }}</p>
    <span class="msg-time">{{ formatDate(msg.timestamp) }}</span>
  </div>
</div>
```

**AHORA (con componente de feedback):**
```html
<div class="chat-message"
  *ngFor="let msg of chatMessages; let i = index"
  [class.msg-user]="msg.role === 'user'"
  [class.msg-zoe]="msg.role === 'zoe'"
>
  <!-- Mensajes de usuario (sin cambios) -->
  <div *ngIf="msg.role === 'user'" class="msg-user-content">
    <div class="msg-avatar">👤</div>
    <div class="msg-body">
      <p class="msg-text">{{ msg.content }}</p>
      <span class="msg-time">{{ formatDate(msg.timestamp) }}</span>
    </div>
  </div>

  <!-- Mensajes de Zoe (NUEVO: con componente de feedback) -->
  <div *ngIf="msg.role === 'zoe'" class="msg-zoe-content">
    <app-zoe-response-with-feedback
      [userQuery]="getLastUserMessage(i)"
      [zoeResponse]="msg.content"
      [confidence]="msg.confidence ?? 0.75"
      [confidenceReasons]="getConfidenceReasons(msg)"
      [route]="msg.route ?? 'fallback'"
      [isHtml]="msg.isHtml"
      (feedbackSubmitted)="submitZoeFeedback(
        getLastUserMessage(i),
        msg.content,
        $event.feedback,
        $event.correction
      )"
    >
    </app-zoe-response-with-feedback>
    <span class="msg-time">{{ formatDate(msg.timestamp) }}</span>
  </div>
</div>
```

### 3. medical-agent-events.service.ts

**NUEVO: Tipos para la respuesta de chat**
```typescript
export type ChatResponseRoute = 'tool' | 'llm_premium' | 'llm_local' | 'fallback' | 'learned';

export interface ChatResponse {
  response: string;
  isHtml: boolean;
  confidence?: number;
  route?: ChatResponseRoute;
  tool?: string;
  adapted?: boolean;
}
```

**Método actualizado:**
```typescript
async sendChatMessage(
  message: string,
  history: Array<{ role: string; content: string }>,
): Promise<ChatResponse> {  // ← Cambió de { response, isHtml } a ChatResponse
  const response = await fetch(`${this.apiBaseUrl}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  });

  if (!response.ok) {
    throw new Error(`Error en el chat. status=${response.status}`);
  }

  return (await response.json()) as ChatResponse;
}
```

### 4. app.component.css

**CSS Nuevo para el layout del componente:**
```css
.msg-user-content {
	display: flex;
	gap: 10px;
	align-items: flex-start;
	flex-direction: row-reverse;
}

.msg-user-content .msg-body {
	max-width: 85%;
	align-items: flex-end;
}

.msg-user-content .msg-text {
	background: #dbeafe;
	color: #1e3a8a;
}

.msg-zoe-content {
	display: flex;
	flex-direction: column;
	gap: 8px;
	max-width: 95%;
}

.msg-zoe-content app-zoe-response-with-feedback {
	display: block;
}

.msg-time {
	font-size: 0.75rem;
	color: #94a3b8;
	margin-top: 4px;
}
```

---

## 🚀 Flujo de Uso

### Usuario Chat con Zoe

```
1. Usuario escribe: "cuántos pacientes hay?"
   ↓
2. Endpoint /chat devuelve:
   {
     "response": "Hay 12 pacientes registrados",
     "isHtml": false,
     "confidence": 0.95,
     "route": "tool",
     "tool": "count_all"
   }
   ↓
3. app.component captura estos campos en ChatMessage
   ↓
4. HTML renderiza ZoeResponseWithFeedbackComponent con:
   - Respuesta: "Hay 12 pacientes registrados"
   - Confianza visual: 95%
   - Badge de ruta: "🛠️ Tool"
   - 4 botones de feedback: ✅ ❌ ⚠️ 🤔
   ↓
5. Usuario marca: ✅ "Correcto"
   ↓
6. Componente emite feedbackSubmitted event
   ↓
7. app.component.submitZoeFeedback() envía:
   POST /zoe/feedback
   {
     "userQuery": "cuántos pacientes hay?",
     "zoeResponse": "Hay 12 pacientes registrados",
     "feedback": "correct"
   }
   ↓
8. Backend almacena en sdk/zoe-feedback.jsonl
   ↓
9. Backend actualiza confianza en sdk/zoe-learned-patterns.json
   ↓
10. ✅ Zoe aprendió: "cuántos pacientes" = respuesta correcta
```

---

## 🎓 Ejemplo de Interacción Completa

### Escena: Usar Zoe con Feedback

```
UI Chat Panel Abierto:

Usuario: "cuántos pacientes en cardiology?"
   ↓
Sistema procesa... [Zoe está pensando...]
   ↓
Zoe responde (con componente de feedback):

   ┌─────────────────────────────────────┐
   │ Confianza: 92%                      │
   │ 🛠️ Tool | Herramienta: count_by_... │
   ├─────────────────────────────────────┤
   │ "En Cardiology hay 3 pacientes"     │
   │ registrados para hoy.               │
   ├─────────────────────────────────────┤
   │ ✅ Correcto  ❌ Incorrecto  ⚠️ ...   │
   └─────────────────────────────────────┘
   
   14:32 PM

Usuario hace clic: "❌ Incorrecto"
   ↓
Se abre input de corrección:

   ┌─────────────────────────────────────┐
   │ ¿Cuál fue la respuesta correcta?    │
   │ Proporciona aquí la corrección...   │
   │                                     │
   │ [Hay 4 pacientes, incluyendo...]   │
   │                                     │
   │ [Enviar Corrección] [Cancelar]     │
   └─────────────────────────────────────┘

Usuario escribe corrección y envía
   ↓
✓ Gracias por ayudarnos a mejorar,
  Zoe aprenderá de esto.
  
14 feedbacks registrados | Confianza promedio: 87%
```

---

## 📊 Verificación de Integración

Para verificar que todo está funcionando:

### 1. Compilar sin errores
```bash
cd /home/walgeo/medical-agent
npm run build
# ✅ Debe completar sin errores
```

### 2. Archivos modificados
```bash
git diff angular-agent-demo/src/app/

# Debe mostrar cambios en:
# - app.component.ts (imports, interfaces, métodos)
# - app.component.html (componente de feedback en chat)
# - app.component.css (estilos para msg-user-content, msg-zoe-content)
# - medical-agent-events.service.ts (tipos ChatResponse, ChatResponseRoute)
```

### 3. Ejecutar en desarrollo
```bash
npm run dev

# Navegar a http://localhost:7071
# Hacer clic en "💬 Chat Zoe"
# Hacer una pregunta
# Verificar que aparecen los botones de feedback
```

### 4. Probar feedback
```bash
1. Escribe: "cuántos pacientes hay?"
2. Zoe responde con componente de feedback
3. Haz clic en "✅ Correcto"
4. Deberías ver: "✓ Gracias por ayudarnos a mejorar"
5. Ver logs del backend: "FEEDBACK_RECORDED"
```

---

## 🔗 Integración con Backend

### Endpoints Utilizados

| Endpoint | Método | Propósito |
|----------|--------|-----------|
| `/chat` | POST | Enviar pregunta a Zoe |
| `/zoe/feedback` | POST | Registrar feedback del usuario |
| `/zoe/learning-stats` | GET | Ver estadísticas de aprendizaje |
| `/zoe/recent-feedback` | GET | Ver feedback reciente |

### Flujo de Datos

```
UI (app.component)
    ↓
sendChatMessage()
    ↓
MedicalAgentEventsService.sendChatMessage()
    ↓
POST /chat
    ↓
Backend SseEventPublisher.handleZoeChat()
    ↓
Ejecuta tools/LLM/fallback
    ↓
learningEngine.evaluateAndAdaptResponse()
    ↓
Devuelve ChatResponse con confidence, route, tool
    ↓
UI captura metadata
    ↓
Renderiza ZoeResponseWithFeedbackComponent
    ↓
Usuario da feedback
    ↓
submitZoeFeedback()
    ↓
ZoeLearningClient.submitFeedback()
    ↓
POST /zoe/feedback
    ↓
Backend ZoeFeedbackStore.recordFeedback()
    ↓
Almacena en sdk/zoe-feedback.jsonl
    ↓
Actualiza sdk/zoe-learned-patterns.json
```

---

## 📝 Archivos Relacionados

| Archivo | Propósito |
|---------|-----------|
| `src/infrastructure/learning/ZoeLearningEngine.ts` | Motor de aprendizaje |
| `src/infrastructure/learning/ZoeConfidenceEngine.ts` | Evaluador de confianza |
| `src/infrastructure/learning/ZoeFeedbackStore.ts` | Almacenamiento persistente |
| `angular-agent-demo/src/app/zoe-learning.client.ts` | Cliente HTTP Angular |
| `angular-agent-demo/src/app/zoe-response-with-feedback.component.ts` | Componente de feedback |
| `ZOE_LEARNING_GUIDE.md` | Guía completa del sistema |

---

## ✅ Checklist de Integración

- [x] Importar ZoeLearningClient en app.component
- [x] Importar ZoeResponseWithFeedbackComponent en app.component
- [x] Actualizar interfaz ChatMessage con campos de confianza/ruta
- [x] Capturar metadata de respuesta en sendChatMessage()
- [x] Agregar método submitZoeFeedback()
- [x] Agregar métodos helper getLastUserMessage() y getConfidenceReasons()
- [x] Actualizar HTML para usar componente de feedback
- [x] Agregar CSS para nuevo layout
- [x] Actualizar tipos en medical-agent-events.service.ts
- [x] Compilar sin errores
- [x] Crear documentación de integración

---

## 🚀 Próximos Pasos

1. **Probar en desarrollo**: `npm run dev` → Chat Zoe
2. **Hacer preguntas**: Ver componente de feedback funcionando
3. **Dar feedback**: Marcar respuestas como correctas/incorrectas
4. **Monitorear aprendizaje**: Ver estadísticas en `/zoe/learning-stats`
5. **Iterar**: Zoe mejora con cada feedback

---

## 💡 Tips

- **Debug**: Abrir DevTools (F12) → Console → Ver logs de feedback
- **Datos**: Ver `sdk/zoe-feedback.jsonl` para todos los feedbacks registrados
- **Aprendizaje**: Ver `sdk/zoe-learned-patterns.json` para patrones aprendidos
- **Stats**: `curl http://localhost:3030/zoe/learning-stats` para ver estadísticas

---

**Documentación de Integración Completada: 21 de abril de 2026**

La UI ya está lista para que Zoe aprenda automáticamente del feedback de los usuarios. ✨
