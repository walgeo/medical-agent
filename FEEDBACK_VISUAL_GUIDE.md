# 🎬 Guía Visual - Componente de Feedback en Acción

Cómo se ve y se usa el componente de feedback integrado en la UI médica.

---

## 📱 Vista del Chat Panel con Feedback

### Antes (sin componente de feedback)

```
┌─────────────────────────────────────────┐
│  🤖  Zoe                                 │
│      Asistente de gestión de citas      │
├─────────────────────────────────────────┤
│                                         │
│ 👤 Usuario: cuántos pacientes?          │
│    14:30                                 │
│                                         │
│ 🤖 Zoe: Hay 12 pacientes registrados.   │
│    14:31                                 │
│                                         │
├─────────────────────────────────────────┤
│ [Escribe tu consulta...]        [Enviar]│
└─────────────────────────────────────────┘
```

### Después (con componente de feedback)

```
┌─────────────────────────────────────────────────────────┐
│  🤖  Zoe                                                 │
│      Asistente de gestión de citas                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 👤 Usuario: cuántos pacientes en cardiology?            │
│    14:30                                                 │
│                                                         │
│ ╔═════════════════════════════════════════════════════╗ │
│ ║ Confianza: 92%  🛠️ Tool  Herramienta: count_by...  ║ │
│ ╠═════════════════════════════════════════════════════╣ │
│ ║                                                     ║ │
│ ║ En Cardiology hay 3 pacientes registrados para      ║ │
│ ║ hoy.                                                ║ │
│ ║                                                     ║ │
│ ╠═════════════════════════════════════════════════════╣ │
│ ║ ✅ Correcto   ❌ Incorrecto  ⚠️ Incompleto  🤔 ...  ║ │
│ ╚═════════════════════════════════════════════════════╝ │
│ 14:31                                                    │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ [Escribe tu consulta...]                        [Enviar]│
└─────────────────────────────────────────────────────────┘
```

---

## 🎯 Interacciones Principales

### 1️⃣ Respuesta Confiable (Tool Exacto)

```
Pregunta del usuario:
"cuántos pacientes hay?"

┌─────────────────────────────────────────┐
│ Confianza: 95%  🛠️ Tool                │
│ Ejecutada por herramienta exacta         │
├─────────────────────────────────────────┤
│ Hay 12 pacientes registrados hoy.       │
├─────────────────────────────────────────┤
│ ✅ Correcto   ❌ Incorrecto  ⚠️ ...    │
└─────────────────────────────────────────┘

✅ Usuario hace clic en "Correcto"
   ↓
✓ Feedback registrado. Confianza: 12/14 correctas

Sistema:
- Almacena en sdk/zoe-feedback.jsonl
- Incrementa confianza del patrón en sdk/zoe-learned-patterns.json
```

### 2️⃣ Respuesta de LLM (Estimada)

```
Pregunta del usuario:
"¿Qué pacientes fueron reagendados hoy?"

┌─────────────────────────────────────────┐
│ Confianza: 78%  ⭐ Premium LLM         │
│ Procesada por LLM Premium (OpenAI)      │
├─────────────────────────────────────────┤
│ Los pacientes reagendados son:           │
│ - Diana Martínez (11:00 → 14:00)        │
│ - Carlos López                           │
├─────────────────────────────────────────┤
│ ✅ Correcto   ❌ Incorrecto  ⚠️ ...    │
└─────────────────────────────────────────┘

❌ Usuario hace clic en "Incorrecto"
   ↓
Se abre input de corrección:

   ┌────────────────────────────────────┐
   │ ¿Cuál fue la respuesta correcta?   │
   │ Proporciona aquí la corrección...  │
   │                                    │
   │ [Diana Martínez 11:00→15:00, ...] │
   │                                    │
   │ [Enviar Corrección] [Cancelar]    │
   └────────────────────────────────────┘

Usuario corrige y envía
   ↓
✓ Gracias por ayudarnos a mejorar.
  Zoe aprenderá de esto.
  14 feedbacks registrados | Confianza promedio: 81%

Sistema:
- Almacena corrección en json
- Reduce confianza (-15%)  
- Próxima pregunta similar usará mejor contexto
```

### 3️⃣ Respuesta Honesta (Baja Confianza)

```
Pregunta del usuario:
"¿Cuántas citas tuvo el paciente X el mes pasado?"

┌─────────────────────────────────────────┐
│ Confianza: 45%  ⚡ Fallback           │
│ Fallback genérico - Zoe fue honesta    │
├─────────────────────────────────────────┤
│ No tengo una respuesta confiable para   │
│ eso en este momento.                    │
│                                         │
│ ¿Puedo ayudarte con algo más            │
│ específico? Dime exactamente qué        │
│ información necesitas.                  │
├─────────────────────────────────────────┤
│ ⚠️ Incompleto  🤔 Confuso              │
└─────────────────────────────────────────┘

🤔 Usuario hace clic en "Confuso"
   ↓
✓ Feedback registrado.

Sistema:
- Marca como "confusing" 
- Próxima diferente pregunta similar será evitada hasta tener datos
```

### 4️⃣ Patrones Aprendidos (Sesión Posterior)

```
Primera sesión:
Usuario: "cuántos pacientes hoy?"
Zoe: No sé (Fallback, confianza 40%)
Usuario: [Marca "Incorrecto" + "Hay 12 pacientes"]

↓ Almacenado en patrones

Segunda sesión (nueva):
Usuario: "pacientes registrados?"

┌─────────────────────────────────────────┐
│ Confianza: 90%  🧠 Patrón Aprendido  │
│ Reconocida como patrón aprendido        │
├─────────────────────────────────────────┤
│ Hay 12 pacientes registrados hoy.       │
├─────────────────────────────────────────┤
│ ✅ Correcto   ❌ Incorrecto  ⚠️ ...    │
└─────────────────────────────────────────┘

✅ Usuario: Correcto
   ↓
✓ Patrón confirmado. Confianza: 92%

¡Zoe mejoró sin modificar código!
```

---

## 🎨 Componentes Visuales

### Badge de Confianza

```
┌─────────────────┐
│ Confianza: 92% │  ← Número dinámico, color según rango:
└─────────────────┘    • Verde (80-100%): Alta confianza
                       • Amarillo (50-79%): Media confianza
                       • Rojo (<50%): Baja confianza
```

### Badge de Ruta

```
🛠️ Tool           ← Ejecutada por herramienta exacta
⭐ Premium LLM     ← Procesada por OpenAI/OpenRouter
🖥️ Local LLM       ← Procesada por Ollama
⚡ Fallback        ← Respuesta genérica de fallback
🧠 Patrón Aprendido ← Recuperada de patrones aprendidos
```

### Botones de Feedback

```
✅ Correcto
   └─ Marca respuesta como correcta
      └─ Incrementa confianza (+10%)

❌ Incorrecto
   └─ Abre input for corrección
      └─ Reduce confianza (-15%)
      └─ Almacena corrección del usuario

⚠️ Incompleto
   └─ Respuesta parcialmente correcta
      └─ Reduce confianza (-10%)

🤔 Confuso
   └─ Respuesta no fue clara
      └─ Reduce confianza (-15%)
```

### Confirmación de Feedback

```
┌────────────────────────────────────────┐
│ ✓ Gracias por ayudarnos a mejorar,    │
│   Zoe aprenderá de esto.              │
│                                        │
│ 14 feedbacks registrados              │
│ Confianza promedio: 81%               │
│ Patrones aprendidos: 5                │
└────────────────────────────────────────┘

[Desaparece después de 4 segundos]
```

---

## 📊 Indicadores de Aprendizaje

### En Tiempo Real (Dashboard Bar)

```
┌──────────────────────────────────────────────┐
│ 📊 Estadísticas de Zoe                      │
├──────────────────────────────────────────────┤
│ Total Feedbacks: 47                          │
│ Respuestas Correctas: 38 (80%)              │
│ Patrones Aprendidos: 12                      │
│ Confianza Promedio: 81%                      │
└──────────────────────────────────────────────┘
```

### Evolución de Confianza

```
Sesión 1: Exactitud 40% (muchos fallbacks)
    ↓ Usuario da feedback
Sesión 2: Exactitud 62% (mejora)
    ↓ Usuario da más feedback
Sesión 3: Exactitud 78% (sigue mejorando)
    ↓ Usuario sigue alimentando
Sesión 4: Exactitud 85% (estable alto)
    ↓ Zoe es confiable para patrones conocidos
Sesión 5+: Exactitud 88%+ (Zoe es experta)

Gráfico (en consola):
85% ┤     ╭─────
80% ┤  ╭──╯
75% ┤╭─╯
70% ┤─╯
65% ┼────────────
    └────────────────
      Sesiones del usuario
```

---

## 🔄 Flujo de Usuario Paso a Paso

### Escenario: Médica usando Zoe durante turno

```
1. Abre Chat Panel Zoe
   ↓
2. Pregunta: "¿Citas sin completar?" 
   ↓
3. Zoe responde con Componente de Feedback
   - Muestra: "5 citas pendientes de signos vitales"
   - Confianza: 88%
   - Ruta: Tool (ejecutada por herramienta exacta)
   ↓
4. Médica ve respuesta correcta
   ↓
5. Hace clic en "✅ Correcto"
   ↓
6. Sistema muestra: "✓ Gracias por ayudarnos..."
   ↓
7. Confianza de ese patrón sube de 88% → 89%
   ↓
8. En próximas consultas similares "¿citas sin completar?",
   Zoe responde con 89% confianza
   ↓
9. Eventualmente Zoe aprende todos los patrones comunes
   ↓
10. Médica trabaja más rápido con respuestas confiables
    de Zoe, sin necesidad de recapacitar el sistema
```

---

## 🎯 Casos de Uso Real

### Caso 1: Staff administrativo
```
👤 Sofía (Secretaria):
   "¿Cuántos pacientes espera signos vitales?"
   
🤖 Zoe: "Hay 4 pacientes esperando signos vitales"
   [Confianza: 92%, Tool]
   
✅ Sofía: "Correcto"

→ Patrón aprendido: count_pending_vital_signs
```

### Caso 2: Enfermería
```
👤 Carlos (Enfermero):
   "¿Quién es el paciente siguiente?"
   
🤖 Zoe: "No tengo una respuesta confiable..."
   [Confianza: 35%, Fallback]
   
⚠️ Carlos: "Incompleto"
   Corrección: "El paciente siguiente es María López,
   cita a las 15:00 en Cardiology"

→ Patrón aprendido: next_patient_query
```

### Caso 3: Seguimiento médico
```
👤 Dr. López:
   "¿Reagendadas de hoy?"
   
🤖 Zoe: "Diana Martínez 11:00→15:00, Carlos Ruiz..."
   [Confianza: 75%, LLM Local]
   
✅ Dr. López: "Correcto"

→ Patrón confianza incrementada en 10%
```

---

## 💡 Beneficios Visibles para Usuarios

| Beneficio | Cómo se Ve |
|-----------|-----------|
| **Transparencia** | Badge de confianza muestra siempre en % |
| **Honestidad** | Cuando Zoe no está segura, lo admite (vs respuesta genérica) |
| **Aprendizaje** | Cada feedback hace a Zoe más inteligente |
| **Control** | Usuario decide si respuesta es correcta o no |
| **Mejora continua** | Confianza promedio sube sesión a sesión |
| **Feedback visual** | Confirmación inmediata cuando se registra feedback |

---

## 🚀 Cómo Probar en Desarrollo

### 1. Iniciar sistema
```bash
# Terminal 1
ollama serve

# Terminal 2
cd /home/walgeo/medical-agent
npm run dev
```

### 2. Abrir UI
```
Navegador: http://localhost:7071
```

### 3. Ir a Chat Zoe
```
Botón: "💬 Chat Zoe" en la barra superior
```

### 4. Hacer pruebas
```
Usuario: "cuántos pacientes?"
Zoe responde → Ver componente de feedback
✅ Marca como correcto
✓ Confirmación
```

### 5. Ver aprendizaje
```bash
curl http://localhost:3030/zoe/learning-stats

Respuesta:
{
  "totalFeedback": 5,
  "correctCount": 4,
  "learnedPatterns": 2,
  "avgConfidence": 0.82
}
```

---

## 🎁 Próximas Mejoras (Futuro)

- [ ] Gráfico de evolución de confianza en dashboard
- [ ] Mostrar "Zoe aprendió N patrones nuevos esta sesión"
- [ ] Notificación cuando confianza sube 10+%
- [ ] Exportar dataset de preguntas/respuestas para análisis
- [ ] Modo "Training" para entrenar Zoe sin usuarios reales

---

**Guía Visual Completada: 21 de abril de 2026**

¡Zoe ya está lista para aprender visualmente con los usuarios! ✨
