DB_URL := "postgres://postgres:password@db:5432/publira?sslmode=disable"
MIGRATE := migrate -path db/migrations -database $(DB_URL)

.PHONY: setup gen build-server db-init db-reset db-status db-rollback db-new dev-api dev-admin-api dev-platform-api dev-web run-batch-publish

setup:
	pnpm install
	$(MAKE) -C server tidy

gen:
	sqlc generate
	buf generate

build-server:
	$(MAKE) -C server build

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
	$(MAKE) -C server dev-api

dev-admin-api:
	$(MAKE) -C server dev-admin-api

dev-platform-api:
	$(MAKE) -C server dev-platform-api

dev-web:
	pnpm dev

run-batch-publish:
	$(MAKE) -C server run-batch-publish
