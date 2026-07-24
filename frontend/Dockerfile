# ─── Frontend build (Node) ─────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Build-time backend URL — passed via docker-compose
ARG REACT_APP_BACKEND_URL
ENV REACT_APP_BACKEND_URL=${REACT_APP_BACKEND_URL}

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000

COPY . .
RUN yarn build

# ─── Runtime (Nginx serves static SPA) ─────────────────────────
FROM nginx:1.27-alpine AS runtime

# Custom SPA config: fallback to index.html for client routes
RUN rm /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

# Simple SPA config baked in
RUN printf 'server {\n  listen 80;\n  server_name _;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / {\n    try_files $uri /index.html;\n  }\n  location /static/ {\n    expires 30d;\n    add_header Cache-Control "public";\n  }\n  gzip on;\n  gzip_types text/plain application/json application/javascript text/css text/xml application/xml image/svg+xml;\n}\n' > /etc/nginx/conf.d/spa.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
