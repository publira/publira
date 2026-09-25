package main

import (
	"bytes"
	"context"
	"regexp"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/testutil"
)

// tenantCommand runs one tenant command against pg and fails the test unless
// it exits 0. It returns what the command printed.
func tenantCommand(t *testing.T, stdin string, args ...string) string {
	t.Helper()
	var stdout, stderr bytes.Buffer
	if code := runGroup(&tenantGroup, args, pipedConsole(stdin, &stderr), &stdout); code != 0 {
		t.Fatalf("tenant %s: exit code = %d\n%s", strings.Join(args, " "), code, stderr.String())
	}
	return stdout.String()
}

func platformActions(t *testing.T, pg *testutil.PostgresEnv) string {
	t.Helper()
	rows, err := pg.DB.QueryContext(context.Background(), `SELECT actor_role, action FROM platform_audit_logs ORDER BY id`)
	if err != nil {
		t.Fatalf("read platform_audit_logs: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var actions []string
	for rows.Next() {
		var role, action string
		if err := rows.Scan(&role, &action); err != nil {
			t.Fatalf("scan platform_audit_logs: %v", err)
		}
		if role != auditlog.RoleSystem {
			t.Fatalf("audit entry %s is filed as %q, want the system actor", action, role)
		}
		actions = append(actions, action)
	}
	return strings.Join(actions, ",")
}

func TestTenantShowUpdateSuspendAndResume(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	tenant := pg.SeedTenant(t, "TENANTAAAAAA", "tenant-a.example.com", "Tenant A")

	shown := tenantCommand(t, "", "show", "-tenant", "tenant-a.example.com")
	for _, want := range []string{"Public ID:       TENANTAAAAAA\n", "Name:            Tenant A\n", "Status:          active\n", "Admin domain:    " + tenant.AdminDomain + "\n"} {
		if !strings.Contains(shown, want) {
			t.Fatalf("show = %q, want %q", shown, want)
		}
	}

	if got := tenantCommand(t, "", "update", "-tenant", "TENANTAAAAAA", "-name", "Renamed", "-admin-domain", ""); got != "Updated tenant TENANTAAAAAA for tenant-a.example.com\n" {
		t.Fatalf("update = %q", got)
	}
	if shown := tenantCommand(t, "", "show", "-tenant", "TENANTAAAAAA"); !strings.Contains(shown, "Name:            Renamed\n") || !strings.Contains(shown, "Admin domain:    admin.tenant-a.example.com (default)\n") {
		t.Fatalf("show after update = %q, want the new name and the default admin domain", shown)
	}
	tenantCommand(t, "", "update", "-tenant", "TENANTAAAAAA", "-admin-domain", "console.tenant-a.example.com")
	if got := tenantCommand(t, "", "suspend", "-tenant", "tenant-a.example.com"); got != "Suspended tenant TENANTAAAAAA for tenant-a.example.com\n" {
		t.Fatalf("suspend = %q", got)
	}
	tenantCommand(t, "", "resume", "-tenant", "tenant-a.example.com")

	var name, adminDomain, status string
	if err := pg.DB.QueryRowContext(context.Background(), `SELECT name, admin_domain, status FROM tenants WHERE id = $1`, tenant.ID).Scan(&name, &adminDomain, &status); err != nil {
		t.Fatalf("read the tenant: %v", err)
	}
	if name != "Renamed" || adminDomain != "console.tenant-a.example.com" || status != "active" {
		t.Fatalf("tenant = %s, %s, %s; want the new name and admin domain, active", name, adminDomain, status)
	}
	if got := platformActions(t, pg); got != "tenant_info_updated,tenant_info_updated,tenant_suspended,tenant_resumed" {
		t.Fatalf("audit actions = %s", got)
	}
}

func TestTenantMemberCommands(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	tenant := pg.SeedTenant(t, "TENANTAAAAAA", "tenant-a.example.com", "Tenant A")
	pg.SeedTenantAdmin(t, tenant.ID, "ADMIN0000001", "admin@tenant-a.example.com", "Admin")
	pg.SeedEndUser(t, tenant.ID, "READER000001", "reader@tenant-a.example.com", "Reader")

	if got := tenantCommand(t, "", "member", "add", "-tenant", "tenant-a.example.com", "-email", "reader@tenant-a.example.com", "-role", auth.RoleTenantEditor); got != "Gave reader@tenant-a.example.com (READER000001) the tenant_editor role\n" {
		t.Fatalf("member add = %q", got)
	}
	listed := tenantCommand(t, "", "member", "list", "-tenant", "tenant-a.example.com")
	if !regexp.MustCompile(`(?m)^READER000001\s+reader@tenant-a\.example\.com\s+Reader\s+tenant_editor\s+active\s`).MatchString(listed) ||
		!strings.Contains(listed, "ADMIN0000001") {
		t.Fatalf("member list = %q, want both members", listed)
	}
	if got := tenantCommand(t, "", "member", "update-role", "-tenant", "tenant-a.example.com", "-user", "READER000001", "-role", auth.RoleTenantAuditor); got != "Gave reader@tenant-a.example.com (READER000001) the tenant_auditor role\n" {
		t.Fatalf("member update-role = %q", got)
	}
	tenantCommand(t, "", "member", "remove", "-tenant", "tenant-a.example.com", "-user", "READER000001")

	var roles int
	if err := pg.DB.QueryRowContext(context.Background(), `SELECT count(*) FROM tenant_user_roles tur JOIN users u ON u.id = tur.user_id WHERE u.public_id = 'READER000001'`).Scan(&roles); err != nil {
		t.Fatalf("count roles: %v", err)
	}
	if roles != 0 {
		t.Fatalf("roles after remove = %d, want 0", roles)
	}
}

func TestTenantInviteCommands(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	pg.SeedTenant(t, "TENANTAAAAAA", "tenant-a.example.com", "Tenant A")

	created := tenantCommand(t, "", "invite", "create", "-tenant", "tenant-a.example.com", "-email", "Owner@Tenant-A.example.com")
	match := regexp.MustCompile(`^Queued an invitation ([0-9a-f-]{36}) for owner@tenant-a\.example\.com, which expires at \S+\n$`).FindStringSubmatch(created)
	if match == nil {
		t.Fatalf("invite create = %q", created)
	}
	id := match[1]
	if listed := tenantCommand(t, "", "invite", "list", "-tenant", "tenant-a.example.com"); !regexp.MustCompile(`(?m)^` + id + `\s+owner@tenant-a\.example\.com\s+pending\s`).MatchString(listed) {
		t.Fatalf("invite list = %q, want the pending invitation", listed)
	}
	tenantCommand(t, "", "invite", "resend", "-tenant", "tenant-a.example.com", "-id", id)
	if got := tenantCommand(t, "", "invite", "cancel", "-tenant", "tenant-a.example.com", "-id", id); got != "Canceled the invitation "+id+" for owner@tenant-a.example.com\n" {
		t.Fatalf("invite cancel = %q", got)
	}

	if got := platformActions(t, pg); got != "tenant_admin_invited,tenant_admin_invite_resent,tenant_admin_invite_canceled" {
		t.Fatalf("audit actions = %s", got)
	}
}

// A generated password is printed once, to stdout, and nowhere else.
func TestTenantAdminCreateGeneratesAPassword(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	tenant := pg.SeedTenant(t, "TENANTAAAAAA", "tenant-a.example.com", "Tenant A")

	var stdout, stderr bytes.Buffer
	code := runGroup(&tenantGroup, []string{
		"admin", "create", "-tenant", "tenant-a.example.com", "-email", "owner@tenant-a.example.com", "-name", "Owner", "-generate-password",
	}, pipedConsole("", &stderr), &stdout)
	if code != 0 {
		t.Fatalf("exit code = %d\n%s", code, stderr.String())
	}
	match := regexp.MustCompile(`^Created tenant_admin (\S+) for owner@tenant-a\.example\.com\nPassword: (\S{24})\n$`).FindStringSubmatch(stdout.String())
	if match == nil {
		t.Fatalf("stdout = %q", stdout.String())
	}
	password := match[2]
	if strings.Contains(stderr.String(), password) {
		t.Fatal("the password is in the log on stderr")
	}

	var hash, status string
	var verified bool
	if err := pg.DB.QueryRowContext(context.Background(),
		`SELECT password_hash, status, email_verified_at IS NOT NULL FROM users WHERE tenant_id = $1 AND public_id = $2`, tenant.ID, match[1],
	).Scan(&hash, &status, &verified); err != nil {
		t.Fatalf("read the user: %v", err)
	}
	if !auth.VerifyPassword(password, hash) || status != "active" || !verified {
		t.Fatalf("user status = %s, verified = %t; want an active, verified user the printed password signs in", status, verified)
	}
	var leaked int
	if err := pg.DB.QueryRowContext(context.Background(),
		`SELECT count(*) FROM platform_audit_logs WHERE row_to_json(platform_audit_logs)::text LIKE '%' || $1 || '%'`, password,
	).Scan(&leaked); err != nil {
		t.Fatalf("search platform_audit_logs: %v", err)
	}
	if leaked != 0 {
		t.Fatal("the password is in platform_audit_logs")
	}
	if got := platformActions(t, pg); got != "tenant_member_created" {
		t.Fatalf("audit actions = %s", got)
	}
}

func TestTenantAdminCreateReadsThePasswordFromStdin(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	tenant := pg.SeedTenant(t, "TENANTAAAAAA", "tenant-a.example.com", "Tenant A")

	got := tenantCommand(t, testSecretValue+"\n",
		"admin", "create", "-tenant", "TENANTAAAAAA", "-email", "editor@tenant-a.example.com", "-name", "Editor", "-role", auth.RoleTenantEditor, "-password-stdin")
	if strings.Contains(got, testSecretValue) || !strings.HasPrefix(got, "Created tenant_editor ") {
		t.Fatalf("stdout = %q, want the account and not the password", got)
	}
	var hash string
	if err := pg.DB.QueryRowContext(context.Background(),
		`SELECT password_hash FROM users WHERE tenant_id = $1 AND email = 'editor@tenant-a.example.com'`, tenant.ID,
	).Scan(&hash); err != nil {
		t.Fatalf("read the user: %v", err)
	}
	if !auth.VerifyPassword(testSecretValue, hash) {
		t.Fatal("the stored hash does not verify the password read from stdin")
	}
}

// Each refusal names the flag for the field the Connect adapter names, and
// nothing is written.
func TestTenantCommandsNameTheRefusedFlag(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	pg.SeedTenant(t, "TENANTAAAAAA", "tenant-a.example.com", "Tenant A")
	pg.SeedTenant(t, "TENANTBBBBBB", "tenant-b.example.com", "Tenant B")
	tenant := []string{"-tenant", "tenant-a.example.com"}

	for _, tc := range []struct {
		name string
		args []string
		want string
	}{
		{name: "no tenant", args: []string{"show"}, want: "-tenant: tenant is required"},
		{name: "no such tenant", args: []string{"suspend", "-tenant", "nowhere.example.com"}, want: "tenant not found"},
		{name: "update with a blank name", args: append([]string{"update", "-name", " "}, tenant...), want: "-name: name is required"},
		{name: "update with a taken domain", args: append([]string{"update", "-domain", "tenant-b.example.com"}, tenant...), want: "-domain: domain already exists"},
		{name: "update with nothing", args: append([]string{"update"}, tenant...), want: "-name, -domain, or -admin-domain: name, domain, or admin_domain is required"},
		{name: "add a member with an unknown role", args: append([]string{"member", "add", "-user", "USER1", "-role", "owner"}, tenant...), want: "-role: invalid role"},
		{name: "add a member by a malformed email", args: append([]string{"member", "add", "-email", "nobody", "-role", "tenant_admin"}, tenant...), want: "-email: invalid email"},
		{name: "add a member named twice", args: append([]string{"member", "add", "-user", "USER1", "-email", "a@example.com", "-role", "tenant_admin"}, tenant...), want: "-user or -email: user_public_id and email cannot both be set"},
		{name: "change the role of no user", args: append([]string{"member", "update-role", "-role", "tenant_admin"}, tenant...), want: "-user: user_public_id is required"},
		{name: "remove no user", args: append([]string{"member", "remove"}, tenant...), want: "-user: user_public_id is required"},
		{name: "invite a malformed email", args: append([]string{"invite", "create", "-email", "nobody"}, tenant...), want: "-email: invalid email"},
		{name: "resend a malformed invitation ID", args: append([]string{"invite", "resend", "-id", "42"}, tenant...), want: "-id: invalid invitation_id"},
		{name: "create an account with a malformed email", args: append([]string{"admin", "create", "-email", "nobody", "-name", "A", "-generate-password"}, tenant...), want: "-email: invalid email"},
		{name: "create an account with two passwords", args: append([]string{"admin", "create", "-email", "a@example.com", "-name", "A", "-generate-password", "-password-stdin"}, tenant...), want: "-generate-password and -password-stdin cannot both be given"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			code := runGroup(&tenantGroup, tc.args, pipedConsole("", &stderr), &stdout)
			if code != 1 {
				t.Fatalf("exit code = %d, want 1\n%s", code, stderr.String())
			}
			if want := "publiractl: " + tc.want + "\n"; stderr.String() != want {
				t.Fatalf("stderr = %q, want %q", stderr.String(), want)
			}
		})
	}

	if got := platformActions(t, pg); got != "" {
		t.Fatalf("audit actions = %s, want none", got)
	}
}

func TestTenantUsageListsItsGroups(t *testing.T) {
	var stderr bytes.Buffer
	if code := run([]string{"tenant"}, &stderr); code != 2 {
		t.Fatalf("exit code = %d, want 2", code)
	}
	for _, want := range []string{"show", "update", "suspend", "resume", "member", "invite", "admin"} {
		if !regexp.MustCompile(`(?m)^  ` + want + `\s`).MatchString(stderr.String()) {
			t.Fatalf("usage = %q, want %q", stderr.String(), want)
		}
	}

	stderr.Reset()
	if code := run([]string{"tenant", "admin", "create", "-h"}, &stderr); code != 0 {
		t.Fatalf("exit code = %d, want 0\n%s", code, stderr.String())
	}
	for _, want := range []string{"Usage: publiractl tenant admin create [flags]", "-tenant", "-email", "-role", "-password-stdin", "-generate-password"} {
		if !strings.Contains(stderr.String(), want) {
			t.Fatalf("usage = %q, want %q", stderr.String(), want)
		}
	}
}
