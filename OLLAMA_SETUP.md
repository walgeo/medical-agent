# Configuración de Ollama Local para Recomendaciones IA

## 1) Instalar Ollama

### En Linux:
```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

### En macOS:
Descarga desde [ollama.ai/download](https://ollama.ai/download)

### En Windows:
Descarga desde [ollama.ai/download](https://ollama.ai/download)

## 2) Iniciar servidor Ollama

Una vez instalado, abre una terminal y arranca el servidor:

```bash
ollama serve
```

Debería mostrar algo como:
```
2026/04/21 10:30:00 Listening on 127.0.0.1:11434
```

**Mantén esta terminal abierta mientras usas el agente.**

## 3) Descargar un modelo

En otra terminal, descarga un modelo ligero recomendado para este caso:

```bash
ollama pull neural-chat
```

Otras opciones:
- `ollama pull mistral` — más rápido, algo menos preciso
- `ollama pull llama2` — más lento pero mejor calidad

La primera descarga puede tardar 5-10 minutos según tu conexión.

## 4) Verificar que está listo

```bash
curl http://localhost:11434/api/tags
```

Debes ver tu modelo en la lista.

## 5) Arrancar el agente con Ollama

En la raíz del proyecto:

```bash
set -a
source .env.ollama
set +a
npm run dev
```

El agente debe:
1. Conectar a Ollama en `http://localhost:11434/v1/chat/completions`.
2. Generar recomendaciones usando el modelo local.
3. Si falla, caer a fallback heurístico (sin interrupciones).

## 6) Probar en la UI

Abre otra terminal:

```bash
cd angular-agent-demo
npm start
```

En `http://localhost:4200`:
- Verás eventos de citas.
- Aparecerán recomendaciones generadas por el modelo local de Ollama.
- Confirma, marca ignorada o falsa alarma.
- Ve las métricas de calidad en tiempo real.

## Notas

- Ollama corre localmente, sin enviar datos a internet.
- El modelo se almacena en `~/.ollama/models/`.
- La primera llamada al modelo tardará unos segundos; las siguientes son más rápidas.
- Puedes cambiar modelos editando `.env.ollama` (variable `RECOMMENDATION_LLM_MODEL`).

## Parar Ollama

En la terminal donde corre:
```
Ctrl + C
```
