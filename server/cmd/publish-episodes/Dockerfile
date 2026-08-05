# Batch job Dockerfile (generated from infra/docker/templates/Dockerfile.batch)
FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241 AS builder
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates golang && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY ../../go.mod ../../go.sum ./server/
RUN cd server && go mod download
COPY ../../ ./server
RUN cd server && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -trimpath -ldflags='-s -w' -o /out/publish-episodes ./cmd/publish-episodes
FROM gcr.io/distroless/static:nonroot@sha256:f7f8f729987ad0fdf6b05eeeae94b26e6a0f613bdf46feea7fc40f7bd72953e6
WORKDIR /app
COPY --from=builder /out/publish-episodes /app/publish-episodes
USER nonroot
ENTRYPOINT ["/app/publish-episodes"]
