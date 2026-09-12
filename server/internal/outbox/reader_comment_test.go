package outbox

import (
	"context"
	"database/sql"
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

func TestNotifyCommentAuthorWritesAnApprovedRow(t *testing.T) {
	tenantID := uuid.New()
	userID := uuid.New()
	queries := &stubCommentAuthorNotifier{}

	err := NotifyCommentAuthor(context.Background(), queries, CommentAuthorNotification{
		TenantID:         tenantID,
		UserID:           userID,
		NotificationType: NotificationTypeCommentApproved,
		CommentPublicID:  "CMTPEND00001",
		EpisodePublicID:  "EPISODE00001",
		EpisodeTitle:     "Episode Three",
		SeriesPublicID:   "SERIES000001",
		SeriesTitle:      "Seed Series",
	})
	if err != nil {
		t.Fatalf("NotifyCommentAuthor: %v", err)
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

func TestNotifyCommentAuthorWritesAHiddenRowWithTheReason(t *testing.T) {
	queries := &stubCommentAuthorNotifier{}

	err := NotifyCommentAuthor(context.Background(), queries, CommentAuthorNotification{
		TenantID:         uuid.New(),
		UserID:           uuid.New(),
		NotificationType: NotificationTypeCommentHidden,
		CommentPublicID:  "CMTHIDE00001",
		EpisodePublicID:  "EPISODE00001",
		SeriesPublicID:   "SERIES000001",
		HiddenReason:     CommentHiddenReasonAutoReports,
	})
	if err != nil {
		t.Fatalf("NotifyCommentAuthor: %v", err)
	}
	if got := queries.created[0].NotificationType; got != NotificationTypeCommentHidden {
		t.Fatalf("notification_type = %q, want %q", got, NotificationTypeCommentHidden)
	}
	assertCommentAuthorPayload(t, queries.created[0].Payload, map[string]string{
		"episode_id":    "EPISODE00001",
		"series_id":     "SERIES000001",
		"comment_id":    "CMTHIDE00001",
		"hidden_reason": CommentHiddenReasonAutoReports,
	})
}

func TestNotifyCommentAuthorTreatsAnExistingRowAsDone(t *testing.T) {
	queries := &stubCommentAuthorNotifier{createErr: sql.ErrNoRows}

	err := NotifyCommentAuthor(context.Background(), queries, CommentAuthorNotification{
		TenantID:         uuid.New(),
		UserID:           uuid.New(),
		NotificationType: NotificationTypeCommentApproved,
		CommentPublicID:  "CMTPEND00001",
	})
	if err != nil {
		t.Fatalf("NotifyCommentAuthor: %v", err)
	}
}

func TestNotifyCommentAuthorReturnsAFailedInsert(t *testing.T) {
	queries := &stubCommentAuthorNotifier{createErr: errors.New("connection refused")}

	err := NotifyCommentAuthor(context.Background(), queries, CommentAuthorNotification{
		TenantID:         uuid.New(),
		UserID:           uuid.New(),
		NotificationType: NotificationTypeCommentApproved,
		CommentPublicID:  "CMTPEND00001",
	})
	if err == nil {
		t.Fatal("NotifyCommentAuthor error = nil, want the insert error")
	}
}

func TestNotifyCommentAuthorRejectsAnIncompleteRequest(t *testing.T) {
	tenantID := uuid.New()
	userID := uuid.New()

	cases := []struct {
		name string
		n    CommentAuthorNotification
	}{
		{
			name: "no comment",
			n: CommentAuthorNotification{
				TenantID:         tenantID,
				UserID:           userID,
				NotificationType: NotificationTypeCommentApproved,
			},
		},
		{
			name: "no author",
			n: CommentAuthorNotification{
				TenantID:         tenantID,
				NotificationType: NotificationTypeCommentApproved,
				CommentPublicID:  "CMTPEND00001",
			},
		},
		{
			name: "no tenant",
			n: CommentAuthorNotification{
				UserID:           userID,
				NotificationType: NotificationTypeCommentApproved,
				CommentPublicID:  "CMTPEND00001",
			},
		},
		{
			name: "unknown type",
			n: CommentAuthorNotification{
				TenantID:         tenantID,
				UserID:           userID,
				NotificationType: NotificationTypeCommentAwaitingApproval,
				CommentPublicID:  "CMTPEND00001",
			},
		},
		{
			name: "approved with a hidden reason",
			n: CommentAuthorNotification{
				TenantID:         tenantID,
				UserID:           userID,
				NotificationType: NotificationTypeCommentApproved,
				CommentPublicID:  "CMTPEND00001",
				HiddenReason:     CommentHiddenReasonStaff,
			},
		},
		{
			name: "hidden without a reason",
			n: CommentAuthorNotification{
				TenantID:         tenantID,
				UserID:           userID,
				NotificationType: NotificationTypeCommentHidden,
				CommentPublicID:  "CMTHIDE00001",
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			queries := &stubCommentAuthorNotifier{}
			if err := NotifyCommentAuthor(context.Background(), queries, tc.n); err == nil {
				t.Fatal("NotifyCommentAuthor error = nil, want a validation error")
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
) (dbmodels.Notification, error) {
	if s.createErr != nil {
		return dbmodels.Notification{}, s.createErr
	}
	s.created = append(s.created, arg)
	return dbmodels.Notification{ID: arg.ID}, nil
}
