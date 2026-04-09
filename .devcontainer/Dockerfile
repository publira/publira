FROM mcr.microsoft.com/devcontainers/go:2.1.1-1.26-bookworm@sha256:4da2693c134c65e87f73fcebcd4b3c0e8a9b208384fd8c1f84c4414b5cd06c20

# renovate: datasource=github-releases depName=go-task/task versioning=semver-coerced
ARG TASK_VERSION=3.49.1
# renovate: datasource=github-releases depName=sqlc-dev/sqlc versioning=semver-coerced
ARG SQLC_VERSION=1.30.0
# renovate: datasource=github-releases depName=bufbuild/buf versioning=semver-coerced
ARG BUF_VERSION=1.66.1
# renovate: datasource=github-releases depName=golang-migrate/migrate versioning=semver-coerced
ARG MIGRATE_VERSION=4.19.1
# renovate: datasource=flutter-version depName=flutter
ARG FLUTTER_VERSION=3.41.6

RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
 && apt-get -y install --no-install-recommends postgresql-client \
    clang cmake ninja-build pkg-config libgtk-3-dev unzip xz-utils

RUN set -eux; \
  sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d v${TASK_VERSION}; \
	arch="$(dpkg --print-architecture)"; \
	case "$arch" in \
		amd64) sqlc_arch="amd64"; buf_arch="x86_64"; migrate_arch="amd64" ;; \
		arm64) sqlc_arch="arm64"; buf_arch="aarch64"; migrate_arch="arm64" ;; \
		*) echo "Unsupported architecture: $arch"; exit 1 ;; \
	esac; \
	curl -fsSL "https://github.com/sqlc-dev/sqlc/releases/download/v${SQLC_VERSION}/sqlc_${SQLC_VERSION}_linux_${sqlc_arch}.tar.gz" \
		| tar -xz -C /tmp sqlc; \
	install -m 0755 /tmp/sqlc /usr/local/bin/sqlc; \
	rm -f /tmp/sqlc; \
	curl -fsSL "https://github.com/bufbuild/buf/releases/download/v${BUF_VERSION}/buf-Linux-${buf_arch}.tar.gz" \
		| tar -xz -C /tmp buf/bin/buf; \
	install -m 0755 /tmp/buf/bin/buf /usr/local/bin/buf; \
	rm -rf /tmp/buf; \
	curl -fsSL "https://github.com/golang-migrate/migrate/releases/download/v${MIGRATE_VERSION}/migrate.linux-${migrate_arch}.tar.gz" -o /tmp/migrate.tgz; \
	tar -xzf /tmp/migrate.tgz -C /tmp migrate; \
	install -m 0755 /tmp/migrate /usr/local/bin/migrate; \
	rm -f /tmp/migrate /tmp/migrate.tgz

# Install Flutter SDK
ENV FLUTTER_HOME=/usr/local/flutter
ENV PATH="${FLUTTER_HOME}/bin:${PATH}"
RUN curl -fsSL "https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_${FLUTTER_VERSION}-stable.tar.xz" \
	| tar -xJ -C /usr/local \
 && chown -R vscode:vscode "${FLUTTER_HOME}"

USER vscode

RUN flutter precache
