package sqldb

import "testing"

const getTenantByID = `-- name: GetTenantByID :one
SELECT id, public_id, domain, name
FROM tenants
WHERE id = $1
`

func TestSQLOperationReadsTheKeywordPastTheSqlcHeader(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name  string
		query string
		want  string
	}{
		{name: "sqlc select", query: getTenantByID, want: "SELECT"},
		{name: "bare statement", query: "SELECT set_config('app.current_tenant_id', $1, false)", want: "SELECT"},
		{name: "lowercase", query: "insert into tenants (id) values ($1)", want: "INSERT"},
		{name: "leading blank lines", query: "\n\n  UPDATE tenants SET name = $1\n", want: "UPDATE"},
		{name: "comment only", query: "-- nothing to run\n", want: ""},
		{name: "empty", query: "", want: ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := sqlOperation(tc.query); got != tc.want {
				t.Errorf("sqlOperation() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestSQLCQueryNameReadsTheGeneratedHeader(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name  string
		query string
		want  string
	}{
		{name: "generated", query: getTenantByID, want: "GetTenantByID"},
		{name: "exec annotation", query: "-- name: DeleteTenant :exec\nDELETE FROM tenants WHERE id = $1\n", want: "DeleteTenant"},
		{name: "hand written", query: "SELECT set_config('app.current_tenant_id', $1, false)", want: ""},
		{name: "unrelated comment first", query: "-- housekeeping\n-- name: GetTenantByID :one\nSELECT 1\n", want: ""},
		{name: "empty", query: "", want: ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := sqlcQueryName(tc.query); got != tc.want {
				t.Errorf("sqlcQueryName() = %q, want %q", got, tc.want)
			}
		})
	}
}
