package protomapper

import (
	"database/sql"
	"errors"
	"testing"

	"github.com/publira/publira/server/internal/commentmode"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// Every stored mode has an enum value and comes back unchanged through the
// round trip, so neither half can grow a mode the other does not know.
func TestCommentModeRoundTripsEveryStoredMode(t *testing.T) {
	for _, stored := range commentmode.Supported {
		t.Run(stored, func(t *testing.T) {
			mode, err := CommentModeFromStored(stored)
			if err != nil {
				t.Fatalf("CommentModeFromStored(%q): %v", stored, err)
			}
			if mode == publirattypesv1.CommentMode_COMMENT_MODE_UNSPECIFIED {
				t.Fatalf("CommentModeFromStored(%q) = UNSPECIFIED", stored)
			}

			got, err := CommentModeToStored(mode)
			if err != nil {
				t.Fatalf("CommentModeToStored(%s): %v", mode, err)
			}
			if got != stored {
				t.Fatalf("round trip of %q = %q", stored, got)
			}
		})
	}
}

func TestCommentModeFromStoredRejectsAValueNamingNoMode(t *testing.T) {
	if _, err := CommentModeFromStored("moderated"); !errors.Is(err, commentmode.ErrUnresolved) {
		t.Fatalf("CommentModeFromStored error = %v, want ErrUnresolved", err)
	}
}

func TestCommentModeToStoredRejectsUnspecified(t *testing.T) {
	if _, err := CommentModeToStored(publirattypesv1.CommentMode_COMMENT_MODE_UNSPECIFIED); !errors.Is(err, commentmode.ErrInvalid) {
		t.Fatalf("CommentModeToStored error = %v, want ErrInvalid", err)
	}
}

// The override round trips the same way, with one value the tenant-wide mapper
// has no use for: the series that states nothing.
func TestCommentModeOverrideRoundTripsEveryStoredMode(t *testing.T) {
	for _, stored := range commentmode.Supported {
		t.Run(stored, func(t *testing.T) {
			mode, err := CommentModeOverrideFromStored(sql.NullString{String: stored, Valid: true})
			if err != nil {
				t.Fatalf("CommentModeOverrideFromStored(%q): %v", stored, err)
			}

			got, err := CommentModeOverrideToStored(mode)
			if err != nil {
				t.Fatalf("CommentModeOverrideToStored(%s): %v", mode, err)
			}
			if !got.Valid || got.String != stored {
				t.Fatalf("round trip of %q = %+v", stored, got)
			}
		})
	}
}

func TestCommentModeOverrideReadsNoStoredValueAsUnspecified(t *testing.T) {
	mode, err := CommentModeOverrideFromStored(sql.NullString{})
	if err != nil {
		t.Fatalf("CommentModeOverrideFromStored(NULL): %v", err)
	}
	if mode != publirattypesv1.CommentMode_COMMENT_MODE_UNSPECIFIED {
		t.Fatalf("CommentModeOverrideFromStored(NULL) = %s, want UNSPECIFIED", mode)
	}
}

// UNSPECIFIED is rejected as a tenant setting and stored as no value at all as
// an override: it is the series going back to following its tenant.
func TestCommentModeOverrideStoresUnspecifiedAsNoValue(t *testing.T) {
	stored, err := CommentModeOverrideToStored(publirattypesv1.CommentMode_COMMENT_MODE_UNSPECIFIED)
	if err != nil {
		t.Fatalf("CommentModeOverrideToStored(UNSPECIFIED): %v", err)
	}
	if stored.Valid {
		t.Fatalf("CommentModeOverrideToStored(UNSPECIFIED) = %q, want no value", stored.String)
	}
}

func TestCommentModeOverrideFromStoredRejectsAValueNamingNoMode(t *testing.T) {
	_, err := CommentModeOverrideFromStored(sql.NullString{String: "moderated", Valid: true})
	if !errors.Is(err, commentmode.ErrUnresolved) {
		t.Fatalf("CommentModeOverrideFromStored error = %v, want ErrUnresolved", err)
	}
}
