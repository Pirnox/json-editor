# JSON / YAML / TOML Editor — containerized version

This directory contains the same app as `../json_editor.html`, but split
into separate files (`index.html`, `assets/css/style.css`, `assets/js/app.js`)
and packaged into a Docker image ready to run anywhere.

## Key properties

- **100% client-side** — the server (nginx) only serves static files.
  Nothing the user pastes, loads or edits ever reaches the server or gets
  saved anywhere.
- **No logging** — `access_log off` in the nginx config: the server doesn't
  record even IP addresses, paths or request headers. Everything stays anonymous.
- **Rootless image** — based on `nginxinc/nginx-unprivileged`, runs as a
  regular user on port 8080.
- **Hardened security headers** — CSP, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and more.
- **Performance** — gzip compression, long-lived caching for static assets
  (`css`/`js`), no unnecessary dependencies in the image (just nginx + app files).

## Pre-built image (no build needed)

The image is published on GitHub Container Registry — you can pull and run it directly:

```bash
docker pull ghcr.io/pirnox/json-editor:latest

docker run --rm -p 8080:8080 \
  --read-only --tmpfs /tmp --tmpfs /var/cache/nginx --tmpfs /var/run \
  --security-opt no-new-privileges --cap-drop ALL \
  ghcr.io/pirnox/json-editor:latest
```

Available tags: `latest` and versioned releases (e.g. `v1.0.0`).

> Note: the GHCR package may have been created as private. To make it
> available without logging in, the repo owner should set it to public at
> `github.com/Pirnox?tab=packages` → `json-editor` → *Package settings* →
> *Change visibility* → *Public* (changing package visibility isn't possible
> via the CLI token — it has to be done manually in GitHub's settings).

## Building your own image locally

```bash
cd docker
docker build -t json-editor:latest .

# Most restrictive: read-only filesystem, no new privileges
docker run --rm -p 8080:8080 \
  --read-only \
  --tmpfs /tmp \
  --tmpfs /var/cache/nginx \
  --tmpfs /var/run \
  --security-opt no-new-privileges \
  --cap-drop ALL \
  json-editor:latest
```

The app will be available at `http://localhost:8080`.

## docker-compose (optional)

```yaml
services:
  json-editor:
    build: ./docker
    image: json-editor:latest
    ports:
      - "8080:8080"
    read_only: true
    tmpfs:
      - /tmp
      - /var/cache/nginx
      - /var/run
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    restart: unless-stopped
```

## Health check

The image exposes a `/healthz` endpoint (returns `200 ok`) used by the
built-in `HEALTHCHECK`.
