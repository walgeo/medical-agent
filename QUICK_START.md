# 🚀 Quick Start - Zoe Learning Engine

Guía rápida para empezar a usar el sistema de autoaprendizaje de Zoe.

---

## ⚡ 30 Segundos de Setup

### 0. Preparar voz offline (sin instalación manual)
```bash
cd /home/walgeo/medical-agent
npm run setup:tts-bundled
# Descarga Piper + modelo base a vendor/tts
```

### 1. Compilar
```bash
cd /home/walgeo/medical-agent
npm run build
# ✅ Si no hay errores, completó exitosamente
```

### 2. Iniciar Backend
```bash
# Terminal 1: Ollama (si aún no corre)
ollama serve

# Terminal 2: Backend
set -a && source .env.ollama && set +a && npm run dev
# Deberías ver: "SSE EventPublisher running on port 3030"
```

El backend intenta primero usar Piper desde el bundle del proyecto (vendor/tts) y solo después motores del sistema.

### 3. Probar API
```bash
# Terminal 3: Prueba de Zoe
curl -X POST http://localhost:3030/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "cuántos pacientes hay?",
    "history": []
  }'

# Respuesta: { "response": "...", "confidence": 0.85, "route": "tool", ... }
```

---

## 💬 Flujo Básico

### A. Primera Pregunta (Zoe sin contexto)
```bash
curl -X POST http://localhost:3030/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "cuántos pacientes en odontología?",
    "history": []
  }'

# Response:
# {
#   "response": "En Odontología hay 2 pacientes registrados.",
#   "confidence": 0.90,
#   "route": "tool",
#   "tool": "count_by_specialty",
#   "adapted": false
# }
```

### B. Usuario da Feedback (Corrección)
```bash
curl -X POST http://localhost:3030/zoe/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "userQuery": "cuántos pacientes en odontología?",
    "zoeResponse": "En Odontología hay 2 pacientes registrados.",
    "feedback": "incorrect",
    "userCorrection": "En Odontología hay 3 pacientes (incluyendo reagendadas)"
  }'

# Response:
# {
#   "message": "Feedback registrado. Gracias...",
#   "stats": {
#     "totalFeedback": 1,
#     "correctCount": 0,
#     "incorrectCount": 1,
#     "learnedPatterns": 1,
#     "avgConfidence": 0.30
#   }
# }
```

### C. Siguiente Sesión (Zoe Mejorada)
```bash
curl -X POST http://localhost:3030/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "pacientes odontología?",
    "history": []
  }'

# Response:
# {
#   "response": "En Odontología hay 3 pacientes (incluyendo reagendadas)",
#   "confidence": 0.95,
#   "route": "learned",
#   "adapted": false
# }
# ✅ Zoe usó el patrón aprendido del feedback anterior!
```

---

## 📊 Monitorear Aprendizaje

### Ver Estadísticas
```bash
curl http://localhost:3030/zoe/learning-stats | jq '.'
```

### Ver Feedback Reciente
```bash
curl "http://localhost:3030/zoe/recent-feedback?limit=5" | jq '.[] | {query: .userQuery, feedback: .userFeedback}'
```

### Ver Archivo de Aprendizaje
```bash
cat sdk/zoe-learned-patterns.json | jq '.[0]'
```

---

## 🎯 Escenarios Comunes

### Escenario 1: Zoe Es Honesta
```bash
# Usuario pregunta algo vago
curl -X POST http://localhost:3030/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "información general", "history": []}'

# Zoe responde honestamente:
# "No tengo una respuesta confiable para eso..."
# (confidence < 65%)
```

### Escenario 2: Respuesta con HTML
```bash
curl -X POST http://localhost:3030/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "tabla de citas de hoy", "history": []}'

# Zoe devuelve:
# {
#   "response": "<table>...</table>",
#   "isHtml": true,
#   "confidence": 0.92
# }
```

### Escenario 3: Follow-up Question
```bash
curl -X POST http://localhost:3030/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "en cardiology?",
    "history": [
      {"role": "user", "content": "cuántos pacientes hay?"},
      {"role": "zoe", "content": "Hay 12 pacientes registrados."}
    ]
  }'

# Zoe entiende que es follow-up:
# "En Cardiology hay 3 pacientes."
# (confidence ajustado porque es follow-up)
```

---

## 🔍 Debugging

### Logs en Desarrollo
```bash
# Terminal con npm run dev mostrará:
# ZOE_CHAT_PROCESSED: message=... route=... confidence=...
# LEARNING_ENGINE: pattern_matched=... learned_patterns=...
```

### Archivo de Feedback
```bash
# Ver los últimos feedbacks registrados
tail -3 sdk/zoe-feedback.jsonl

# Ver count de feedbacks
wc -l sdk/zoe-feedback.jsonl
```

### Limpieza (Borrar Aprendizaje)
```bash
# ⚠️ CUIDADO - Esto borra todo lo aprendido
rm sdk/zoe-learned-patterns.json
rm sdk/zoe-feedback.jsonl

# Zoe volverá a empezar a aprender desde cero
```

---

## 🎓 Ejemplo Completo (Test Manual)

### Paso 1: Chat inicial
```bash
# Pregunta 1
curl -X POST http://localhost:3030/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "pacientes hoy?", "history": []}'
# → Respuesta: confianza 0.90, route "tool"
```

### Paso 2: Marcar como correcto
```bash
curl -X POST http://localhost:3030/zoe/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "userQuery": "pacientes hoy?",
    "zoeResponse": "Hay 12 pacientes registrados.",
    "feedback": "correct"
  }'
# → stats: totalFeedback=1, correctCount=1
```

### Paso 3: Misma pregunta variante
```bash
curl -X POST http://localhost:3030/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "cuántos pacientes?", "history": []}'
# → Debería usar patrón aprendido, confianza > 0.85
```

### Paso 4: Ver aprendizaje  
```bash
curl http://localhost:3030/zoe/learning-stats | jq '.'
# {
#   "totalFeedback": 1,
#   "correctCount": 1,
#   "learnedPatterns": 1,
#   "avgConfidence": 0.85
# }
```

---

## 🌐 Integración Angular (UI)

### En tu componente
```typescript
import { ZoeLearningClient } from './zoe-learning.client';

export class MedicalAgentComponent {
  constructor(private learning: ZoeLearningClient) {}

  // Enviar feedback desde UI
  markAsCorrect(query: string, response: string) {
    this.learning.submitFeedback(query, response, 'correct').subscribe(
      result => console.log('Stats:', result.stats)
    );
  }

  // Ver estadísticas
  loadStats() {
    this.learning.getLearningStats().subscribe(
      stats => this.showStats(stats)
    );
  }
}
```

### Usar componente con feedback
```html
<app-zoe-response-with-feedback
  [userQuery]="lastQuery"
  [zoeResponse]="zoeResponse"
  [confidence]="0.85"
  [route]="'tool'"
  (feedbackSubmitted)="onFeedback($event)"
>
</app-zoe-response-with-feedback>
```

---

## ⚙️ Configuración Rápida

### Cambiar Umbral de Confianza
Editar [src/infrastructure/learning/ZoeConfidenceEngine.ts](src/infrastructure/learning/ZoeConfidenceEngine.ts#L15):
```typescript
private readonly minConfidenceThreshold = 0.75;  // Cambiar de 0.65 a 0.75
```

### Cambiar Contexto de Conversación
Editar [src/infrastructure/learning/ZoeConfidenceEngine.ts](src/infrastructure/learning/ZoeConfidenceEngine.ts#L18):
```typescript
private readonly conversationContext: Array<...> = [];
// En método addToContext(), cambiar máximo de 10 a 20 mensajes
```

---

## ✅ Checklist de Implementación

- [x] Backend compilando sin errores
- [x] `/chat` POST endpoint funcionando
- [x] `/zoe/feedback` POST endpoint funcional
- [x] `/zoe/learning-stats` GET endpoint funcional
- [x] `sdk/zoe-feedback.jsonl` creándose
- [x] `sdk/zoe-learned-patterns.json` creándose con patrones
- [x] Cliente Angular (`ZoeLearningClient`) disponible
- [x] Componente de feedback (`ZoeResponseWithFeedbackComponent`) funcional
- [x] Demo (`ZoeLearningDemoComponent`) integrada

---

## 🚨 Troubleshooting

### "Zoe siempre da la misma respuesta"
→ Aumentar números de patrones en `executeZoeTooling()`

### "Feedback no se registra"
→ Verificar `sdk/` existe y tiene permisos de escritura

### "Confianza siempre 100%"
→ Normal para respuestas de tools. Marca como "incorrect" para que baje.

### "El patrón no se reconoce"
→ Fuzzy matching busca 50%+ similitud. Usar palabras comunes clave.

---

## 📚 Documentación Completa

- [ZOE_LEARNING_GUIDE.md](ZOE_LEARNING_GUIDE.md) - Guía detallada
- [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) - Resumen técnico
- [src/infrastructure/learning/README.md](src/infrastructure/learning/README.md) - API interna

---

## 🎉 ¡Listo!

Zoe ahora aprende automáticamente de tu feedback. No necesitas modificar código, solo marca respuestas como correctas/incorrectas y Zoe mejora en la próxima sesión.

**Próximo paso**: Integra el componente de feedback en tu UI médica y ¡déjala aprender!

---

_Implementado: 21 de abril de 2026_
