# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer cache friendly)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine

LABEL maintainer="Oytun"
LABEL version="2.0.3"

# Non-root user
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

# Copy installed node_modules from builder
COPY --from=builder --chown=app:app /app/node_modules ./node_modules

# Copy source
COPY --chown=app:app package.json ./
COPY --chown=app:app src ./src
COPY --chown=app:app docs ./docs

# The Language Server binary is NOT bundled (closed-source Windsurf release);
# mount it at runtime via docker-compose volume.
ENV LS_BINARY_PATH=/opt/windsurf/language_server_linux_x64
ENV PORT=3003
ENV LS_PORT=42100
ENV LOG_LEVEL=info
ENV NODE_ENV=production

# Writable runtime directories
RUN mkdir -p /app/logs /app/data /tmp/windsurf-workspace \
    && chown -R app:app /app /tmp/windsurf-workspace

USER app

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3003/health || exit 1

CMD ["node", "src/index.js"]
