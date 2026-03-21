package auth

import "strings"

const (
	RolePlatformOperator   = "platform_operator"
	RolePlatformSuperAdmin = "platform_super_admin"
	RolePlatformAuditor    = "platform_auditor"
	RoleLegacyPlatformOps  = "platform-operator"
	RoleLegacySuperAdmin   = "super-admin"
	RoleTenantAdmin        = "tenant_admin"
	RoleTenantEditor       = "tenant_editor"
	RoleTenantAuditor      = "tenant_auditor"
	RoleLegacyAdmin        = "admin"
	RoleLegacyEditor       = "editor"
	RoleLegacyAuditor      = "auditor"
)

func ResolvePlatformRole(roles []string) string {
	bestPriority := -1
	bestRole := ""
	for _, role := range roles {
		normalized := strings.TrimSpace(role)
		priority := -1
		switch normalized {
		case RolePlatformSuperAdmin, RoleLegacySuperAdmin:
			priority = 3
		case RolePlatformOperator, RoleLegacyPlatformOps:
			priority = 2
		case RolePlatformAuditor:
			priority = 1
		}
		if priority > bestPriority {
			bestPriority = priority
			bestRole = normalized
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
		switch normalized {
		case RoleTenantAdmin, RoleLegacyAdmin:
			priority = 3
		case RoleTenantEditor, RoleLegacyEditor:
			priority = 2
		case RoleTenantAuditor, RoleLegacyAuditor:
			priority = 1
		default:
			priority = 0
		}
		if priority > bestPriority {
			bestPriority = priority
			bestRole = normalized
		}
	}
	return bestRole
}
