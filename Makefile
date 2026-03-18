DB_URL := "postgres://postgres:password@db:5432/publira?sslmode=disable"
MIGRATE := migrate -path db/migrations -database $(DB_URL)

.PHONY: setup gen db-init db-reset db-status db-rollback db-new dev-api dev-web run-batch-publish

setup:
	pnpm install
	cd server && go mod tidy

gen:
	sqlc generate
	buf generate proto

db-init:
	$(MIGRATE) up

db-reset:
	psql $(DB_URL) -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
	$(MAKE) db-init

db-status:
	$(MIGRATE) version

db-rollback:
	$(MIGRATE) down 1

db-new:
	@if [ -z "$(name)" ]; then echo "usage: make db-new name=add_sessions_table"; exit 1; fi
	migrate create -ext sql -dir db/migrations -tz UTC $(name)

dev-api:
	APP_ENV=local go run ./server/cmd/api-server

dev-web:
	pnpm turbo run dev

run-batch-publish:
	APP_ENV=local go run ./server/cmd/publish-episodes
