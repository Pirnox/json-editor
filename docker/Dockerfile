# syntax=docker/dockerfile:1

# Static, offline, single-page app — no build step, no runtime, no
# server-side processing of user data. The "unprivileged" nginx image
# already runs as a non-root user and listens on a high port (8080),
# which keeps the container safe to run with --read-only and without
# extra capabilities.
FROM nginxinc/nginx-unprivileged:1.27-alpine

LABEL org.opencontainers.image.title="Edytor JSON / YAML / TOML" \
      org.opencontainers.image.description="Self-contained, client-side editor for JSON, YAML and TOML. The server only ever serves static files — it never reads, logs or stores anything users paste, upload or edit." \
      org.opencontainers.image.licenses="MIT"

# Hardened server config: logging disabled, security headers, gzip, caching.
COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf

# Static assets only — html/css/js, nothing else ships in the image.
COPY --chown=nginx:nginx src/ /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
