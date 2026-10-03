package adminapi

import (
	"context"
	"testing"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// The moderation queue reads the same mark the public list does, through the
// same credited_creator_of_account, so a moderator is told a comment is the
// author's own word on their work before deciding on it. These run against a
// real database on the RLS-bound admin role, the way a request does.

// creditedCreatorFixture is a moderation fixture whose episode credits a
// creator linked to an account of the tenant, beside a second episode of the
// same series that does not credit them.
type creditedCreatorFixture struct {
	commentModerationFixture
	uncredited     testutil.Episode
	creator        testutil.Creator
	creatorAccount testutil.TenantUser
}

func newCreditedCreatorFixture(t *testing.T, env *adminDBEnv, prefix, domain string) creditedCreatorFixture {
	t.Helper()

	fixture := newCommentModerationFixture(t, env, prefix, domain)
	tenantID := fixture.admin.Tenant.ID
	uncredited := env.PG.SeedEpisode(t, tenantID, fixture.series.ID, testutil.EpisodeSeed{
		PublicID: prefix + "EPISODE02",
		Title:    "Uncredited episode " + prefix,
		Status:   testutil.EpisodeStatusPublished,
	})
	creator := env.PG.SeedCreator(t, tenantID, testutil.CreatorSeed{Name: "Pen Name " + prefix})
	env.PG.SeedEpisodeCreator(t, tenantID, fixture.episode.ID, creator.ID, "")
	creatorAccount := env.PG.SeedEndUser(t, tenantID, prefix+"CREATOR01", "creator@"+domain, "Account Name "+prefix)
	env.PG.SeedCreatorAccount(t, tenantID, creator.ID, creatorAccount.ID)

	return creditedCreatorFixture{
		commentModerationFixture: fixture,
		uncredited:               uncredited,
		creator:                  creator,
		creatorAccount:           creatorAccount,
	}
}

func adminCommentByPublicID(t *testing.T, comments []*publiraadminv1.AdminComment, publicID string) *publiraadminv1.AdminComment {
	t.Helper()

	for _, comment := range comments {
		if comment.PublicId == publicID {
			return comment
		}
	}
	t.Fatalf("listed comments = %v, want %s among them", adminCommentPublicIDs(comments), publicID)
	return nil
}

// The mark answers about the episode: the creator's account carries it on the
// episode that credits them and not on the one beside it, and a reader's
// comment never does. A single comment read back by an action carries the same
// answer the list gave.
func TestDBAdminCommentCarriesTheCreditedCreator(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := newCreditedCreatorFixture(t, env, "ACM", "admin-comment-creator.example.com")
	byCreator := fixture.seedCommentBy(t, fixture.creatorAccount.ID, fixture.episode.ID, "ACMCREATOR02", "pending")
	byReader := fixture.seedComment(t, "ACMREADER001", "published")
	elsewhere := fixture.seedCommentBy(t, fixture.creatorAccount.ID, fixture.uncredited.ID, "ACMELSEWHERE", "published")

	listed := fixture.list(t, &publiraadminv1.ListCommentsRequest{}).Comments
	creatorComment := adminCommentByPublicID(t, listed, byCreator.PublicID)
	assertAdminCommentCreator(t, "listed on the credited episode", creatorComment, fixture.creator)
	// The account's own name stays where it was: the mark is beside it, not
	// instead of it.
	if creatorComment.AuthorName != fixture.creatorAccount.Name {
		t.Fatalf("author_name = %q, want the account's own name %q", creatorComment.AuthorName, fixture.creatorAccount.Name)
	}
	assertAdminCommentCreator(t, "a reader's", adminCommentByPublicID(t, listed, byReader.PublicID), testutil.Creator{})
	assertAdminCommentCreator(t, "listed on an uncredited episode", adminCommentByPublicID(t, listed, elsewhere.PublicID), testutil.Creator{})

	// Narrowing the list to the account reads the same answer per episode.
	byAccount := fixture.list(t, &publiraadminv1.ListCommentsRequest{AuthorPublicId: fixture.creatorAccount.PublicID}).Comments
	assertAdminCommentCreator(t, "the account's on the credited episode", adminCommentByPublicID(t, byAccount, byCreator.PublicID), fixture.creator)
	assertAdminCommentCreator(t, "the account's on an uncredited episode", adminCommentByPublicID(t, byAccount, elsewhere.PublicID), testutil.Creator{})

	// The author's comment is moderated like any other, and the comment the
	// action answers with still says whose it is.
	client := env.commentClient()
	approved, err := client.ApproveComment(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.ApproveCommentRequest{
		Tenant:    fixture.admin.tenantContext(),
		CommentId: byCreator.ID.String(),
	}))
	if err != nil {
		t.Fatalf("ApproveComment: %v", err)
	}
	if approved.Msg.Comment.Status != commentStatusPublished {
		t.Fatalf("approved status = %s, want published", approved.Msg.Comment.Status)
	}
	assertAdminCommentCreator(t, "approved", approved.Msg.Comment, fixture.creator)

	hidden, err := client.HideComment(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.HideCommentRequest{
		Tenant:    fixture.admin.tenantContext(),
		CommentId: elsewhere.ID.String(),
	}))
	if err != nil {
		t.Fatalf("HideComment: %v", err)
	}
	assertAdminCommentCreator(t, "hidden on an uncredited episode", hidden.Msg.Comment, testutil.Creator{})
}

// A moderator working the report queue is told the reported comment is the
// author's before deciding on the report, and the decision's answer carries the
// same mark.
func TestDBAdminCommentReportCarriesTheCreditedCreator(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := newCreditedCreatorFixture(t, env, "ARM", "admin-report-creator.example.com")
	byCreator := fixture.seedCommentBy(t, fixture.creatorAccount.ID, fixture.episode.ID, "ARMCREATOR02", "published")
	byReader := fixture.seedComment(t, "ARMREADER001", "published")
	reporter := fixture.seedReporter(t, "ARMREPORT001", "reporter@admin-report-creator.example.com", "Reporter ARM")
	creatorReport := fixture.seedReport(t, byCreator.ID, reporter, "other", "")
	readerReport := fixture.seedReport(t, byReader.ID, reporter, "spam", "")

	queue := fixture.listReports(t, &publiraadminv1.ListCommentReportsRequest{Status: commentReportStatusOpen}).Reports
	if got := len(queue); got != 2 {
		t.Fatalf("open reports = %v, want two", commentReportIDs(queue))
	}
	for _, report := range queue {
		switch report.ReportId {
		case creatorReport.String():
			assertAdminCommentCreator(t, "reported by the creator", report.Comment, fixture.creator)
		case readerReport.String():
			assertAdminCommentCreator(t, "reported by a reader", report.Comment, testutil.Creator{})
		default:
			t.Fatalf("unexpected report %s in the queue", report.ReportId)
		}
	}

	resolved := fixture.resolveReport(t, creatorReport, commentReportStatusRejected, "")
	assertAdminCommentCreator(t, "resolved", resolved.Comment, fixture.creator)
}

// A creator unlinked from the account stops marking that account's comments:
// the mark is read from the link as it stands, not stored on the comment.
func TestDBAdminCommentCreatorMarkFollowsTheLink(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := newCreditedCreatorFixture(t, env, "AUL", "admin-unlinked-creator.example.com")
	byCreator := fixture.seedCommentBy(t, fixture.creatorAccount.ID, fixture.episode.ID, "AULCREATOR02", "published")

	listed := fixture.list(t, &publiraadminv1.ListCommentsRequest{}).Comments
	assertAdminCommentCreator(t, "while linked", adminCommentByPublicID(t, listed, byCreator.PublicID), fixture.creator)

	if _, err := env.creatorClient().UnlinkCreatorAccount(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.UnlinkCreatorAccountRequest{
		Tenant:    fixture.admin.tenantContext(),
		CreatorId: fixture.creator.ID.String(),
		ReaderId:  fixture.creatorAccount.ID.String(),
	})); err != nil {
		t.Fatalf("UnlinkCreatorAccount: %v", err)
	}

	listed = fixture.list(t, &publiraadminv1.ListCommentsRequest{}).Comments
	assertAdminCommentCreator(t, "once unlinked", adminCommentByPublicID(t, listed, byCreator.PublicID), testutil.Creator{})
}
