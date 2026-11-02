package publicapi

import (
	"context"
	"database/sql"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// insertCreatorPageComment writes one comment in the given status at the given
// time, with the columns the status requires, so the list's order and filter
// are tested on rows nothing else has touched.
func (e *publicDBEnv) insertCreatorPageComment(
	t *testing.T,
	tenantID, episodeID, userID uuid.UUID,
	publicID, status string,
	createdAt time.Time,
) {
	t.Helper()

	var publishedAt, hiddenAt, withdrawnAt sql.NullTime
	var hiddenReason sql.NullString
	if status != commentStatusPending {
		publishedAt = sql.NullTime{Time: createdAt, Valid: true}
	}
	switch status {
	case "hidden":
		hiddenAt = sql.NullTime{Time: createdAt, Valid: true}
		hiddenReason = sql.NullString{String: "auto_reports", Valid: true}
	case "withdrawn":
		withdrawnAt = sql.NullTime{Time: createdAt, Valid: true}
	}
	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO episode_comments (
			id, tenant_id, public_id, episode_id, user_id, body, status,
			created_at, published_at, hidden_at, hidden_reason, withdrawn_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, uuid.Must(uuid.NewV7()), tenantID, publicID, episodeID, userID, "Comment "+publicID, status,
		createdAt, publishedAt, hiddenAt, hiddenReason, withdrawnAt,
	); err != nil {
		t.Fatalf("insert comment %s: %v", publicID, err)
	}
}

func creatorCommentPublicIDs(comments []*publirav1.MyCreatorEpisodeComment) []string {
	ids := make([]string, 0, len(comments))
	for _, comment := range comments {
		ids = append(ids, comment.GetComment().GetPublicId())
	}
	return ids
}

// A linked reader reads, newest first, what every reader reads under each
// episode crediting their creator: no comment awaiting approval or removed,
// none on an episode the storefront does not show, and none on an episode
// crediting someone else or crediting the creator only through its series.
// Their own comment carries the creator it carries under the episode.
func TestDBCreatorServiceListsThePublishedCommentsOnTheCreatorsEpisodes(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	f := env.seedCreatorPages(t, "CRCMTA")
	// Comments are public, so the list does not wait for the sales figures.
	env.setCreatorPages(t, f.tenant.ID, true, false)
	commenter := env.PG.SeedEndUser(t, f.tenant.ID, "CRCMTACMT", "commenter@CRCMTA.example.com", "Commenter")

	otherSeries := env.PG.SeedSeries(t, f.tenant.ID, testutil.SeriesSeed{PublicID: "CRCMTASR2", Title: "Other series", Published: true})
	coAuthorsOwn := env.PG.SeedEpisode(t, f.tenant.ID, otherSeries.ID, testutil.EpisodeSeed{PublicID: "CRCMTAEP4", Title: "Co-author's own", Status: testutil.EpisodeStatusPublished})
	env.PG.SeedEpisodeCreator(t, f.tenant.ID, coAuthorsOwn.ID, f.coAuthor.ID, "")
	seriesCreditOnly := env.PG.SeedEpisode(t, f.tenant.ID, otherSeries.ID, testutil.EpisodeSeed{PublicID: "CRCMTAEP5", Title: "Series credit only", Status: testutil.EpisodeStatusPublished})
	env.PG.SeedSeriesCreator(t, f.tenant.ID, otherSeries.ID, f.creator.ID, "")
	unpublished := env.PG.SeedEpisode(t, f.tenant.ID, otherSeries.ID, testutil.EpisodeSeed{PublicID: "CRCMTAEP6", Title: "Unpublished"})
	env.PG.SeedEpisodeCreator(t, f.tenant.ID, unpublished.ID, f.creator.ID, "")

	now := time.Now().UTC().Truncate(time.Second)
	for _, comment := range []struct {
		publicID  string
		episodeID uuid.UUID
		userID    uuid.UUID
		status    string
		age       time.Duration
	}{
		{"CRCMTAC01", f.firstEpisode.ID, commenter.ID, commentStatusPublished, 9 * time.Hour},
		{"CRCMTAC02", f.secondEpisode.ID, commenter.ID, commentStatusPublished, 8 * time.Hour},
		{"CRCMTAC03", f.firstEpisode.ID, f.reader.ID, commentStatusPublished, 7 * time.Hour},
		{"CRCMTAC04", f.secondEpisode.ID, commenter.ID, commentStatusPending, 6 * time.Hour},
		{"CRCMTAC05", f.firstEpisode.ID, commenter.ID, "hidden", 5 * time.Hour},
		{"CRCMTAC06", f.firstEpisode.ID, commenter.ID, "withdrawn", 4 * time.Hour},
		{"CRCMTAC07", coAuthorsOwn.ID, commenter.ID, commentStatusPublished, 3 * time.Hour},
		{"CRCMTAC08", seriesCreditOnly.ID, commenter.ID, commentStatusPublished, 2 * time.Hour},
		{"CRCMTAC09", unpublished.ID, commenter.ID, commentStatusPublished, time.Hour},
	} {
		env.insertCreatorPageComment(t, f.tenant.ID, comment.episodeID, comment.userID, comment.publicID, comment.status, now.Add(-comment.age))
	}

	client := env.creatorClient()
	ctx := testutil.WithBearer(context.Background(), tokenFor(t, f.tenant, f.reader))
	list := func(limit int32, token string) *publirav1.ListMyCreatorEpisodeCommentsResponse {
		t.Helper()
		res, err := client.ListMyCreatorEpisodeComments(ctx, &publirav1.ListMyCreatorEpisodeCommentsRequest{
			Tenant: tenantContext(f.tenant), CreatorId: f.creator.ID.String(), Limit: limit, Token: token,
		})
		if err != nil {
			t.Fatalf("ListMyCreatorEpisodeComments: %v", err)
		}
		return res
	}

	first := list(2, "")
	if got, want := creatorCommentPublicIDs(first.Comments), []string{"CRCMTAC03", "CRCMTAC02"}; !slices.Equal(got, want) {
		t.Fatalf("first page = %v, want %v", got, want)
	}
	if first.PreviousToken != "" || first.NextToken == "" {
		t.Fatalf("first page tokens = %q / %q, want a next page only", first.PreviousToken, first.NextToken)
	}
	own := first.Comments[0]
	if own.EpisodePublicId != f.firstEpisode.PublicID || own.EpisodeTitle != "First episode" ||
		own.SeriesPublicId != "CRCMTASER" || own.SeriesTitle != "Shared series" {
		t.Fatalf("own comment's episode = %s %q in %s %q, want %s in the shared series",
			own.EpisodePublicId, own.EpisodeTitle, own.SeriesPublicId, own.SeriesTitle, f.firstEpisode.PublicID)
	}
	if own.Comment.AuthorName != "Linked reader" {
		t.Fatalf("own comment author_name = %q, want the account's own name", own.Comment.AuthorName)
	}
	assertCommentCreator(t, "the Author's own comment", own.Comment.Creator, f.creator)
	assertCommentCreator(t, "a reader's comment", first.Comments[1].Comment.Creator, testutil.Creator{})

	second := list(2, first.NextToken)
	if got, want := creatorCommentPublicIDs(second.Comments), []string{"CRCMTAC01"}; !slices.Equal(got, want) {
		t.Fatalf("second page = %v, want %v", got, want)
	}
	if second.NextToken != "" || second.PreviousToken == "" {
		t.Fatalf("second page tokens = %q / %q, want a previous page only", second.PreviousToken, second.NextToken)
	}
	if got := second.Comments[0].EpisodePublicId; got != f.firstEpisode.PublicID {
		t.Fatalf("second page episode = %s, want %s", got, f.firstEpisode.PublicID)
	}

	back := list(2, second.PreviousToken)
	if got, want := creatorCommentPublicIDs(back.Comments), []string{"CRCMTAC03", "CRCMTAC02"}; !slices.Equal(got, want) {
		t.Fatalf("page before the second = %v, want %v", got, want)
	}
}
