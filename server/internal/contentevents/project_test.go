package contentevents

import (
	"context"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"

	dbmodels "github.com/publira/publira/server/internal/db"
)

func TestProjectorRequiresDatabase(t *testing.T) {
	if _, err := NewProjector(nil).Run(context.Background(), ProjectionOptions{}); err == nil ||
		!strings.Contains(err.Error(), "requires a database") {
		t.Fatalf("missing database error = %v, want a database requirement", err)
	}
}

// stubProjectionQuerier hands back one prepared answer per batch, so a run can
// be driven through an interleaving a real database cannot be asked for.
type stubProjectionQuerier struct {
	batches []dbmodels.ProjectPendingEpisodeCompleteEventsRow
	calls   int
}

func (s *stubProjectionQuerier) ProjectPendingEpisodeCompleteEvents(
	_ context.Context,
	_ int32,
) (dbmodels.ProjectPendingEpisodeCompleteEventsRow, error) {
	if s.calls >= len(s.batches) {
		return dbmodels.ProjectPendingEpisodeCompleteEventsRow{}, nil
	}
	batch := s.batches[s.calls]
	s.calls++
	return batch, nil
}

// bypassRLSProjector is a Projector whose role check passes, so a test can
// reach the loop without a real database behind it.
func bypassRLSProjector(t *testing.T, queries projectionQuerier) *Projector {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	mock.ExpectQuery("pg_roles").
		WillReturnRows(sqlmock.NewRows([]string{"bypasses"}).AddRow(true))
	return &Projector{db: db, queries: queries}
}

func TestRunContinuesWhenARequestPathWriteWonTheBatch(t *testing.T) {
	// A full batch of reads was claimed but one of them was projected by the
	// API between the select and the insert. A run that measured its progress
	// by the events it wrote would stop here, leaving the second batch behind.
	stub := &stubProjectionQuerier{batches: []dbmodels.ProjectPendingEpisodeCompleteEventsRow{
		{CandidateCount: 2, InsertedCount: 1},
		{CandidateCount: 1, InsertedCount: 1},
	}}

	result, err := bypassRLSProjector(t, stub).Run(context.Background(), ProjectionOptions{BatchSize: 2})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if want := (ProjectionResult{RowCount: 2, BatchCount: 2}); result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}
}

func TestRunStopsOnceNoReadsRemain(t *testing.T) {
	stub := &stubProjectionQuerier{batches: []dbmodels.ProjectPendingEpisodeCompleteEventsRow{
		{CandidateCount: 1, InsertedCount: 1},
	}}

	result, err := bypassRLSProjector(t, stub).Run(context.Background(), ProjectionOptions{BatchSize: 2})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if want := (ProjectionResult{RowCount: 1, BatchCount: 1}); result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}
	if stub.calls != 1 {
		t.Fatalf("statements run = %d, want 1", stub.calls)
	}
}
