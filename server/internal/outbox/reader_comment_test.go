package outbox

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

func TestCommentAuthorSubjectKeyNamesTheComment(t *testing.T) {
	if got := CommentAuthorSubjectKey("CMTPEND00001"); got != "comment:CMTPEND00001" {
		t.Fatalf("subject key = %q, want comment:CMTPEND00001", got)
	}
}

func TestNotifyCommentApprovedWritesAnApprovedRow(t *testing.T) {
	tenantID := uuid.New()
	userID := uuid.New()
	queries := &stubCommentAuthorNotifier{}

	err := NotifyCommentApproved(context.Background(), queries, CommentApprovedNotification{
		TenantID:        tenantID,
		UserID:          userID,
		CommentPublicID: "CMTPEND00001",
		EpisodePublicID: "EPISODE00001",
		EpisodeTitle:    "Episode Three",
		SeriesPublicID:  "SERIES000001",
		SeriesTitle:     "Seed Series",
	})
	if err != nil {
		t.Fatalf("NotifyCommentApproved: %v", err)
	}
	if len(queries.created) != 1 {
		t.Fatalf("notifications written = %d, want 1", len(queries.created))
	}
	row := queries.created[0]
	if row.TenantID != tenantID {
		t.Fatalf("tenant_id = %s, want %s", row.TenantID, tenantID)
	}
	if row.UserID != userID {
		t.Fatalf("user_id = %s, want %s", row.UserID, userID)
	}
	if row.NotificationType != NotificationTypeCommentApproved {
		t.Fatalf("notification_type = %q, want %q", row.NotificationType, NotificationTypeCommentApproved)
	}
	if row.SubjectKey != "comment:CMTPEND00001" {
		t.Fatalf("subject_key = %q", row.SubjectKey)
	}
	assertCommentAuthorPayload(t, row.Payload, map[string]string{
		"episode_id":    "EPISODE00001",
		"episode_title": "Episode Three",
		"series_id":     "SERIES000001",
		"series_title":  "Seed Series",
		"comment_id":    "CMTPEND00001",
	})
}

func TestNotifyCommentApprovedReturnsAFailedInsert(t *testing.T) {
	queries := &stubCommentAuthorNotifier{createErr: errors.New("connection refused")}

	err := NotifyCommentApproved(context.Background(), queries, CommentApprovedNotification{
		TenantID:        uuid.New(),
		UserID:          uuid.New(),
		CommentPublicID: "CMTPEND00001",
	})
	if err == nil {
		t.Fatal("NotifyCommentApproved error = nil, want the insert error")
	}
}

func TestNotifyCommentApprovedRejectsAnIncompleteRequest(t *testing.T) {
	tenantID := uuid.New()
	userID := uuid.New()

	cases := []struct {
		name string
		n    CommentApprovedNotification
	}{
		{
			name: "no comment",
			n: CommentApprovedNotification{
				TenantID: tenantID,
				UserID:   userID,
			},
		},
		{
			name: "no author",
			n: CommentApprovedNotification{
				TenantID:        tenantID,
				CommentPublicID: "CMTPEND00001",
			},
		},
		{
			name: "no tenant",
			n: CommentApprovedNotification{
				UserID:          userID,
				CommentPublicID: "CMTPEND00001",
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			queries := &stubCommentAuthorNotifier{}
			if err := NotifyCommentApproved(context.Background(), queries, tc.n); err == nil {
				t.Fatal("NotifyCommentApproved error = nil, want a validation error")
			}
			if len(queries.created) != 0 {
				t.Fatalf("notifications written = %d, want 0", len(queries.created))
			}
		})
	}
}

func assertCommentAuthorPayload(t *testing.T, raw []byte, want map[string]string) {
	t.Helper()

	var body map[string]string
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("decode notification payload: %v", err)
	}
	for key, value := range want {
		if body[key] != value {
			t.Fatalf("payload[%q] = %q, want %q", key, body[key], value)
		}
	}
	if len(body) != len(want) {
		t.Fatalf("payload = %v, want exactly %v", body, want)
	}
}

type stubCommentAuthorNotifier struct {
	created   []dbmodels.CreateNotificationParams
	createErr error
}

func (s *stubCommentAuthorNotifier) CreateNotification(
	_ context.Context,
	arg dbmodels.CreateNotificationParams,
) error {
	if s.createErr != nil {
		return s.createErr
	}
	s.created = append(s.created, arg)
	return nil
}
