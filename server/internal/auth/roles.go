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

func ResolveTenantRole(roles []string) string {
	bestPriority := -1
	bestRole := ""
	for _, role := range roles {
		normalized := strings.TrimSpace(role)
		priority := -1
		resolvedRole := ""
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
