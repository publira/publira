package protomapper

import (
	"database/sql"
	"fmt"

	"github.com/publira/publira/server/internal/commentmode"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// CommentModeFromStored maps tenant_config.comment_mode onto the enum both the
// storefront and the console branch on.
//
// A stored value naming no mode is reported rather than answered with a
// stand-in, the way an unsupported default_locale is: PostEpisodeComment
// refuses that same value outright, so guessing here would put a comment box on
// screen that every submission is guaranteed to be refused from.
func CommentModeFromStored(stored string) (publirattypesv1.CommentMode, error) {
	resolved, err := commentmode.Resolve(stored)
	if err != nil {
		return publirattypesv1.CommentMode_COMMENT_MODE_UNSPECIFIED, fmt.Errorf("%w: %q", err, stored)
	}
	switch resolved {
	case commentmode.Disabled:
		return publirattypesv1.CommentMode_COMMENT_MODE_DISABLED, nil
	case commentmode.Immediate:
		return publirattypesv1.CommentMode_COMMENT_MODE_IMMEDIATE, nil
	case commentmode.ApprovalRequired:
		return publirattypesv1.CommentMode_COMMENT_MODE_APPROVAL_REQUIRED, nil
	default:
		return publirattypesv1.CommentMode_COMMENT_MODE_UNSPECIFIED, fmt.Errorf("%w: %q", commentmode.ErrUnresolved, stored)
	}
}

// CommentModeToStored maps a requested mode onto the value to store.
//
// COMMENT_MODE_UNSPECIFIED names no mode, so it is rejected: a request to stop
// accepting comments carries COMMENT_MODE_DISABLED, and an empty field is a
// caller that chose nothing rather than one that chose off.
func CommentModeToStored(mode publirattypesv1.CommentMode) (string, error) {
	switch mode {
	case publirattypesv1.CommentMode_COMMENT_MODE_DISABLED:
		return commentmode.Disabled, nil
	case publirattypesv1.CommentMode_COMMENT_MODE_IMMEDIATE:
		return commentmode.Immediate, nil
	case publirattypesv1.CommentMode_COMMENT_MODE_APPROVAL_REQUIRED:
		return commentmode.ApprovalRequired, nil
	default:
		return "", fmt.Errorf("%w: %s", commentmode.ErrInvalid, mode)
	}
}

// CommentModeOverrideFromStored maps series_listings.comment_mode — the mode
// one series states instead of following its tenant's — onto the same enum.
//
// A NULL column is not a fault here the way an unknown value is: it is the
// series stating nothing, which COMMENT_MODE_UNSPECIFIED reports so the form
// can offer "follow the tenant" as the choice it is.
func CommentModeOverrideFromStored(stored sql.NullString) (publirattypesv1.CommentMode, error) {
	if !stored.Valid {
		return publirattypesv1.CommentMode_COMMENT_MODE_UNSPECIFIED, nil
	}
	return CommentModeFromStored(stored.String)
}

// CommentModeOverrideToStored maps a requested override onto the value to
// store.
//
// COMMENT_MODE_UNSPECIFIED is the one place that value names something: a
// series that goes back to following its tenant, stored as no value at all so
// it keeps following that setting when the tenant changes it.
func CommentModeOverrideToStored(mode publirattypesv1.CommentMode) (sql.NullString, error) {
	if mode == publirattypesv1.CommentMode_COMMENT_MODE_UNSPECIFIED {
		return sql.NullString{}, nil
	}
	stored, err := CommentModeToStored(mode)
	if err != nil {
		return sql.NullString{}, err
	}
	return sql.NullString{String: stored, Valid: true}, nil
}
