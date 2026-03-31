# API server Dockerfile (generated from infra/docker/templates/Dockerfile.api)
FROM debian:bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget golang && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY ../../go.mod ../../go.sum ./server/
RUN cd server && go mod download
COPY ../../ ./server
RUN cd server && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -trimpath -ldflags='-s -w' -o /out/platform-api-server ./cmd/platform-api-server
FROM gcr.io/distroless/static:nonroot
WORKDIR /app
COPY --from=builder /out/platform-api-server /app/platform-api-server
EXPOSE 8002
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/usr/bin/wget", "-q", "-O", "-", "http://127.0.0.1:8002/healthz"]
USER nonroot
ENTRYPOINT ["/app/platform-api-server"]
