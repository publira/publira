package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// DefaultFanOutPageSize bounds one recipient query of a fan-out. The fan-out
// grows with the tenant's readership, so it walks the recipients a page at a
// time instead of materializing every one of them before the first insert.
const DefaultFanOutPageSize = int32(500)

// fanOutPaging is how a handler that files a notification for each reader of
// a tenant walks them within the time one outbox job is given: a page of
// recipients at a time, recording after each page how far it got, and handing
// the event back with [ErrResume] once the job has no room for another.
type fanOutPaging struct {
	// pageSize is how many recipients one query lists and one insert files.
	pageSize int32
	// reserve is the time a page needs at its slowest: listing it, filing it,
	// and recording the cursor. A run starts another page only while the job
	// has that much left.
	reserve time.Duration
}

var defaultFanOutPaging = fanOutPaging{
	pageSize: DefaultFanOutPageSize,
	reserve:  10 * time.Second,
}

// hasRoomForPage reports whether the job has time for one more page at its
// slowest. A run always takes its first page, so every run moves the cursor
// even when its budget is shorter than that.
func (p fanOutPaging) hasRoomForPage(ctx context.Context) bool {
	deadline, ok := ctx.Deadline()
	return !ok || time.Until(deadline) >= p.reserve
}

// fanOutProgressRecorder is the statement that moves an event's cursor.
type fanOutProgressRecorder interface {
	RecordOutboxEventProgress(ctx context.Context, arg dbmodels.RecordOutboxEventProgressParams) (int64, error)
}

// recordFanOutProgress stores cursor as the event's progress, for the run
// that resumes it to start from.
func recordFanOutProgress(ctx context.Context, q fanOutProgressRecorder, event dbmodels.OutboxEvent, cursor any) error {
	encoded, err := json.Marshal(cursor)
	if err != nil {
		return fmt.Errorf("encode %s progress: %w", event.EventType, err)
	}
	recorded, err := q.RecordOutboxEventProgress(ctx, dbmodels.RecordOutboxEventProgressParams{
		ID:             event.ID,
		ProgressCursor: sql.NullString{String: string(encoded), Valid: true},
	})
	if err != nil {
		return fmt.Errorf("record %s progress: %w", event.EventType, err)
	}
	if recorded == 0 {
		return fmt.Errorf("record %s progress: the event is no longer claimed by this run", event.EventType)
	}
	return nil
}

// parseFanOutCursor reads the recorded cursor into cursor; an event with none
// leaves it at its zero value, which starts before every recipient.
func parseFanOutCursor(event dbmodels.OutboxEvent, cursor any) error {
	if !event.ProgressCursor.Valid {
		return nil
	}
	if err := json.Unmarshal([]byte(event.ProgressCursor.String), cursor); err != nil {
		return fmt.Errorf("decode %s progress cursor: %w", event.EventType, err)
	}
	return nil
}
