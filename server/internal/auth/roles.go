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

func ResolveTenantRole(roles []string) string {
	bestPriority := -1
	bestRole := ""
	for _, role := range roles {
		normalized := strings.TrimSpace(role)
		// Every branch below assigns, default included, so no initial value is read.
		var (
			priority     int
			resolvedRole string
		)
		switch normalized {
		case RoleTenantAdmin:
			priority = 3
			resolvedRole = RoleTenantAdmin
		case RoleTenantEditor:
			priority = 2
			resolvedRole = RoleTenantEditor
		case RoleTenantAuditor:
			priority = 1
			resolvedRole = RoleTenantAuditor
		default:
			priority = 0
			resolvedRole = normalized
		}
		if priority > bestPriority {
			bestPriority = priority
			bestRole = resolvedRole
		}
	}
	return bestRole
}
