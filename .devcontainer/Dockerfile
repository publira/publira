FROM mcr.microsoft.com/devcontainers/go:2.1.1-1.26-bookworm@sha256:4da2693c134c65e87f73fcebcd4b3c0e8a9b208384fd8c1f84c4414b5cd06c20

RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
 && apt-get -y install --no-install-recommends postgresql-client

USER vscode

RUN go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest \
 && go install github.com/bufbuild/buf/cmd/buf@latest
