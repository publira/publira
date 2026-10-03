package auth

import "testing"

func TestResolvePlatformRole(t *testing.T) {
	tests := []struct {
		name  string
		roles []string
		want  string
	}{
		{
			name:  "platform super admin",
			roles: []string{RolePlatformSuperAdmin},
			want:  RolePlatformSuperAdmin,
		},
		{
			name:  "platform operator",
			roles: []string{RolePlatformOperator},
			want:  RolePlatformOperator,
		},
		{
			name:  "higher priority role wins",
			roles: []string{RolePlatformOperator, RolePlatformSuperAdmin},
			want:  RolePlatformSuperAdmin,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ResolvePlatformRole(tt.roles); got != tt.want {
				t.Fatalf("ResolvePlatformRole() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestResolveTenantRole(t *testing.T) {
	tests := []struct {
		name  string
		roles []string
		want  string
	}{
		{
			name:  "tenant admin",
			roles: []string{RoleTenantAdmin},
			want:  RoleTenantAdmin,
		},
		{
			name:  "tenant editor",
			roles: []string{RoleTenantEditor},
			want:  RoleTenantEditor,
		},
		{
			name:  "tenant auditor",
			roles: []string{RoleTenantAuditor},
			want:  RoleTenantAuditor,
		},
		{
			name:  "unknown role remains unchanged",
			roles: []string{"custom"},
			want:  "custom",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ResolveTenantRole(tt.roles); got != tt.want {
				t.Fatalf("ResolveTenantRole() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestIsTenantStaff(t *testing.T) {
	tests := []struct {
		name  string
		roles []string
		want  bool
	}{
		{name: "tenant admin", roles: []string{RoleTenantAdmin}, want: true},
		{name: "tenant editor", roles: []string{RoleTenantEditor}, want: true},
		{name: "tenant auditor", roles: []string{RoleTenantAuditor}, want: true},
		{name: "unknown role", roles: []string{"custom"}, want: false},
		{name: "no roles", roles: nil, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsTenantStaff(tt.roles); got != tt.want {
				t.Fatalf("IsTenantStaff() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestTenantRoleAtLeast(t *testing.T) {
	roles := []string{RoleTenantAuditor, RoleTenantEditor, RoleTenantAdmin}
	tests := []struct {
		name  string
		role  string
		level string
		want  bool
	}{
		{name: "an admin meets the admin level", role: RoleTenantAdmin, level: RoleTenantAdmin, want: true},
		{name: "an admin meets the editor level", role: RoleTenantAdmin, level: RoleTenantEditor, want: true},
		{name: "an admin meets the auditor level", role: RoleTenantAdmin, level: RoleTenantAuditor, want: true},
		{name: "an editor falls short of the admin level", role: RoleTenantEditor, level: RoleTenantAdmin, want: false},
		{name: "an editor meets the editor level", role: RoleTenantEditor, level: RoleTenantEditor, want: true},
		{name: "an editor meets the auditor level", role: RoleTenantEditor, level: RoleTenantAuditor, want: true},
		{name: "an auditor falls short of the admin level", role: RoleTenantAuditor, level: RoleTenantAdmin, want: false},
		{name: "an auditor falls short of the editor level", role: RoleTenantAuditor, level: RoleTenantEditor, want: false},
		{name: "an auditor meets the auditor level", role: RoleTenantAuditor, level: RoleTenantAuditor, want: true},
		{name: "an empty role falls short of the auditor level", role: "", level: RoleTenantAuditor, want: false},
		{name: "an unknown role falls short of the auditor level", role: "custom", level: RoleTenantAuditor, want: false},
		{name: "a platform role falls short of the auditor level", role: RolePlatformSuperAdmin, level: RoleTenantAuditor, want: false},
	}
	for _, level := range []string{"", "custom"} {
		for _, role := range roles {
			tests = append(tests, struct {
				name  string
				role  string
				level string
				want  bool
			}{name: role + " meets no unknown level " + level, role: role, level: level, want: false})
		}
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := TenantRoleAtLeast(tt.role, tt.level); got != tt.want {
				t.Fatalf("TenantRoleAtLeast(%q, %q) = %v, want %v", tt.role, tt.level, got, tt.want)
			}
		})
	}
}
