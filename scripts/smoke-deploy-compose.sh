#!/usr/bin/env bash
# smoke-deploy-compose.sh — Bring infra/deploy/compose.yaml up from the images
# `task docker:verify:full` built, take it through the steps its README
# documents, and check that the tenant site, the tenant console, and the
# Platform Console answer through the edge, and that image delivery resizes an
# image through libvips.
#
# The stack runs under its own project name, so an install on the same host is
# left alone, and is always removed with its volumes.
#
# Inputs (env):
#   PUBLIRA_DEPLOY_SMOKE_EDGE_PORT  Loopback port the edge publishes (default: 18090)
#   PUBLIRA_DEPLOY_SMOKE_TIMEOUT    Seconds to wait for each page (default: 120)
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"

edge_port="${PUBLIRA_DEPLOY_SMOKE_EDGE_PORT:-18090}"
timeout="${PUBLIRA_DEPLOY_SMOKE_TIMEOUT:-120}"
# The tenant is stored with the edge port it is reached on; the mail addresses
# take the host name alone.
domain=comics.localhost

# The Dev Container exports PUBLIRA_* for `task dev`, and Compose would let
# them override the env file.
for name in $(compgen -e); do
  case "${name}" in
    PUBLIRA_* | COMPOSE_*) unset "${name}" ;;
  esac
done

work="$(mktemp -d)"
compose() {
  docker compose -p publira-deploy-smoke -f infra/deploy/compose.yaml --env-file "${work}/.env" "$@"
}
cleanup() {
  status=$?
  if [ "${status}" -ne 0 ]; then
    compose ps --all >&2 || true
    compose logs --no-color --tail 50 >&2 || true
  fi
  compose --profile '*' down -v --remove-orphans > /dev/null 2>&1 || true
  rm -rf "${work}"
  exit "${status}"
}
trap cleanup EXIT

secret() { openssl rand -hex 32; }
rustfs_access_key="$(secret)"
rustfs_secret_key="$(secret)"
cat > "${work}/.env" << EOF
PUBLIRA_IMAGE_REGISTRY=publira
PUBLIRA_IMAGE_TAG=local
PUBLIRA_EDGE_PORT=${edge_port}
PUBLIRA_TENANT_URL_SCHEME=http
PUBLIRA_POSTGRES_PASSWORD=$(secret)
PUBLIRA_PUBLIC_DB_PASSWORD=$(secret)
PUBLIRA_ADMIN_DB_PASSWORD=$(secret)
PUBLIRA_PLATFORM_DB_PASSWORD=$(secret)
PUBLIRA_OUTBOX_DB_PASSWORD=$(secret)
PUBLIRA_TICKER_DB_PASSWORD=$(secret)
PUBLIRA_CONTENT_STATS_DB_PASSWORD=$(secret)
PUBLIRA_SECRET_ENCRYPTION_KEYS=k1:$(openssl rand -base64 32)
PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID=k1
PUBLIRA_AUTH_JWT_SECRET=$(secret)
PUBLIRA_WEB_HOST_AUTH_SECRET=$(secret)
PUBLIRA_WEB_ADMIN_AUTH_SECRET=$(secret)
PUBLIRA_REVALIDATE_TOKEN=$(secret)
PUBLIRA_WEB_SERVICE_TOKEN=$(secret)
PUBLIRA_RUSTFS_ACCESS_KEY=${rustfs_access_key}
PUBLIRA_RUSTFS_SECRET_KEY=${rustfs_secret_key}
COMPOSE_PROFILES=web-platform,email-renderer
PUBLIRA_WEB_PLATFORM_INTERNAL_URL=http://web-platform:4100
PUBLIRA_PLATFORM_APP_URL=http://platform.localhost:${edge_port}
PUBLIRA_WEB_PLATFORM_AUTH_SECRET=$(secret)
PUBLIRA_EMAIL_RENDERER_URL=http://email-renderer:8080
EOF

echo "[deploy-smoke] migrating and creating the roles"
compose run --rm -T publiractl db migrate
compose run --rm -T publiractl db roles \
  --public-password-file /run/secrets/public-db-password \
  --admin-password-file /run/secrets/admin-db-password \
  --platform-password-file /run/secrets/platform-db-password \
  --outbox-password-file /run/secrets/outbox-db-password \
  --ticker-password-file /run/secrets/ticker-db-password \
  --content-stats-password-file /run/secrets/content-stats-db-password

echo "[deploy-smoke] starting the stack"
compose up -d --wait --wait-timeout "${timeout}" postgres valkey rustfs
compose up -d

# The bucket, created the way README.md tells the operator to.
# shellcheck disable=SC2016 # expanded inside the container
compose exec -T rustfs sh -c \
  'curl -fsS -X PUT --aws-sigv4 aws:amz:us-east-1:s3 --user "$RUSTFS_ACCESS_KEY:$RUSTFS_SECRET_KEY" http://localhost:9000/publira' > /dev/null

echo "[deploy-smoke] setting the install up"
printf 'smoke' | compose run --rm -T publiractl setup --non-interactive \
  --default-locale en \
  --bucket publira --region us-east-1 --endpoint http://rustfs:9000 --force-path-style \
  --access-key-id "${rustfs_access_key}" --secret-access-key-file /run/secrets/rustfs-secret-key \
  --host smtp.invalid --port 587 --encryption starttls --username smoke --smtp-password-stdin --from-address "no-reply@${domain}" \
  --tenant-name "Smoke Comics" --domain "${domain}:${edge_port}" \
  --admin-email "owner@${domain}" --admin-name Owner --generate-admin-password > /dev/null

# Waits until the edge answers the host with a 200, following redirects, and
# with the text given when there is one; prints what it answered last otherwise.
expect_page() {
  local name="$1" host="$2" text="${3:-}"
  local deadline=$((SECONDS + timeout)) code=""
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    code="$(curl -sS -o "${work}/page" -w '%{http_code}' -L \
      --resolve "${host}:${edge_port}:127.0.0.1" "http://${host}:${edge_port}/" || true)"
    if [ "${code}" = 200 ] && { [ -z "${text}" ] || grep -qF "${text}" "${work}/page"; }; then
      echo "[deploy-smoke] ok: ${name} (${host})"
      return 0
    fi
    sleep 2
  done
  echo "[deploy-smoke] ERROR: ${name} (${host}) answered ${code:-nothing}${text:+ without \"${text}\"}" >&2
  return 1
}

expect_page "tenant site" "${domain}" "Smoke Comics"
expect_page "tenant console" "admin.${domain}"
expect_page "Platform Console" "platform.localhost"

# A long-lived process that exited or keeps restarting is a failure even when
# every page above answered.
for service in server worker web-host web-admin web-platform email-renderer proxy; do
  state="$(compose ps --all --format '{{.State}}' "${service}")"
  restarts="$(docker inspect --format '{{.RestartCount}}' "$(compose ps --all -q "${service}")")"
  if [ "${state}" != running ] || [ "${restarts}" != 0 ]; then
    echo "[deploy-smoke] ERROR: ${service} is ${state} after ${restarts} restarts" >&2
    exit 1
  fi
done
echo "[deploy-smoke] ok: every long-lived process is running"

# Image delivery converts and resizes through libvips, which the server binary
# links with CGO, so a server image whose runtime libvips does not match the
# one it was built against fails here and nowhere above. Manael answers with
# the original bytes when a conversion fails, so the check is on the output:
# a WebP, no wider than the requested width. Not exactly that width: the
# scaling Manael asks libvips for rounds, and a 64px image asked for 16px can
# come back 15px wide.
#
# A 64×32 PNG, stored the way a tenant's logo upload stores one.
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAAN0lEQVR42u3PQQkAAAgEsItjCPtjLDP4FAYrsEzXaxEQEBAQEBAQEBAQEBAQEBAQEBAQEBAQuFq5D2CIoSw0JwAAAABJRU5ErkJggg==' \
  | base64 -d > "${work}/logo.png"
# shellcheck disable=SC2016 # expanded inside the container
compose exec -T rustfs sh -c \
  'curl -fsS -X PUT --aws-sigv4 aws:amz:us-east-1:s3 --user "$RUSTFS_ACCESS_KEY:$RUSTFS_SECRET_KEY" -H "Content-Type: image/png" --data-binary @- http://localhost:9000/publira/smoke/logo.png' \
  < "${work}/logo.png" > /dev/null
image_id="$(compose exec -T postgres psql -U postgres -d publira -v ON_ERROR_STOP=1 -qtA -c "
  WITH image AS (
    INSERT INTO tenant_images (id, tenant_id) SELECT gen_random_uuid(), id FROM tenants RETURNING id, tenant_id
  )
  INSERT INTO tenant_image_variants
    (id, tenant_id, tenant_image_id, label, variant_type, storage_provider, object_key, content_type, file_size_bytes, width, height)
  SELECT gen_random_uuid(), tenant_id, id, 'logo-1x', 'logo', 's3', 'smoke/logo.png', 'image/png', $(wc -c < "${work}/logo.png"), 64, 32
  FROM image
  RETURNING tenant_image_id")"

# Prints the width of a WebP file, from whichever of the three bitstream
# headers it carries (lossy, lossless, extended), or nothing for anything else.
webp_width() {
  local file="$1" b
  [ "$(head -c 4 "${file}")" = RIFF ] && [ "$(tail -c +9 "${file}" | head -c 4)" = WEBP ] || return 0
  case "$(tail -c +13 "${file}" | head -c 4)" in
    "VP8 ")
      read -ra b <<< "$(od -An -tu1 -j26 -N2 "${file}")"
      echo $(((b[0] | b[1] << 8) & 0x3fff))
      ;;
    VP8L)
      read -ra b <<< "$(od -An -tu1 -j21 -N2 "${file}")"
      echo $(((b[0] | (b[1] & 0x3f) << 8) + 1))
      ;;
    VP8X)
      read -ra b <<< "$(od -An -tu1 -j24 -N3 "${file}")"
      echo $(((b[0] | b[1] << 8 | b[2] << 16) + 1))
      ;;
  esac
}

answer="$(curl -sS -o "${work}/logo.webp" -w '%{http_code} %{content_type}' -H 'Accept: image/webp' \
  --resolve "${domain}:${edge_port}:127.0.0.1" "http://${domain}:${edge_port}/images/tenants/${image_id}/logo?w=16" || true)"
width="$(webp_width "${work}/logo.webp")"
if [ "${answer}" != "200 image/webp" ] || [ -z "${width}" ] || [ "${width}" -lt 1 ] || [ "${width}" -gt 16 ]; then
  echo "[deploy-smoke] ERROR: image delivery answered ${answer:-nothing} at width ${width:-unknown}, want 200 image/webp at most 16px wide" >&2
  exit 1
fi
echo "[deploy-smoke] ok: image delivery resized a 64px PNG to a ${width}px WebP"
