package protomapper

import (
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
