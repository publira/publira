package publicapi

import (
	"testing"

	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// assertCommentCreator fails unless got names want, or names nobody when want
// is the zero creator.
func assertCommentCreator(t *testing.T, what string, got *publirav1.EpisodeCommentCreator, want testutil.Creator) {
	t.Helper()

	if want.ID == uuid.Nil {
		if got != nil {
			t.Fatalf("%s creator = %v, want none", what, got)
		}
		return
	}
	if got == nil {
		t.Fatalf("%s creator = none, want %s", what, want.Name)
	}
	if got.Id != want.ID.String() || got.PublicId != want.PublicID || got.Name != want.Name {
		t.Fatalf("%s creator = {%s %s %q}, want {%s %s %q}", what, got.Id, got.PublicId, got.Name, want.ID, want.PublicID, want.Name)
	}
}

// publicCommentByPublicID finds one comment on a page of the public list.
func publicCommentByPublicID(t *testing.T, comments []*publirav1.EpisodeComment, publicID string) *publirav1.EpisodeComment {
	t.Helper()

	for _, comment := range comments {
		if comment.PublicId == publicID {
			return comment
		}
	}
	t.Fatalf("public comments = %v, want %s among them", commentPublicIDs(comments), publicID)
	return nil
}

// The mark is an answer about the episode, not the account: the creator's
// account carries it on an episode that credits them and nowhere else, and an
// account linked to no creator never does. The post response and the public
// list agree, so the author's comment reads the same before and after the page
// re-reads it.
func TestDBEpisodeCommentCarriesTheCreditedCreator(t *testing.T) {
	fixture := newCommentFixture(t, "CMK")
	env, tenant, reader, series, credited := fixture.env, fixture.tenant, fixture.member, fixture.series, fixture.episode
	env.setCommentMode(t, tenant.ID, "immediate")
	uncredited := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "CMKEPISODE02",
		Title:    "Uncredited episode",
		Status:   testutil.EpisodeStatusPublished,
	})

	penName := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Pen Name"})
	env.PG.SeedEpisodeCreator(t, tenant.ID, credited.ID, penName.ID, "")
	creatorAccount := env.PG.SeedEndUser(t, tenant.ID, "CMKCREATOR01", "creator@cmk-comment.example.com", "Account Name")
	env.PG.SeedCreatorAccount(t, tenant.ID, penName.ID, creatorAccount.ID)

	byCreator := env.mustPostComment(t, tenant, creatorAccount, credited.ID.String(), "Thank you for reading.")
	assertCommentCreator(t, "posted on the credited episode", byCreator.Creator, penName)
	byReader := env.mustPostComment(t, tenant, reader, credited.ID.String(), "Loved it.")
	assertCommentCreator(t, "posted by a reader", byReader.Creator, testutil.Creator{})
	elsewhere := env.mustPostComment(t, tenant, creatorAccount, uncredited.ID.String(), "Not my episode, but a good one.")
	assertCommentCreator(t, "posted on an uncredited episode", elsewhere.Creator, testutil.Creator{})

	creditedPage := env.listComments(t, tenant, credited.ID.String(), 0, "").Comments
	creatorComment := publicCommentByPublicID(t, creditedPage, byCreator.PublicId)
	assertCommentCreator(t, "listed on the credited episode", creatorComment.Creator, penName)
	// The account's own name stays where it was: the mark is beside it, not
	// instead of it.
	if creatorComment.AuthorName != "Account Name" {
		t.Fatalf("author_name = %q, want the account's own name", creatorComment.AuthorName)
	}
	assertCommentCreator(t, "a reader's listed", publicCommentByPublicID(t, creditedPage, byReader.PublicId).Creator, testutil.Creator{})

	uncreditedPage := env.listComments(t, tenant, uncredited.ID.String(), 0, "").Comments
	assertCommentCreator(t, "listed on an uncredited episode", publicCommentByPublicID(t, uncreditedPage, elsewhere.PublicId).Creator, testutil.Creator{})
}

// A comment the author can still see but nobody else can — one awaiting
// approval — is marked in the author's own list and in the post response, so
// the badge does not appear only once staff approve it.
func TestDBMyEpisodeCommentCarriesTheCreditedCreator(t *testing.T) {
	fixture := newCommentFixture(t, "CMY")
	env, tenant, reader, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode
	env.setCommentMode(t, tenant.ID, "approval_required")

	penName := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Pen Name"})
	env.PG.SeedEpisodeCreator(t, tenant.ID, episode.ID, penName.ID, "")
	creatorAccount := env.PG.SeedEndUser(t, tenant.ID, "CMYCREATOR01", "creator@cmy-comment.example.com", "Account Name")
	env.PG.SeedCreatorAccount(t, tenant.ID, penName.ID, creatorAccount.ID)

	posted := env.mustPostComment(t, tenant, creatorAccount, episode.ID.String(), "A note from the author.")
	if !posted.AwaitingApproval {
		t.Fatalf("comment posted under approval_required = published, want awaiting approval")
	}
	assertCommentCreator(t, "posted awaiting approval", posted.Creator, penName)

	own := env.listMyComments(t, tenant, creatorAccount, episode.ID.String())
	if len(own) != 1 || own[0].PublicId != posted.PublicId {
		t.Fatalf("own comments = %v, want only %s", myCommentPublicIDs(own), posted.PublicId)
	}
	assertCommentCreator(t, "listed among the author's own", own[0].Creator, penName)

	readerPosted := env.mustPostComment(t, tenant, reader, episode.ID.String(), "A note from a reader.")
	assertCommentCreator(t, "a reader's posted", readerPosted.Creator, testutil.Creator{})
	readerOwn := env.listMyComments(t, tenant, reader, episode.ID.String())
	if len(readerOwn) != 1 {
		t.Fatalf("reader's own comments = %v, want one", myCommentPublicIDs(readerOwn))
	}
	assertCommentCreator(t, "listed among a reader's own", readerOwn[0].Creator, testutil.Creator{})
}

// One comment carries one name however many credits stand behind its author:
// an account whose two pen names are both credited, one of them twice, is
// named by the credit that leads the episode's credit line — the role first,
// whatever the names sort to — and the comment is listed once.
func TestDBEpisodeCommentNamesTheCreditThatSortsFirst(t *testing.T) {
	fixture := newCommentFixture(t, "CMF")
	env, tenant, episode := fixture.env, fixture.tenant, fixture.episode
	env.setCommentMode(t, tenant.ID, "immediate")

	// The artist's name sorts before the original author's, so only the role
	// order can pick the original author.
	artist := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Aki Artist"})
	author := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Zen Author"})
	env.PG.SeedEpisodeCreator(t, tenant.ID, episode.ID, artist.ID, "Artist")
	env.PG.SeedEpisodeCreator(t, tenant.ID, episode.ID, artist.ID, "Writer")
	env.PG.SeedEpisodeCreator(t, tenant.ID, episode.ID, author.ID, "Original Author")
	account := env.PG.SeedEndUser(t, tenant.ID, "CMFCREATOR01", "creator@cmf-comment.example.com", "Account Name")
	env.PG.SeedCreatorAccount(t, tenant.ID, artist.ID, account.ID)
	env.PG.SeedCreatorAccount(t, tenant.ID, author.ID, account.ID)

	posted := env.mustPostComment(t, tenant, account, episode.ID.String(), "Both of us thank you.")
	assertCommentCreator(t, "posted", posted.Creator, author)

	page := env.listComments(t, tenant, episode.ID.String(), 0, "").Comments
	if len(page) != 1 {
		t.Fatalf("public comments = %v, want the one comment once", commentPublicIDs(page))
	}
	assertCommentCreator(t, "listed", page[0].Creator, author)
}
