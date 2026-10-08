package contentevents

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/retention"
)

// CutoffQuerier reads what Cutoffs are resolved from.
type CutoffQuerier interface {
	retention.TableQuerier
	ListContentEventPurges(ctx context.Context) ([]dbmodels.ListContentEventPurgesRow, error)
}

// Cutoffs answer, for every tenant, the instant before which its content
// events may already be gone. The retention period alone cannot: a period
// lengthened after a purge moves its cutoff back, while the events the purge
// took under the shorter one stay gone. So the answer is the later of the
// cutoff the period puts at now and the furthest one a purge has applied.
type Cutoffs struct {
	retention retention.Table
	purged    map[uuid.UUID]time.Time
}

// LoadCutoffs reads the retention periods and every tenant's purge record.
func LoadCutoffs(ctx context.Context, q CutoffQuerier) (Cutoffs, error) {
	table, err := retention.LoadTable(ctx, q)
	if err != nil {
		return Cutoffs{}, fmt.Errorf("load retention periods: %w", err)
	}
	rows, err := q.ListContentEventPurges(ctx)
	if err != nil {
		return Cutoffs{}, fmt.Errorf("list content event purges: %w", err)
	}
	purged := make(map[uuid.UUID]time.Time, len(rows))
	for _, row := range rows {
		purged[row.TenantID] = row.PurgedBefore
	}
	return Cutoffs{retention: table, purged: purged}, nil
}

// For is the instant before which tenantID's events may be gone at now.
func (c Cutoffs) For(tenantID uuid.UUID, now time.Time) time.Time {
	cutoff := c.retention.For(tenantID).ContentEventCutoff(now)
	if purged, ok := c.purged[tenantID]; ok && purged.After(cutoff) {
		return purged
	}
	return cutoff
}
