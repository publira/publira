package publicapi

import (
	"testing"
	"time"

	"connectrpc.com/connect"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/ratelimit"
)

// The flood control as a reader meets it, on the real handler and the real
// tenant-scoped role: what an exhausted allowance answers, that a refused
// request stores nothing, and that one reader spending their allowance leaves
// every other reader's untouched.

// guardsWith is the tight policy these cases need. A window of an hour keeps
// the allowance from refilling while a case runs, so the count is what the
// assertions are about rather than how long the database took.
func guardsWith(rules map[readerAction][]ratelimit.Rule) readerGuards {
	return readerGuards{
		limiter:                ratelimit.New(ratelimit.NewMemoryStore()),
		rules:                  rules,
		duplicateCommentWindow: defaultDuplicateCommentWindow,
	}
}

func TestDBPostEpisodeCommentSpendsAnAllowancePerReader(t *testing.T) {
	fixture := newCommentFixtureWithGuards(t, "FLD", guardsWith(map[readerAction][]ratelimit.Rule{
		actionPostComment: {{Limit: 2, Window: time.Hour}},
	}))
	env, tenant, member, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode
	env.setCommentMode(t, tenant.ID, "immediate")

	env.mustPostComment(t, tenant, member, episode.PublicID, "The first thing I have to say.")
	env.mustPostComment(t, tenant, member, episode.PublicID, "The second thing I have to say.")

	_, err := env.postComment(t, tenant, member, episode.PublicID, "And a third.")
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the post past the allowance error = %v, want resource_exhausted", err)
	}
	if got := env.countRows(t, "SELECT COUNT(*) FROM episode_comments WHERE tenant_id = $1", tenant.ID); got != 2 {
		t.Fatalf("episode_comments = %d rows, want the refused post to write nothing", got)
	}

	// The allowance belongs to the reader who spent it. Another reader of the
	// same tenant arrives with a full one.
	other := env.PG.SeedEndUser(t, tenant.ID, "FLDREADER", "fld-reader@example.com", "Another Reader")
	env.mustPostComment(t, tenant, other, episode.PublicID, "I have not posted here before.")
}

func TestDBPostEpisodeCommentRefusesARepeatedBody(t *testing.T) {
	fixture := newCommentFixtureWithGuards(t, "DUP", guardsWith(map[readerAction][]ratelimit.Rule{
		actionPostComment: {{Limit: 100, Window: time.Hour}},
	}))
	env, tenant, member, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode
	env.setCommentMode(t, tenant.ID, "immediate")

	const repeated = "This chapter was worth the wait."
	env.mustPostComment(t, tenant, member, episode.PublicID, repeated)

	_, err := env.postComment(t, tenant, member, episode.PublicID, repeated)
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("the repeated body error = %v, want already_exists", err)
	}
	// The body is compared after it is trimmed, so padding does not make the
	// same sentence a different comment.
	if _, err := env.postComment(t, tenant, member, episode.PublicID, "  "+repeated+"\n"); connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("the padded repeat error = %v, want already_exists", err)
	}

	// Saying something else is not a repeat, and neither is another reader
	// agreeing in the same words.
	env.mustPostComment(t, tenant, member, episode.PublicID, "And the cliffhanger got me.")
	other := env.PG.SeedEndUser(t, tenant.ID, "DUPREADER", "dup-reader@example.com", "Another Reader")
	env.mustPostComment(t, tenant, other, episode.PublicID, repeated)

	if got := env.countRows(t, "SELECT COUNT(*) FROM episode_comments WHERE tenant_id = $1", tenant.ID); got != 3 {
		t.Fatalf("episode_comments = %d rows, want the two repeats to have written nothing", got)
	}
}

func TestDBReportEpisodeCommentSpendsAnAllowancePerReader(t *testing.T) {
	fixture := newCommentFixtureWithGuards(t, "RFL", guardsWith(map[readerAction][]ratelimit.Rule{
		actionReportComment: {{Limit: 1, Window: time.Hour}},
	}))
	env, tenant, member, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode
	env.setCommentMode(t, tenant.ID, "immediate")
	reporter := env.PG.SeedEndUser(t, tenant.ID, "RFLREADER", "rfl-reader@example.com", "Reporting Reader")

	first := env.mustPostComment(t, tenant, member, episode.PublicID, "Buy cheap watches at example.com")
	second := env.mustPostComment(t, tenant, member, episode.PublicID, "Buy cheaper watches at example.net")

	if err := env.reportComment(t, tenant, reporter, first.PublicId, publirav1.CommentReportReason_COMMENT_REPORT_REASON_SPAM); err != nil {
		t.Fatalf("the first report: %v", err)
	}
	err := env.reportComment(t, tenant, reporter, second.PublicId, publirav1.CommentReportReason_COMMENT_REPORT_REASON_SPAM)
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the report past the allowance error = %v, want resource_exhausted", err)
	}
	if got := env.openReportCount(t, tenant, second.PublicId); got != 0 {
		t.Fatalf("open_report_count of the second comment = %d, want the refused report to have counted for nothing", got)
	}

	// A reporting spree by one account is what the allowance stops; it must not
	// stop the queue from filling with the reports of everyone else.
	another := env.PG.SeedEndUser(t, tenant.ID, "RFLREADER2", "rfl-reader-2@example.com", "Another Reader")
	if err := env.reportComment(t, tenant, another, second.PublicId, publirav1.CommentReportReason_COMMENT_REPORT_REASON_SPAM); err != nil {
		t.Fatalf("another reader's report: %v", err)
	}
	if got := env.openReportCount(t, tenant, second.PublicId); got != 1 {
		t.Fatalf("open_report_count after another reader = %d, want 1", got)
	}
}
