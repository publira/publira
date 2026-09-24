package main

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/testutil"
)

func TestTenantCreateWritesTheTenantAsTheSystemActor(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	var stdout, stderr bytes.Buffer

	code := runGroup(&tenantGroup, []string{
		"create",
		"-name", "Example Comics",
		"-domain", "comics.example.com",
		"-default-locale", "en",
		"-initial-admin-email", "owner@comics.example.com",
		"-initial-admin-email", "editor@comics.example.com",
	}, pipedConsole("", &stderr), &stdout)
	if code != 0 {
		t.Fatalf("exit code = %d, want 0\n%s", code, stderr.String())
	}

	ctx := context.Background()
	var tenantID uuid.UUID
	var publicID string
	var roles, invitations, mails int
	if err := pg.DB.QueryRowContext(ctx, `SELECT id, public_id FROM tenants WHERE domain = 'comics.example.com'`).Scan(&tenantID, &publicID); err != nil {
		t.Fatalf("read the tenant: %v", err)
	}
	if err := pg.DB.QueryRowContext(ctx, `SELECT
			(SELECT count(*) FROM creator_roles WHERE tenant_id = $1),
			(SELECT count(*) FROM tenant_admin_invitations WHERE tenant_id = $1),
			(SELECT count(*) FROM outbox_events WHERE tenant_id = $1)`, tenantID,
	).Scan(&roles, &invitations, &mails); err != nil {
		t.Fatalf("count the tenant's rows: %v", err)
	}
	if roles != 4 || invitations != 2 || mails != 2 {
		t.Fatalf("creator roles, invitations, mails = %d, %d, %d; want 4, 2, 2", roles, invitations, mails)
	}

	want := "Created tenant " + publicID + " for comics.example.com\n" +
		"Queued an invitation for owner@comics.example.com\n" +
		"Queued an invitation for editor@comics.example.com\n"
	if stdout.String() != want {
		t.Fatalf("stdout = %q, want %q", stdout.String(), want)
	}

	rows, err := pg.DB.QueryContext(ctx, `SELECT actor_platform_user_id, actor_role, action FROM platform_audit_logs ORDER BY id`)
	if err != nil {
		t.Fatalf("read platform_audit_logs: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var actions []string
	for rows.Next() {
		var userID uuid.NullUUID
		var role, action string
		if err := rows.Scan(&userID, &role, &action); err != nil {
			t.Fatalf("scan platform_audit_logs: %v", err)
		}
		if userID.Valid || role != auditlog.RoleSystem {
			t.Fatalf("audit entry %s is filed under %v as %q, want the system actor", action, userID, role)
		}
		actions = append(actions, action)
	}
	if got := strings.Join(actions, ","); got != "tenant_created,tenant_admin_invited,tenant_admin_invited" {
		t.Fatalf("audit actions = %s", got)
	}
}

// A refusal names the flag the Connect adapter names as a field, and nothing is
// written.
func TestTenantCreateNamesTheRefusedFlag(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	valid := []string{"-name", "Example Comics", "-domain", "comics.example.com", "-default-locale", "en"}

	var stdout, stderr bytes.Buffer
	if code := runGroup(&tenantGroup, append([]string{"create"}, valid...), pipedConsole("", &stderr), &stdout); code != 0 {
		t.Fatalf("first create: exit code = %d\n%s", code, stderr.String())
	}

	for _, tc := range []struct {
		name string
		args []string
		want string
	}{
		{name: "missing name", args: []string{"-domain", "other.example.com", "-default-locale", "en"}, want: "publiractl: -name: name is required\n"},
		{name: "missing domain", args: []string{"-name", "Other", "-default-locale", "en"}, want: "publiractl: -domain: domain is required\n"},
		{name: "unsupported locale", args: []string{"-name", "Other", "-domain", "other.example.com", "-default-locale", "fr"}, want: "publiractl: -default-locale: default_locale must be a supported locale\n"},
		{name: "malformed admin email", args: append([]string{"-initial-admin-email", "nobody"}, valid...), want: "publiractl: -initial-admin-email: invalid initial_admin_emails\n"},
		{name: "taken domain", args: valid, want: "publiractl: -domain: domain already exists\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			code := runGroup(&tenantGroup, append([]string{"create"}, tc.args...), pipedConsole("", &stderr), &stdout)
			if code != 1 {
				t.Fatalf("exit code = %d, want 1\n%s", code, stderr.String())
			}
			if stderr.String() != tc.want {
				t.Fatalf("stderr = %q, want %q", stderr.String(), tc.want)
			}
		})
	}

	var tenants int
	if err := pg.DB.QueryRowContext(context.Background(), `SELECT count(*) FROM tenants`).Scan(&tenants); err != nil {
		t.Fatalf("count tenants: %v", err)
	}
	if tenants != 1 {
		t.Fatalf("tenants = %d, want only the first", tenants)
	}
}

func TestTenantCreateHelpListsItsFlags(t *testing.T) {
	var stderr bytes.Buffer
	if code := run([]string{"tenant", "create", "-h"}, &stderr); code != 0 {
		t.Fatalf("exit code = %d, want 0\n%s", code, stderr.String())
	}
	for _, want := range []string{"Usage: publiractl tenant create [flags]", "-domain", "-admin-domain", "-default-locale", "-initial-admin-email"} {
		if !strings.Contains(stderr.String(), want) {
			t.Fatalf("usage = %q, want %q", stderr.String(), want)
		}
	}
}
