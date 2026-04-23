# Web Push - Guia Rapida de Pruebas

Este proyecto ya soporta SSE + Web Push. Para probarlo en local:

## 1) Levantar backend con VAPID

Desde la raiz del proyecto:

```bash
set -a
source .env.push.test
set +a
npm run dev
```

Verificacion rapida (en otra terminal):

```bash
curl http://localhost:7071/push/public-key
```

Debes ver `"enabled":true` y la llave publica.

## 2) Levantar frontend Angular

En otra terminal:

```bash
cd angular-agent-demo
npm start
```

Abre `http://localhost:4200`.

## 3) Dar permiso y registrar push

1. Haz clic en "Activar notificaciones" en la UI.
2. Acepta el permiso del navegador.
3. Manten la app abierta al menos una vez para que registre su suscripcion.

## 4) Probar recepcion de alertas

Cuando el agente emita eventos:

- La app muestra tarjetas en tiempo real (SSE).
- Se muestra overlay dentro de la app.
- Llega notificacion del navegador (Web Push), incluso si la pestana no esta al frente.

## Notas importantes

- En local, `localhost` permite Service Worker sin HTTPS.
- Si cierras completamente el navegador, depende del soporte del navegador/SO para mantener push en background.
- Si cambias las llaves VAPID, elimina el Service Worker y vuelve a suscribirte.

## 5) Probar recomendaciones IA y feedback (sin BD)

El backend ahora publica eventos `appointment_recommendation` y habilita endpoints para gobernanza:

- `POST /recommendations/confirm`
- `POST /recommendations/feedback`
- `GET /recommendations/metrics`

Ejemplos:

```bash
curl -X POST http://localhost:7071/recommendations/confirm \
	-H "Content-Type: application/json" \
	-d '{"appointmentId":"1"}'

curl -X POST http://localhost:7071/recommendations/feedback \
	-H "Content-Type: application/json" \
	-d '{"appointmentId":"1","outcome":"accepted"}'

curl http://localhost:7071/recommendations/metrics
```

`outcome` acepta: `accepted`, `ignored`, `false_alarm`.

La app Angular ahora muestra un panel de metricas (generadas, aceptadas, ignoradas, falsa alarma)
que se actualiza en vivo consultando `GET /recommendations/metrics`.

## 6) Activar motor LLM con fallback

Opcionalmente puedes conectar un proveedor LLM por variables de entorno.
Hay un ejemplo listo en `.env.llm.example`.

Configuracion rapida:

```bash
export RECOMMENDATION_LLM_PROVIDER="openai"
export RECOMMENDATION_LLM_API_KEY="<tu_api_key>"
export RECOMMENDATION_LLM_MODEL="gpt-4o-mini"
```

Tambien puedes usar `openrouter` como proveedor o `custom` con `RECOMMENDATION_LLM_URL`.

Si el LLM falla o responde fuera de tiempo, el agente usa el motor heuristico automaticamente.
