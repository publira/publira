package publicapi

import (
	"context"
	"regexp"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
)

// The rest of CommentService is asserted against a real database in
// comment_db_integration_test.go: the tenant's comment mode, the episode body
// access rule, and who may read a comment in each state are all decided by
// stored rows, and canned sqlmock replies would only restate the answers the
// test itself supplied. What stays here is what a handler costs rather than
// what it answers.

func TestValidateCommentBody(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		want     string
		wantCode connect.Code
	}{
		{
			name: "trims the surrounding whitespace it stores",
			body: "  A comment.\n",
			want: "A comment.",
		},
		{
			name: "keeps a body of exactly the limit",
			body: strings.Repeat("a", maxCommentBodyRunes),
			want: strings.Repeat("a", maxCommentBodyRunes),
		},
		{
			// The limit counts code points, so a body of multi-byte characters is
			// as long as one of ASCII rather than a third of it.
			name: "measures multi-byte characters as one each",
			body: strings.Repeat("あ", maxCommentBodyRunes),
			want: strings.Repeat("あ", maxCommentBodyRunes),
		},
		{
			// Whitespace is removed before the length is measured, so padding
			// cannot push an acceptable body over the limit.
			name: "trims before measuring",
			body: "  " + strings.Repeat("a", maxCommentBodyRunes) + "  ",
			want: strings.Repeat("a", maxCommentBodyRunes),
		},
		{
			name:     "rejects an empty body",
			body:     "",
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name:     "rejects a body of nothing but whitespace",
			body:     " \t\n　",
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name:     "rejects a body over the limit",
			body:     strings.Repeat("a", maxCommentBodyRunes+1),
			wantCode: connect.CodeInvalidArgument,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := validateCommentBody(test.body)
			if test.wantCode != 0 {
				if connect.CodeOf(err) != test.wantCode {
					t.Fatalf("validateCommentBody(%q) error = %v, want %v", test.body, err, test.wantCode)
				}
				return
			}
			if err != nil {
				t.Fatalf("validateCommentBody(%q): %v", test.body, err)
			}
			if got != test.want {
				t.Fatalf("validateCommentBody(%q) = %q, want %q", test.body, got, test.want)
			}
		})
	}
}

func TestValidateCommentReportNote(t *testing.T) {
	tests := []struct {
		name     string
		note     string
		want     string
		wantNote bool
		wantCode connect.Code
	}{
		{
			name:     "trims the surrounding whitespace it stores",
			note:     "  They post this on every episode.\n",
			want:     "They post this on every episode.",
			wantNote: true,
		},
		{
			// The reason alone is a complete report, so a reader who added
			// nothing gets a row with no note rather than one holding "".
			name: "stores no note at all for an empty one",
			note: "",
		},
		{
			name: "stores no note at all for one of nothing but whitespace",
			note: " \t\n　",
		},
		{
			name:     "keeps a note of exactly the limit",
			note:     strings.Repeat("a", maxCommentReportNoteRunes),
			want:     strings.Repeat("a", maxCommentReportNoteRunes),
			wantNote: true,
		},
		{
			// The limit counts code points, as the body limit does, so a note
			// written in Japanese holds as many characters as an English one.
			name:     "measures multi-byte characters as one each",
			note:     strings.Repeat("あ", maxCommentReportNoteRunes),
			want:     strings.Repeat("あ", maxCommentReportNoteRunes),
			wantNote: true,
		},
		{
			name:     "trims before measuring",
			note:     "  " + strings.Repeat("a", maxCommentReportNoteRunes) + "  ",
			want:     strings.Repeat("a", maxCommentReportNoteRunes),
			wantNote: true,
		},
		{
			name:     "rejects a note over the limit",
			note:     strings.Repeat("a", maxCommentReportNoteRunes+1),
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name:     "rejects a multi-byte note over the limit",
			note:     strings.Repeat("あ", maxCommentReportNoteRunes+1),
			wantCode: connect.CodeInvalidArgument,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := validateCommentReportNote(test.note)
			if test.wantCode != 0 {
				if connect.CodeOf(err) != test.wantCode {
					t.Fatalf("validateCommentReportNote(%q) error = %v, want %v", test.note, err, test.wantCode)
				}
				return
			}
			if err != nil {
				t.Fatalf("validateCommentReportNote(%q): %v", test.note, err)
			}
			if got.Valid != test.wantNote {
				t.Fatalf("validateCommentReportNote(%q) valid = %t, want %t", test.note, got.Valid, test.wantNote)
			}
			if got.String != test.want {
				t.Fatalf("validateCommentReportNote(%q) = %q, want %q", test.note, got.String, test.want)
			}
		})
	}
}

// The creator mark is read inside the page's own statement, so a page of
// comments costs the tenant, the episode, and the page and nothing per
// comment. This is the one property of the list a real database cannot show,
// so it is asserted here: sqlmock fails on any statement it was not told to
// expect.
func TestListEpisodeCommentsReadsTheCreatorMarkWithThePage(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	creatorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Second)

	testServer, mock := newTestPublicServer(t)
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPublishedEpisodeForTenant)).
		WithArgs(tenantID, sqlmock.AnyArg(), nil, "web").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "series_id", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "series_public_id", "series_title", "series_eye_catch_image_id", "series_eye_catch_image_updated_at", "series_age_rating", "series_comment_mode", "reading_direction", "spread_start_index", "series_reading_direction", "series_spread_start_index", "is_free", "free_until", "rating_count", "purchase_availability"}).
			AddRow(episodeID, "EPISODE001", "Episode Title", int32(1), seriesID, int32(0), nil, "published", nil, now, "SERIES001", "Series Title", nil, nil, nil, nil, nil, nil, nil, nil, true, nil, int64(0), "all"))
	rows := sqlmock.NewRows([]string{"id", "public_id", "body", "created_at", "user_id", "author_public_id", "author_name", "creator_id", "creator_public_id", "creator_name"}).
		AddRow(uuid.Must(uuid.NewV7()), "COMMENT00001", "From the author.", now, uuid.Must(uuid.NewV7()), "USERCREATOR1", "Account Name", creatorID, "CREATOR00001", "Pen Name").
		AddRow(uuid.Must(uuid.NewV7()), "COMMENT00002", "From a reader.", now, uuid.Must(uuid.NewV7()), "USERREADER01", "Reader", nil, nil, nil).
		AddRow(uuid.Must(uuid.NewV7()), "COMMENT00003", "From another reader.", now, uuid.Must(uuid.NewV7()), "USERREADER02", "Reader", nil, nil, nil)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedEpisodeCommentsByCreatedAtDesc)).
		WillReturnRows(rows)

	client := publirav1connect.NewCommentServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	res, err := client.ListEpisodeComments(context.Background(), &publirav1.ListEpisodeCommentsRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId: episodeID.String(),
	})
	if err != nil {
		t.Fatalf("ListEpisodeComments: %v", err)
	}
	if got := len(res.Comments); got != 3 {
		t.Fatalf("comments = %d, want 3", got)
	}
	if got := res.Comments[0].Creator; got == nil || got.Id != creatorID.String() || got.PublicId != "CREATOR00001" || got.Name != "Pen Name" {
		t.Fatalf("author's comment creator = %v, want Pen Name", got)
	}
	for _, comment := range res.Comments[1:] {
		if comment.Creator != nil {
			t.Fatalf("reader's comment %s creator = %v, want none", comment.PublicId, comment.Creator)
		}
	}

	assertPublicExpectations(t, mock)
}
