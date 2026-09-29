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
