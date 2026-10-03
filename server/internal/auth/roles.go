package auth

import "strings"

const (
	RolePlatformOperator   = "platform_operator"
	RolePlatformSuperAdmin = "platform_super_admin"
	RolePlatformAuditor    = "platform_auditor"
	RoleTenantAdmin        = "tenant_admin"
	RoleTenantEditor       = "tenant_editor"
	RoleTenantAuditor      = "tenant_auditor"
)

func ResolvePlatformRole(roles []string) string {
	bestPriority := -1
	bestRole := ""
	for _, role := range roles {
		normalized := strings.TrimSpace(role)
		priority := -1
		resolvedRole := ""
		switch normalized {
		case RolePlatformSuperAdmin:
			priority = 3
			resolvedRole = RolePlatformSuperAdmin
		case RolePlatformOperator:
			priority = 2
			resolvedRole = RolePlatformOperator
		case RolePlatformAuditor:
			priority = 1
			resolvedRole = RolePlatformAuditor
		}
		if priority > bestPriority {
			bestPriority = priority
			bestRole = resolvedRole
		}
	}
	return bestRole
}

func IsPlatformRole(role string) bool {
	return ResolvePlatformRole([]string{role}) != ""
}

// IsTenantStaff reports whether any of the roles is a tenant-admin, editor,
// or auditor. Image preview and the admin API both treat these three as
// staff: having any other string in tenant_user_roles is not enough.
func IsTenantStaff(roles []string) bool {
	switch ResolveTenantRole(roles) {
	case RoleTenantAdmin, RoleTenantEditor, RoleTenantAuditor:
		return true
	default:
		return false
	}
}

// tenantRoleRank orders the tenant staff roles by how much each may do, from
// tenant_auditor up to tenant_admin. Any other string ranks below all three.
func tenantRoleRank(role string) int {
	switch role {
	case RoleTenantAdmin:
		return 3
	case RoleTenantEditor:
		return 2
	case RoleTenantAuditor:
		return 1
	default:
		return 0
	}
}

func ResolveTenantRole(roles []string) string {
	bestPriority := -1
	bestRole := ""
	for _, role := range roles {
		normalized := strings.TrimSpace(role)
		if priority := tenantRoleRank(normalized); priority > bestPriority {
			bestPriority = priority
			bestRole = normalized
		}
	}
	return bestRole
}

// TenantRoleAtLeast reports whether role may do everything level may, by the
// ranking ResolveTenantRole picks the strongest of an account's roles with:
// tenant_admin covers tenant_editor, which covers tenant_auditor. A level that
// is not one of the three is met by no role.
func TenantRoleAtLeast(role, level string) bool {
	required := tenantRoleRank(level)
	return required > 0 && tenantRoleRank(role) >= required
}
