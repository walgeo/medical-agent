# Zoe Learning Engine - Sistema de Autoaprendizaje

## 🎯 Visión General

El sistema de aprendizaje de Zoe permite que responda con **honestidad** sobre su confianza, **aprenda** de los feedbacks del usuario, y **mejore continuamente** sin requerir modificaciones de código.

### Características Principales

1. **Confianza Inteligente**: Zoe evalúa su confianza en cada respuesta (0-100%)
2. **Honestidad Automática**: Si no está segura, lo dice explícitamente
3. **Aprendizaje Persistente**: Guarda patrones de consultas correctas en JSON
4. **Feedback de Usuario**: API para marcar respuestas como correctas/incorrectas
5. **Mejora Continua**: Las respuestas mejorar en sesiones futuras basadas en feedback previo

---

## 📊 Cómo Funciona

### 1. Evaluación de Confianza

Cada respuesta de Zoe se evalúa según:

```
Confianza = BaseLine(según ruta) + LLMScore + AjustesCalidad + ContextoConversación
```

**Rutas y su confianza base:**
- **Tools** (count, patients, tables): 85% (más confiables)
- **LLM Premium** (OpenAI/OpenRouter): 78%
- **LLM Local** (Ollama): 65%
- **Fallback** (genérica): 40% (menos confiable)

**Ajustes dinámicos:**
- Respuestas vagasvagas: -15%
- Respuestas con HTML/tablas: +10% (datos estructurados)
- Respuesta anterior falló: -15%
- Es una pregunta de seguimiento: -5%

### 2. Rechazo Honesto

Si la confianza cae bajo el umbral (por defecto 65%), Zoe **rechaza responder** y dice algo honesto:

#### Ejemplo 1: Consulta de conteo
**Usuario**: "cuántos pacientes con diabetes vinieron hoy?"

🤔 Zoe evalúa:
- No es una herramienta exacta (conteo específico) → Base 65%
- Sin scores de LLM → Sin cambios
- Es una pregunta específica de contexto → -5%
- **Confianza final: 60%** → ❌ Bajo umbral

**Respuesta de Zoe**:
> "No estoy completamente segura de ese conteo. ¿Podrías darme más contexto? Por ejemplo: ¿de qué período o especialidad necesitas el conteo?"

#### Ejemplo 2: Seguimiento a especialidad
**Usuario**: "cuántos pacientes hay hoy?"
Zoe responde: "Hay 12 pacientes registrados hoy"

**Usuario**: "en odontología"

🤔 Zoe evalúa:
- Es un seguimiento (refiere a anterior) → -5%
- La consulta anterior fue exitosa → Sin penalidad
- Especialidad específica → Requiere confirmar datos
- **Confianza: 70%** → ✅ Confidente

**Respuesta de Zoe**:
> "En Odontología hay 3 pacientes registrados hoy"

---

## 💾 Almacenamiento de Aprendizaje

El sistema almacena el aprendizaje en dos archivos JSON en `sdk/`:

### `zoe-feedback.jsonl` (Append-Only Log)
Cada línea es un feedback registrado:
```json
{
  "id": "feedback-1713609245000-xyz",
  "timestamp": "2026-04-21T08:40:45Z",
  "userQuery": "cuántos pacientes hay en cardiology",
  "zoeResponse": "En Cardiology hay 2 pacientes registrados",
  "userFeedback": "correct",
  "responseRoute": "tool",
  "toolUsed": "count_by_specialty",
  "confidenceScore": 0.95
}
```

### `zoe-learned-patterns.json` (Conocimiento Consolidado)
Patrones aprendidos con alta confianza:
```json
[
  {
    "query_pattern": "cuantos pacientes hay en [SPECIALTY]",
    "correct_response": "template para responder conteos por especialidad",
    "feedback_count": 5,
    "confidence": 0.85,
    "last_updated": "2026-04-21T08:40:45Z"
  }
]
```

---

## 🔧 API de Feedback

### 1. Registrar Feedback
```bash
POST /zoe/feedback
Content-Type: application/json

{
  "userQuery": "cuántos pacientes hay en cardiology",
  "zoeResponse": "En Cardiology hay 2 pacientes",
  "feedback": "correct",                  # "correct" | "incorrect" | "incomplete" | "confusing"
  "userCorrection": "opcional"            # Si feedback="incorrect", proporciona la respuesta correcta
}
```

**Respuesta:**
```json
{
  "message": "Feedback registrado. Gracias por ayudarnos a mejorar.",
  "stats": {
    "totalFeedback": 47,
    "correctCount": 38,
    "incorrectCount": 9,
    "learnedPatterns": 12,
    "avgConfidence": 0.78
  }
}
```

### 2. Ver Estadísticas de Aprendizaje
```bash
GET /zoe/learning-stats
```

**Respuesta:**
```json
{
  "totalFeedback": 47,
  "correctCount": 38,
  "incorrectCount": 9,
  "learnedPatterns": 12,
  "avgConfidence": 0.78
}
```

### 3. Ver Feedback Reciente
```bash
GET /zoe/recent-feedback?limit=20
```

**Respuesta**: Array de los últimos 20 feedbacks registrados

---

## 📋 Ejemplo de Flujo Completo

### Sesión 1: Zoe comete un error

1. **Usuario**: "nombres de los pacientes"
   
2. **Zoe**: "No tengo una respuesta confiable para eso en este momento. ¿Puedo ayudarte con algo más específico?"
   - Confianza: 40% (fallback muy bajo)
   - Ruta: fallback
   
3. **Usuario marca feedback**:
   ```json
   {
     "userQuery": "nombres de los pacientes",
     "zoeResponse": "No tengo una respuesta confiable...",
     "feedback": "incorrect",
     "userCorrection": "Los pacientes son: Juan García, María López, Carlos Ruiz"
   }
   ```

4. **Sistema aprende**:
   - Almacena el patrón: `pacientes` → usar tool `patients_by_specialty`
   - Guarda la corrección correcta
   - Incrementa feedback_count para ese patrón

### Sesión 2: Zoe ahora responde mejor

1. **Usuario**: "quiénes son los pacientes hoy?"
   
2. **Zoe evalúa**:
   - Detecta patrón aprendido: "pacientes"
   - Encuentra respuesta correcta anterior: "Los pacientes son: Juan García, María López, Carlos Ruiz"
   - Confianza del patrón aprendido: 0.9 (90%)
   
3. **Zoe responde**:
   > "Los pacientes son: Juan García, María López, Carlos Ruiz"
   - Confianza: 90%
   - Ruta: learned (patrón previamente aprendido)

---

## 🎓 Cómo Zoe se Autoeducazaenseña (Sin Código)

### Fase 1: Honestidad (Primeras interacciones)
```
Zoe: "No sé cómo responder eso"
Usuario: [Proporciona feedback]
Sistema: Almacena en JSON
```

### Fase 2: Reconocimiento (Próximas sesiones)
```
Zoe: ¿Vi esta pregunta antes?
Sistema: [Busca en patrones aprendidos] → SÍ
Zoe: Uso la respuesta anterior + datos actuales
```

### Fase 3: Mejora Continua
```
Cada feedback → Actualiza confianza
Confianza > 0.8 → Es patrón confiable
Se usa automáticamente sin código nuevo
```

---

## ⚙️ Configuración

### .env.ollama
```bash
# Learning engine timeouts
ZOE_CHAT_TIMEOUT_MS=7000

# Estos afectan la evaluación de confianza
LLM_DECISION_TIMEOUT_MS=32000
LLM_RECOMMENDATION_TIMEOUT_MS=22000
```

### Umbrales por Défault

| Parámetro | Valor | Descripción |
|-----------|-------|-------------|
| `minConfidenceThreshold` | 0.65 (65%) | Bajo este valor, Zoe es honesta |
| `minToolConfidence` | 0.80 (80%) | Tools requieren mayor confianza |
| `conversationContextWindow` | 10 mensajes | Historial para evaluar contexto |

---

## 📱 Integración con UI (Angular)

### Componente para Feedback

```typescript
// Después de que Zoe responde
sendFeedback(userQuery: string, zoeResponse: string, feedback: 'correct' | 'incorrect') {
  const payload = {
    userQuery,
    zoeResponse,
    feedback,
    userCorrection: feedback === 'incorrect' ? this.userCorrectionText : undefined
  };
  
  this.http.post('/zoe/feedback', payload).subscribe(
    (response) => {
      console.log('Feedback registrado:', response.stats);
      // Mostrar: "Gracias por ayudarnos a mejorar"
    }
  );
}
```

### Indicadores en UI

```html
<!-- Mostrar confianza de Zoe en cada respuesta -->
<div class="zoe-response" [class.low-confidence]="confidence < 0.65">
  <p>{{ zoeResponse }}</p>
  <small>Confianza: {{ (confidence * 100).toFixed(0) }}%</small>
</div>

<!-- Botones de feedback -->
<button (click)="sendFeedback('correct')" [disabled]="confidence < 0.6">
  ✅ Correcto
</button>
<button (click)="sendFeedback('incorrect')">
  ❌ Incorrecto
</button>
```

---

## 🔍 Debugging

### Ver estadísticas en tiempo real
```bash
curl http://localhost:3030/zoe/learning-stats
```

### Ver feedbacks recientes (últimos 10)
```bash
curl "http://localhost:3030/zoe/recent-feedback?limit=10"
```

### Monitorear patrones aprendidos
```bash
cat sdk/zoe-learned-patterns.json | jq '.[] | {query_pattern, confidence, feedback_count}'
```

---

## 🎯 Próximas Mejoras

- [ ] Dashboard UI para ver estadísticas de aprendizaje
- [ ] Alertas cuando un patrón tiene confianza baja
- [ ] Exportar/importar datasets de entrenamiento
- [ ] Análisis automático de errores comunes
- [ ] A/B testing de respuestas alternativas

---

## ❓ FAQ

**P: ¿Zoe olvida lo aprendido cuando se reinicia?**
R: No. El aprendizaje se almacena en JSON en `sdk/`, es persistente.

**P: ¿Cuánto tiempo tarda Zoe en aceptar feedback?**
R: Inmediatamente. En la siguiente sesión usa el feedback aprendido.

**P: ¿Puedo entrenar Zoe con muchos ejemplos de una vez?**
R: Sí, agregar registros a `zoe-feedback.jsonl` y Zoe los usará automáticamente.

**P: ¿Qué pasa si doy feedback contradictorio?**
R: El sistema reduce confianza en ese patrón (-15%) hasta recibir más feedback consistente.

**P: ¿Necesito reiniciar el servidor para que Zoe aprenda?**
R: No. El learning es dinámico, se aplica en la siguiente consulta.

---

## 📄 Licencia

Sistema integrado en medical-appointment-agent. Uso interno del equipo clínico.
