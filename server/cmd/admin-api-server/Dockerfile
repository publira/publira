# API server Dockerfile (generated from infra/docker/templates/Dockerfile.api)
FROM debian:bookworm-slim@sha256:4724b8cc51e33e398f0e2e15e18d5ec2851ff0c2280647e1310bc1642182655d AS builder
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget golang && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY ../../go.mod ../../go.sum ./server/
RUN cd server && go mod download
COPY ../../ ./server
RUN cd server && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -trimpath -ldflags='-s -w' -o /out/admin-api-server ./cmd/admin-api-server
FROM gcr.io/distroless/static:nonroot@sha256:f7f8f729987ad0fdf6b05eeeae94b26e6a0f613bdf46feea7fc40f7bd72953e6
WORKDIR /app
COPY --from=builder /out/admin-api-server /app/admin-api-server
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/usr/bin/wget", "-q", "-O", "-", "http://127.0.0.1:8001/healthz"]
USER nonroot
ENTRYPOINT ["/app/admin-api-server"]
