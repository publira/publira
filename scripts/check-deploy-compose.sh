#!/usr/bin/env bash
# check-deploy-compose.sh — Fail when infra/deploy/compose.yaml does not render,
# when its .env.example does not list exactly the variables it reads, or when
# the .env `publiractl env generate` writes from it leaves a secret empty.
#
# Rendering runs with every profile active and every empty value in
# .env.example filled in, so a required variable the example leaves out fails
# here instead of on an operator's host. The generated .env is rendered again
# with only the values an operator chooses filled in, so a secret the example
# gains without an entry in the generator fails here too. CI runs the same
# script in `Test / Deploy`.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"

compose_file=infra/deploy/compose.yaml
env_example=infra/deploy/.env.example

# The Dev Container exports PUBLIRA_* for `task dev`, and Compose would let
# them override the env file.
for name in $(compgen -e); do
  case "${name}" in
    PUBLIRA_* | COMPOSE_*) unset "${name}" ;;
  esac
done

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

# COMPOSE_PROFILES is read by Compose itself rather than interpolated.
grep -E '^[A-Z_][A-Z0-9_]*=' "${env_example}" | cut -d= -f1 | grep -vx COMPOSE_PROFILES | sort > "${work}/listed"

docker compose -f "${compose_file}" --env-file /dev/null config --variables |
  awk 'NR > 1 { print $1 }' | sort > "${work}/referenced"

failed=0
if missing="$(comm -13 "${work}/listed" "${work}/referenced")" && [ -n "${missing}" ]; then
  echo "${compose_file} reads variables ${env_example} does not list:" >&2
  echo "${missing}" | sed 's/^/  /' >&2
  failed=1
fi
if unused="$(comm -23 "${work}/listed" "${work}/referenced")" && [ -n "${unused}" ]; then
  echo "${env_example} lists variables ${compose_file} does not read:" >&2
  echo "${unused}" | sed 's/^/  /' >&2
  failed=1
fi

sed -E '/^COMPOSE_PROFILES=/! s/^([A-Z_][A-Z0-9_]*)=$/\1=placeholder/' "${env_example}" > "${work}/.env"
if ! COMPOSE_PROFILES=web-platform,email-renderer,publiractl \
  docker compose -f "${compose_file}" --env-file "${work}/.env" config --quiet; then
  echo "${compose_file} does not render with the values ${env_example} lists." >&2
  failed=1
fi

# The generator writes every secret the example lists, and the operator fills
# in the image tag and the hosts and nothing else that `docker compose`
# requires. A secret is named for what it is, which is how one that only an
# optional process reads, and that rendering cannot require, is found.
go -C server run ./cmd/publiractl env generate \
  --template "${repo_root}/${env_example}" --output "${work}/generated.env" > /dev/null
secret_names="$(grep -E '_(PASSWORD|SECRET|TOKEN|KEY|KEYS)$' "${work}/listed" || true)"
for name in ${secret_names}; do
  if ! grep -qE "^${name}=.+" "${work}/generated.env"; then
    echo "publiractl env generate leaves ${name} empty; add it to deployenv.Secrets." >&2
    failed=1
  fi
done
sed -i -E 's/^(PUBLIRA_IMAGE_TAG|PUBLIRA_EDGE_SITE_HOSTS|PUBLIRA_EDGE_ADMIN_HOSTS)=$/\1=placeholder/' "${work}/generated.env"
if ! COMPOSE_PROFILES=web-platform,email-renderer,publiractl \
  docker compose -f "${compose_file}" --env-file "${work}/generated.env" config --quiet; then
  echo "${compose_file} does not render with the .env publiractl env generate writes and the image tag and hosts filled in." >&2
  failed=1
fi

if [ "${failed}" -ne 0 ]; then
  exit 1
fi
echo "${compose_file} renders, ${env_example} lists every variable it reads, and publiractl env generate fills in every secret."
