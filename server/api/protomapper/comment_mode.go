package protomapper

import (
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
