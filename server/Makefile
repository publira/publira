.PHONY: tidy dev-api dev-admin-api dev-platform-api run-batch-publish

tidy:
	go mod tidy

dev-api:
	go run ./cmd/api-server

dev-admin-api:
	go run ./cmd/admin-api-server

dev-platform-api:
	go run ./cmd/platform-api-server

run-batch-publish:
	go run ./cmd/publish-episodes
