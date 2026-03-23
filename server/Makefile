BIN_DIR := bin
COMMANDS := api-server admin-api-server platform-api-server publish-episodes

.PHONY: tidy build dev-api dev-admin-api dev-platform-api run-batch-publish

tidy:
	go mod tidy

build: $(COMMANDS:%=$(BIN_DIR)/%)

$(BIN_DIR)/%: | $(BIN_DIR)
	go build -o $@ ./cmd/$*

$(BIN_DIR):
	mkdir -p $(BIN_DIR)

dev-api:
	go run ./cmd/api-server

dev-admin-api:
	go run ./cmd/admin-api-server

dev-platform-api:
	go run ./cmd/platform-api-server

run-batch-publish:
	go run ./cmd/publish-episodes
