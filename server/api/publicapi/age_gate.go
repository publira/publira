package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/ageverification"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformconfig"
	"github.com/publira/publira/server/internal/tenanttz"
)

// The age rule a tenant applies to its rated series, resolved for one series
// and then applied to one reader.
//
// The two halves are separate because only the first is the same for everyone:
// how old a series makes a reader be is a fact about the tenant and the
// catalogue, and whether this reader is that old is a fact about the session.
// Keeping them apart is what lets a series page stay one shared answer while
// the body behind it is decided per reader.

// requiredMinimumAgeForSeries answers how many years old the tenant's rule
// makes a reader prove they are before this series opens to them, and 0 when
// the rule asks nothing of it.
//
// A series that carries no rating is a series the tenant has not classified,
// which is where every series starts: it is read as unrated rather than as
// suspect, so a tenant turning verification on does not close the part of its
// catalogue it has said nothing about. The tenant's setting is read only for a
// series that does carry a rating, so the ordinary read costs no extra query.
func (s *apiServer) requiredMinimumAgeForSeries(ctx context.Context, tenantID uuid.UUID, storedRating sql.NullString) (int, error) {
	if !storedRating.Valid || storedRating.String == ageverification.RatingAll {
		return 0, nil
	}

	rule, err := s.tenantAgeVerificationRule(ctx, tenantID)
	if err != nil {
		return 0, err
	}
	return ageverification.RequiredMinimumAge(rule, storedRating.String)
}

// tenantAgeVerificationRule reads the rule the tenant saved. A tenant with no
// config row has chosen nothing, which is the answer the column's own default
// gives; any other failure is reported, because a rule that cannot be read is
// not a rule that asks for nothing.
func (s *apiServer) tenantAgeVerificationRule(ctx context.Context, tenantID uuid.UUID) (string, error) {
	config, err := s.queriesFor(ctx).GetTenantConfigByTenantID(ctx, tenantID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ageverification.None, nil
		}
		return "", err
	}
	return ageverification.Resolve(config.AgeVerification)
}

// readerClearsMinimumAge reports whether the reader behind birthDate is old
// enough on the tenant's own calendar day.
//
// A reader with no birth date does not clear it. Neither does a guest, which
// is the caller's zero-value sql.NullTime: nothing has been proven either way,
// and the rule exists to be satisfied rather than assumed.
func (s *apiServer) readerClearsMinimumAge(ctx context.Context, tenant dbmodels.Tenant, minimumAge int, birthDate sql.NullTime) (bool, error) {
	if minimumAge <= 0 {
		return true, nil
	}
	if !birthDate.Valid {
		return false, nil
	}
	today, err := s.tenantToday(ctx, tenant)
	if err != nil {
		return false, err
	}
	return ageverification.AgeOn(birthDate.Time, today) >= minimumAge, nil
}

// tenantToday is the calendar day the tenant is living through right now. An
// age is counted against it rather than against UTC, so a reader's birthday
// arrives when the tenant's own calendar says it does.
func (s *apiServer) tenantToday(ctx context.Context, tenant dbmodels.Tenant) (time.Time, error) {
	zone := tenanttz.Resolve(tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, s.queriesFor(ctx)))
	location, err := time.LoadLocation(zone)
	if err != nil {
		return time.Time{}, fmt.Errorf("load tenant time zone %q: %w", zone, err)
	}
	return ageverification.Today(time.Now(), location), nil
}
