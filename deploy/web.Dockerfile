# The console, hosted widget page and widget.js, served by Caddy — which also
# proxies the API on the same origin and gets the TLS certificate.
FROM node:24-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# Same origin as the API (Caddy proxies it), so no VITE_API_BASE.
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
