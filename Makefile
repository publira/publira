DB_URL := "postgres://postgres:password@db:5432/kariplatform?sslmode=disable"

.PHONY: setup gen db-init db-reset dev-api dev-web run-batch-publish

setup:
	pnpm install
	cd server && go mod tidy

gen:
	sqlc generate
	buf generate proto

db-init:
	psql $(DB_URL) -f db/schema/schema.sql

db-reset:
	psql $(DB_URL) -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
	$(MAKE) db-init

dev-api:
	APP_ENV=local go run ./server/cmd/api-server

dev-web:
	pnpm turbo run dev

run-batch-publish:
	APP_ENV=local go run ./server/cmd/publish-episodes
