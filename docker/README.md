# Edytor JSON / YAML / TOML — wersja kontenerowa

Ten katalog zawiera tę samą aplikację co `../json_editor.html`, ale podzieloną
na osobne pliki (`index.html`, `assets/css/style.css`, `assets/js/app.js`)
i zapakowaną do obrazu Dockera gotowego do uruchomienia w dowolnym miejscu.

## Najważniejsze właściwości

- **100% po stronie przeglądarki** — serwer (nginx) jedynie serwuje statyczne
  pliki. Nic, co użytkownik wklei, wczyta lub edytuje, nigdy nie trafia na
  serwer ani nie jest zapisywane.
- **Brak logów** — `access_log off` w konfiguracji nginx: serwer nie zapisuje
  nawet adresów IP, ścieżek czy nagłówków żądań. Wszystko pozostaje anonimowe.
- **Obraz bez roota** — bazuje na `nginxinc/nginx-unprivileged`, działa jako
  zwykły użytkownik na porcie 8080.
- **Twarde nagłówki bezpieczeństwa** — CSP, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` i inne.
- **Wydajność** — kompresja gzip, długie cache'owanie zasobów statycznych
  (`css`/`js`), brak zbędnych zależności w obrazie (sam nginx + pliki app).

## Budowanie i uruchamianie

```bash
cd docker
docker build -t json-editor:latest .

# Najbardziej restrykcyjnie: tylko-do-odczytu system plików, bez nowych uprawnień
docker run --rm -p 8080:8080 \
  --read-only \
  --tmpfs /tmp \
  --tmpfs /var/cache/nginx \
  --tmpfs /var/run \
  --security-opt no-new-privileges \
  --cap-drop ALL \
  json-editor:latest
```

Aplikacja będzie dostępna pod `http://localhost:8080`.

## docker-compose (opcjonalnie)

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

## Kontrola stanu

Obraz udostępnia endpoint `/healthz` (zwraca `200 ok`) używany przez
wbudowany `HEALTHCHECK`.
