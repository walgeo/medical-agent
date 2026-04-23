# ---- Build stage ----
FROM node:20-slim AS builder

WORKDIR /app

# Install system deps needed for TTS setup (tar, gzip)
RUN apt-get update && apt-get install -y --no-install-recommends tar gzip ca-certificates && rm -rf /var/lib/apt/lists/*

# Install backend deps
COPY package.json tsconfig.json ./
RUN npm install --include=dev

# Install frontend deps and build Angular
COPY angular-agent-demo/package.json angular-agent-demo/
RUN cd angular-agent-demo && npm install

COPY angular-agent-demo/ angular-agent-demo/
RUN cd angular-agent-demo && npx ng build --configuration production --output-path ../dist-frontend

# Build backend TypeScript + download TTS assets
COPY src/ src/
COPY scripts/ scripts/
RUN npx tsc && node scripts/setup-bundled-tts.js

# ---- Runtime stage ----
FROM node:20-slim

WORKDIR /app

# Only runtime deps
COPY package.json ./
RUN npm install --omit=dev

# Copy compiled backend
COPY --from=builder /app/dist/ dist/

# Copy Angular build into public/ (served as static files)
COPY --from=builder /app/dist-frontend/ public/

# Copy TTS vendor (piper binary + model downloaded at build time)
COPY --from=builder /app/vendor/ vendor/

# SDK data (Zoe learned patterns)
COPY sdk/ sdk/

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/main.js"]
