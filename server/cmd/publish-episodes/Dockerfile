# Batch job Dockerfile (generated from infra/docker/templates/Dockerfile.batch)
FROM debian:bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates golang && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY ../../go.mod ../../go.sum ./server/
RUN cd server && go mod download
COPY ../../ ./server
RUN cd server && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -trimpath -ldflags='-s -w' -o /out/publish-episodes ./cmd/publish-episodes
FROM gcr.io/distroless/static:nonroot
WORKDIR /app
COPY --from=builder /out/publish-episodes /app/publish-episodes
USER nonroot
ENTRYPOINT ["/app/publish-episodes"]
