// Package siteverification validates and reads the codes a tenant's
// storefront proves it owns the site with (tenant_site_verification): Google
// Search Console's google-site-verification and Bing Webmaster Tools'
// msvalidate.01, each written into every storefront page as a <meta> tag's
// content value. Every page's HTML carries them, so neither is secret.
package siteverification

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

const (
	// ActionUpdated is the audit action of a change to the codes.
	ActionUpdated = "tenant_site_verification_updated"
	// AuditTargetType is the audit target of a change to the codes.
	AuditTargetType = "tenant_site_verification"
)

// ErrInvalidCode refuses a value that is not a bare verification code, a whole
// <meta> element among them.
var ErrInvalidCode = errors.New("verification code must be the content value of the <meta> tag alone: 1 to 128 letters, digits, hyphens, and underscores")

// codePattern matches the CHECK constraints. It admits no character that could
// end the attribute the storefront writes the code into, which is what lets the
// storefront write it as it is.
var codePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// Codes are a tenant's verification codes. An empty string is a code the
// tenant has not set.
type Codes struct {
	Google string
	Bing   string
}

// Any reports whether the tenant has set either code.
func (c Codes) Any() bool {
	return c.Google != "" || c.Bing != ""
}

// Querier reads the codes.
type Querier interface {
	GetTenantSiteVerification(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantSiteVerification, error)
}

// Get reads the tenant's codes, and none for a tenant that has saved nothing.
func Get(ctx context.Context, q Querier, tenantID uuid.UUID) (Codes, error) {
	row, err := q.GetTenantSiteVerification(ctx, tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return Codes{}, nil
	}
	if err != nil {
		return Codes{}, fmt.Errorf("read the site verification codes: %w", err)
	}
	return FromRow(row), nil
}

// FromRow answers a stored row as Codes.
func FromRow(row dbmodels.TenantSiteVerification) Codes {
	return Codes{
		Google: row.GoogleSiteVerification.String,
		Bing:   row.BingSiteVerification.String,
	}
}

// NormalizeCode trims a verification code, and answers "" for a blank one. The
// case is kept: the search engine compares the code as it issued it.
func NormalizeCode(raw string) (string, error) {
	code := strings.TrimSpace(raw)
	if code == "" {
		return "", nil
	}
	if !codePattern.MatchString(code) {
		return "", ErrInvalidCode
	}
	return code, nil
}
