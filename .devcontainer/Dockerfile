FROM mcr.microsoft.com/devcontainers/go:2.1.1-1.26-bookworm@sha256:4da2693c134c65e87f73fcebcd4b3c0e8a9b208384fd8c1f84c4414b5cd06c20

# renovate: datasource=github-releases depName=sqlc-dev/sqlc versioning=semver-coerced
ARG SQLC_VERSION=1.30.0
# renovate: datasource=github-releases depName=bufbuild/buf versioning=semver-coerced
ARG BUF_VERSION=1.66.1

RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
 && apt-get -y install --no-install-recommends postgresql-client

RUN set -eux; \
	arch="$(dpkg --print-architecture)"; \
	case "$arch" in \
		amd64) sqlc_arch="amd64"; buf_arch="x86_64" ;; \
		arm64) sqlc_arch="arm64"; buf_arch="aarch64" ;; \
		*) echo "Unsupported architecture: $arch"; exit 1 ;; \
	esac; \
	curl -fsSL "https://github.com/sqlc-dev/sqlc/releases/download/v${SQLC_VERSION}/sqlc_${SQLC_VERSION}_linux_${sqlc_arch}.tar.gz" \
		| tar -xz -C /tmp sqlc; \
	install -m 0755 /tmp/sqlc /usr/local/bin/sqlc; \
	rm -f /tmp/sqlc; \
	curl -fsSL "https://github.com/bufbuild/buf/releases/download/v${BUF_VERSION}/buf-Linux-${buf_arch}.tar.gz" \
		| tar -xz -C /tmp buf/bin/buf; \
	install -m 0755 /tmp/buf/bin/buf /usr/local/bin/buf; \
	rm -rf /tmp/buf

USER vscode
