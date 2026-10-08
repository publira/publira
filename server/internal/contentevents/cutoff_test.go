package contentevents

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/retention"
)

// A period lengthened after a purge moves its cutoff back, but the events the
// purge took stay gone, so the cutoff a tenant answers never falls behind what
// a purge has applied.
func TestCutoffsForIsTheLaterOfThePeriodAndThePurge(t *testing.T) {
	now := time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC)
	untouched := uuid.Must(uuid.NewV7())
	lengthened := uuid.Must(uuid.NewV7())
	behind := uuid.Must(uuid.NewV7())
	periodCutoff := now.AddDate(0, 0, -retention.Builtin().ContentEventDays)
	purgedAhead := now.AddDate(0, 0, -retention.MinContentEventDays)
	purgedBehind := periodCutoff.AddDate(0, 0, -10)

	cutoffs := Cutoffs{
		retention: retention.NewTable(retention.Builtin(), nil),
		purged:    map[uuid.UUID]time.Time{lengthened: purgedAhead, behind: purgedBehind},
	}
	for name, tc := range map[string]struct {
		tenantID uuid.UUID
		want     time.Time
	}{
		"never purged":                {untouched, periodCutoff},
		"purged under a shorter span": {lengthened, purgedAhead},
		"purged under the same span":  {behind, periodCutoff},
	} {
		if got := cutoffs.For(tc.tenantID, now); !got.Equal(tc.want) {
			t.Errorf("%s: For = %s, want %s", name, got.Format(time.RFC3339), tc.want.Format(time.RFC3339))
		}
	}
}
