package dbmodels_test

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/testutil"
)

func TestEpisodeCommentsRejectCrossTenantReferences(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	db := pg.DB
	tenantA := mustInsertTenant(t, ctx, db, "CMTTENANTA01", "cmt-a.example.com", "admin-cmt-a.example.com", "Comment Tenant A")
	tenantB := mustInsertTenant(t, ctx, db, "CMTTENANTB02", "cmt-b.example.com", "admin-cmt-b.example.com", "Comment Tenant B")
	userA := mustInsertUser(t, ctx, db, tenantA, "CMTUSERAAA01", "cmt-a@example.com", "Reader A")
	userB := mustInsertUser(t, ctx, db, tenantB, "CMTUSERBBB02", "cmt-b@example.com", "Reader B")
	episodeA := mustInsertEpisode(t, ctx, db, tenantA, "CMTEPAAAAA01", "Comment Episode A")
	episodeB := mustInsertEpisode(t, ctx, db, tenantB, "CMTEPBBBBB02", "Comment Episode B")

	queries := dbmodels.New(db)
	if _, err := queries.CreateEpisodeComment(ctx, newPublishedCommentParams(tenantA, episodeA, userA, "CMTOKAAAAA01")); err != nil {
		t.Fatalf("same-tenant comment insert: %v", err)
	}

	_, err := queries.CreateEpisodeComment(ctx, newPublishedCommentParams(tenantA, episodeB, userA, "CMTXEPAAAA01"))
	if !isForeignKeyViolation(err) || !strings.Contains(err.Error(), "episode_comments_tenant_episode_id_fkey") {
		t.Fatalf("cross-tenant episode error = %v, want episode_comments_tenant_episode_id_fkey", err)
	}

	_, err = queries.CreateEpisodeComment(ctx, newPublishedCommentParams(tenantA, episodeA, userB, "CMTXUSRAAA01"))
	if !isForeignKeyViolation(err) || !strings.Contains(err.Error(), "episode_comments_tenant_user_id_fkey") {
		t.Fatalf("cross-tenant user error = %v, want episode_comments_tenant_user_id_fkey", err)
	}

	awaiting := newPublishedCommentParams(tenantA, episodeA, userA, "CMTPENDINGA1")
	awaiting.Status = "pending"
	awaiting.PublishedAt = sql.NullTime{}
	if _, err := queries.CreateEpisodeComment(ctx, awaiting); err != nil {
		t.Fatalf("pending comment insert: %v", err)
	}
	_, err = queries.ApproveEpisodeCommentByPublicIDForTenant(ctx, dbmodels.ApproveEpisodeCommentByPublicIDForTenantParams{
		TenantID:   tenantA,
		PublicID:   awaiting.PublicID,
		ApprovedBy: userB,
	})
	if !isForeignKeyViolation(err) || !strings.Contains(err.Error(), "episode_comments_tenant_approved_by_fkey") {
		t.Fatalf("cross-tenant approver error = %v, want episode_comments_tenant_approved_by_fkey", err)
	}
}

// Deleting the staff account that moderated a comment drops only the actor
// column. The comment keeps its tenant, its text and the state staff left it in.
func TestDeletingAModeratorLeavesTheCommentOnItsTenant(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	seed := seedCommentTenant(t, ctx, pg.DB, "DEL")
	queries := dbmodels.New(pg.DB)

	comment := mustCreateComment(t, ctx, queries, seed, "published", "DELHIDDEN001")
	if _, err := queries.HideEpisodeCommentByPublicIDForTenant(ctx, dbmodels.HideEpisodeCommentByPublicIDForTenantParams{
		TenantID:     seed.tenantID,
		PublicID:     comment.PublicID,
		HiddenBy:     nullUUID(seed.staffID),
		HiddenReason: "staff",
	}); err != nil {
		t.Fatalf("hide: %v", err)
	}

	if _, err := pg.DB.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, seed.staffID); err != nil {
		t.Fatalf("delete moderator: %v", err)
	}

	queue, err := queries.ListEpisodeCommentsByStatusCreatedAtDesc(ctx, dbmodels.ListEpisodeCommentsByStatusCreatedAtDescParams{
		TenantID: seed.tenantID,
		Status:   "hidden",
		Limit:    10,
	})
	if err != nil {
		t.Fatalf("list hidden comments: %v", err)
	}
	if len(queue) != 1 {
		t.Fatalf("hidden queue = %v, want the removed comment still on its tenant", queue)
	}
	if queue[0].HiddenBy.Valid {
		t.Fatalf("hidden_by = %v, want NULL once the moderator is gone", queue[0].HiddenBy)
	}
	if queue[0].HiddenReason.String != "staff" {
		t.Fatalf("hidden_reason = %v, want staff so the removal is still told from an automatic one", queue[0].HiddenReason)
	}
}

// A comment approved, removed by staff, and restored comes back published,
// while one removed before approval returns to the approval queue.
func TestEpisodeCommentModerationReturnsToTheInterruptedState(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	seed := seedCommentTenant(t, ctx, pg.DB, "MOD")
	queries := dbmodels.New(pg.DB)

	approved := mustCreateComment(t, ctx, queries, seed, "pending", "MODAPPROVE01")
	if approved.PublishedAt.Valid {
		t.Fatalf("pending comment published_at = %v, want NULL", approved.PublishedAt)
	}

	published, err := queries.ApproveEpisodeCommentByPublicIDForTenant(ctx, dbmodels.ApproveEpisodeCommentByPublicIDForTenantParams{
		TenantID:   seed.tenantID,
		PublicID:   approved.PublicID,
		ApprovedBy: seed.staffID,
	})
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if published.Status != "published" || !published.PublishedAt.Valid {
		t.Fatalf("approved comment = (%s, %v), want published with a published_at", published.Status, published.PublishedAt)
	}

	hidden, err := queries.HideEpisodeCommentByPublicIDForTenant(ctx, dbmodels.HideEpisodeCommentByPublicIDForTenantParams{
		TenantID:     seed.tenantID,
		PublicID:     published.PublicID,
		HiddenBy:     nullUUID(seed.staffID),
		HiddenReason: "staff",
	})
	if err != nil {
		t.Fatalf("hide published comment: %v", err)
	}
	if hidden.Status != "hidden" || !hidden.HiddenAt.Valid || hidden.HiddenReason.String != "staff" {
		t.Fatalf("hidden comment = (%s, %v, %v), want hidden by staff with a hidden_at", hidden.Status, hidden.HiddenAt, hidden.HiddenReason)
	}
	if !hidden.PublishedAt.Valid {
		t.Fatalf("hidden comment published_at = %v, want the moment it went public retained", hidden.PublishedAt)
	}

	restored, err := queries.RestoreEpisodeCommentByPublicIDForTenant(ctx, dbmodels.RestoreEpisodeCommentByPublicIDForTenantParams{
		TenantID: seed.tenantID,
		PublicID: hidden.PublicID,
	})
	if err != nil {
		t.Fatalf("restore published comment: %v", err)
	}
	if restored.Status != "published" {
		t.Fatalf("restored comment status = %s, want published", restored.Status)
	}
	if restored.HiddenAt.Valid || restored.HiddenBy.Valid || restored.HiddenReason.Valid {
		t.Fatalf("restored comment kept removal columns: %v %v %v", restored.HiddenAt, restored.HiddenBy, restored.HiddenReason)
	}

	// The report threshold removes a comment with no staff actor to name.
	awaiting := mustCreateComment(t, ctx, queries, seed, "pending", "MODAUTOREP01")
	autoHidden, err := queries.HideEpisodeCommentByPublicIDForTenant(ctx, dbmodels.HideEpisodeCommentByPublicIDForTenantParams{
		TenantID:     seed.tenantID,
		PublicID:     awaiting.PublicID,
		HiddenReason: "auto_reports",
	})
	if err != nil {
		t.Fatalf("hide pending comment automatically: %v", err)
	}
	if autoHidden.HiddenBy.Valid {
		t.Fatalf("automatic removal hidden_by = %v, want NULL", autoHidden.HiddenBy)
	}

	backToQueue, err := queries.RestoreEpisodeCommentByPublicIDForTenant(ctx, dbmodels.RestoreEpisodeCommentByPublicIDForTenantParams{
		TenantID: seed.tenantID,
		PublicID: autoHidden.PublicID,
	})
	if err != nil {
		t.Fatalf("restore pending comment: %v", err)
	}
	if backToQueue.Status != "pending" {
		t.Fatalf("restored comment status = %s, want pending (it was never public)", backToQueue.Status)
	}

	// A transition that no longer applies changes nothing and reports no row.
	_, err = queries.ApproveEpisodeCommentByPublicIDForTenant(ctx, dbmodels.ApproveEpisodeCommentByPublicIDForTenantParams{
		TenantID:   seed.tenantID,
		PublicID:   restored.PublicID,
		ApprovedBy: seed.staffID,
	})
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("approving an already published comment error = %v, want sql.ErrNoRows", err)
	}
}

// The author's own deletion takes the comment away from them; staff removal
// does not, because the removal is silent.
func TestWithdrawEpisodeCommentLeavesTheAuthorsOwnList(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	seed := seedCommentTenant(t, ctx, pg.DB, "WDR")
	queries := dbmodels.New(pg.DB)

	kept := mustCreateComment(t, ctx, queries, seed, "published", "WDRKEPTAAA01")
	removed := mustCreateComment(t, ctx, queries, seed, "published", "WDRREMOVED01")
	if _, err := queries.HideEpisodeCommentByPublicIDForTenant(ctx, dbmodels.HideEpisodeCommentByPublicIDForTenantParams{
		TenantID:     seed.tenantID,
		PublicID:     removed.PublicID,
		HiddenBy:     nullUUID(seed.staffID),
		HiddenReason: "staff",
	}); err != nil {
		t.Fatalf("hide: %v", err)
	}

	own, err := queries.ListUserPendingOrHiddenEpisodeCommentsByCreatedAtDesc(ctx, dbmodels.ListUserPendingOrHiddenEpisodeCommentsByCreatedAtDescParams{
		TenantID:  seed.tenantID,
		UserID:    seed.userID,
		EpisodeID: seed.episodeID,
		Limit:     10,
	})
	if err != nil {
		t.Fatalf("list own comments: %v", err)
	}
	if got := userCommentPublicIDs(own); !slices.Equal(got, []string{removed.PublicID}) {
		t.Fatalf("own comments = %v, want the staff-removed %s still there", got, removed.PublicID)
	}

	public, err := queries.ListPublishedEpisodeCommentsByCreatedAtDesc(ctx, dbmodels.ListPublishedEpisodeCommentsByCreatedAtDescParams{
		TenantID:  seed.tenantID,
		EpisodeID: seed.episodeID,
		Limit:     10,
	})
	if err != nil {
		t.Fatalf("list public comments: %v", err)
	}
	if got := publishedCommentPublicIDs(public); !slices.Equal(got, []string{kept.PublicID}) {
		t.Fatalf("public comments = %v, want only %s", got, kept.PublicID)
	}

	withdrawn, err := queries.WithdrawEpisodeCommentByPublicIDForUser(ctx, dbmodels.WithdrawEpisodeCommentByPublicIDForUserParams{
		TenantID: seed.tenantID,
		UserID:   seed.userID,
		PublicID: removed.PublicID,
	})
	if err != nil {
		t.Fatalf("withdraw a removed comment: %v", err)
	}
	if withdrawn.Status != "withdrawn" || !withdrawn.WithdrawnAt.Valid {
		t.Fatalf("withdrawn comment = (%s, %v), want withdrawn with a withdrawn_at", withdrawn.Status, withdrawn.WithdrawnAt)
	}
	if withdrawn.HiddenAt.Valid || withdrawn.HiddenBy.Valid || withdrawn.HiddenReason.Valid {
		t.Fatalf("withdrawn comment kept removal columns: %v %v %v", withdrawn.HiddenAt, withdrawn.HiddenBy, withdrawn.HiddenReason)
	}

	own, err = queries.ListUserPendingOrHiddenEpisodeCommentsByCreatedAtDesc(ctx, dbmodels.ListUserPendingOrHiddenEpisodeCommentsByCreatedAtDescParams{
		TenantID:  seed.tenantID,
		UserID:    seed.userID,
		EpisodeID: seed.episodeID,
		Limit:     10,
	})
	if err != nil {
		t.Fatalf("list own comments after withdrawal: %v", err)
	}
	if got := userCommentPublicIDs(own); len(got) != 0 {
		t.Fatalf("own comments after withdrawal = %v, want none", got)
	}

	// The author's published comment was never in that list: the public list of
	// the episode already carries it, for them as for everyone else.
	public, err = queries.ListPublishedEpisodeCommentsByCreatedAtDesc(ctx, dbmodels.ListPublishedEpisodeCommentsByCreatedAtDescParams{
		TenantID:  seed.tenantID,
		EpisodeID: seed.episodeID,
		Limit:     10,
	})
	if err != nil {
		t.Fatalf("list public comments after withdrawal: %v", err)
	}
	if got := publishedCommentPublicIDs(public); !slices.Equal(got, []string{kept.PublicID}) {
		t.Fatalf("public comments after withdrawal = %v, want only %s", got, kept.PublicID)
	}

	// Staff still read it, which is what the retention window is for.
	queue, err := queries.ListEpisodeCommentsByStatusCreatedAtDesc(ctx, dbmodels.ListEpisodeCommentsByStatusCreatedAtDescParams{
		TenantID: seed.tenantID,
		Status:   "withdrawn",
		Limit:    10,
	})
	if err != nil {
		t.Fatalf("list withdrawn comments: %v", err)
	}
	if len(queue) != 1 || queue[0].PublicID != removed.PublicID {
		t.Fatalf("withdrawn queue = %v, want %s", queue, removed.PublicID)
	}
}

func TestPurgeWithdrawnEpisodeCommentsHonoursCutoffAndChunkSize(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	seed := seedCommentTenant(t, ctx, pg.DB, "PRG")
	queries := dbmodels.New(pg.DB)

	now := time.Now().UTC()
	expired := []string{"PRGOLDAAAA01", "PRGOLDBBBB02", "PRGOLDCCCC03"}
	for index, publicID := range expired {
		mustInsertWithdrawnComment(t, ctx, pg.DB, seed, publicID, now.AddDate(0, 0, -181-index))
	}
	recent := "PRGRECENTA01"
	mustInsertWithdrawnComment(t, ctx, pg.DB, seed, recent, now.AddDate(0, 0, -179))
	live := mustCreateComment(t, ctx, queries, seed, "published", "PRGLIVEAAA01")

	cutoff := now.AddDate(0, 0, -180)
	purgeParams := dbmodels.PurgeWithdrawnEpisodeCommentsParams{
		TenantID: seed.tenantID,
		Cutoff:   cutoff,
		Limit:    2,
	}
	first, err := queries.PurgeWithdrawnEpisodeComments(ctx, purgeParams)
	if err != nil {
		t.Fatalf("purge first chunk: %v", err)
	}
	if first != 2 {
		t.Fatalf("first chunk deleted %d rows, want 2", first)
	}

	second, err := queries.PurgeWithdrawnEpisodeComments(ctx, purgeParams)
	if err != nil {
		t.Fatalf("purge second chunk: %v", err)
	}
	if second != 1 {
		t.Fatalf("second chunk deleted %d rows, want the last expired row", second)
	}

	third, err := queries.PurgeWithdrawnEpisodeComments(ctx, purgeParams)
	if err != nil {
		t.Fatalf("purge third chunk: %v", err)
	}
	if third != 0 {
		t.Fatalf("third chunk deleted %d rows, want none left inside the window", third)
	}

	survivors := commentPublicIDsInTenant(t, ctx, pg.DB, seed.tenantID)
	if want := []string{live.PublicID, recent}; !slices.Equal(survivors, want) {
		t.Fatalf("surviving comments = %v, want %v", survivors, want)
	}
}

func TestListPublishedEpisodeCommentsPaginatesBothDirections(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	seed := seedCommentTenant(t, ctx, pg.DB, "PAG")
	createdAt := time.Now().UTC().Truncate(time.Microsecond)
	ids := make([]uuid.UUID, 4)
	publicIDs := make([]string, 4)
	for index := range ids {
		publicIDs[index] = "PAGCOMMENT0" + string(rune('A'+index))
		ids[index] = mustInsertPublishedCommentAt(t, ctx, pg.DB, seed, publicIDs[index], createdAt.Add(-time.Duration(index)*time.Minute))
	}

	queries := dbmodels.New(pg.DB)
	firstPage, err := queries.ListPublishedEpisodeCommentsByCreatedAtDesc(ctx, dbmodels.ListPublishedEpisodeCommentsByCreatedAtDescParams{
		TenantID:  seed.tenantID,
		EpisodeID: seed.episodeID,
		Limit:     2,
	})
	if err != nil {
		t.Fatalf("first page: %v", err)
	}
	if got := publishedCommentIDs(firstPage); !slices.Equal(got, ids[:2]) {
		t.Fatalf("first page = %v, want %v", got, ids[:2])
	}
	if firstPage[0].AuthorName != "Comment Reader" || firstPage[0].AuthorPublicID != seed.userPublicID {
		t.Fatalf("author = (%s, %s), want the posting reader", firstPage[0].AuthorName, firstPage[0].AuthorPublicID)
	}

	nextPage, err := queries.ListPublishedEpisodeCommentsByCreatedAtDesc(ctx, dbmodels.ListPublishedEpisodeCommentsByCreatedAtDescParams{
		TenantID:        seed.tenantID,
		EpisodeID:       seed.episodeID,
		CursorCreatedAt: sql.NullTime{Time: firstPage[1].CreatedAt, Valid: true},
		CursorID:        uuid.NullUUID{UUID: firstPage[1].ID, Valid: true},
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("next page: %v", err)
	}
	if got := publishedCommentIDs(nextPage); !slices.Equal(got, ids[2:]) {
		t.Fatalf("next page = %v, want %v", got, ids[2:])
	}

	previousPage, err := queries.ListPublishedEpisodeCommentsByCreatedAtAsc(ctx, dbmodels.ListPublishedEpisodeCommentsByCreatedAtAscParams{
		TenantID:        seed.tenantID,
		EpisodeID:       seed.episodeID,
		CursorCreatedAt: sql.NullTime{Time: nextPage[0].CreatedAt, Valid: true},
		CursorID:        uuid.NullUUID{UUID: nextPage[0].ID, Valid: true},
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("previous page: %v", err)
	}
	// The ascending half returns the rows a handler reverses back into the
	// newest-first display order.
	if got := publishedAscCommentIDs(previousPage); !slices.Equal(got, ids[:2]) {
		t.Fatalf("previous page = %v, want %v", got, ids[:2])
	}

	inclusive, err := queries.ListPublishedEpisodeCommentsByCreatedAtDesc(ctx, dbmodels.ListPublishedEpisodeCommentsByCreatedAtDescParams{
		TenantID:        seed.tenantID,
		EpisodeID:       seed.episodeID,
		CursorCreatedAt: sql.NullTime{Time: firstPage[1].CreatedAt, Valid: true},
		CursorID:        uuid.NullUUID{UUID: firstPage[1].ID, Valid: true},
		CursorInclusive: true,
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("recovery page: %v", err)
	}
	if got := publishedCommentIDs(inclusive); !slices.Equal(got, ids[1:3]) {
		t.Fatalf("recovery page = %v, want the boundary row included %v", got, ids[1:3])
	}
}

func TestEpisodeCommentsRejectInconsistentTransitionColumns(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	seed := seedCommentTenant(t, ctx, pg.DB, "CHK")

	tests := []struct {
		name      string
		columns   string
		values    string
		wantCheck string
	}{
		{
			name:      "unknown status",
			columns:   "status",
			values:    "'deleted'",
			wantCheck: "episode_comments_status_check",
		},
		{
			name:      "published without published_at",
			columns:   "status",
			values:    "'published'",
			wantCheck: "episode_comments_published_at_check",
		},
		{
			name:      "pending with published_at",
			columns:   "status, published_at",
			values:    "'pending', NOW()",
			wantCheck: "episode_comments_published_at_check",
		},
		{
			name:      "withdrawn without withdrawn_at",
			columns:   "status, published_at",
			values:    "'withdrawn', NOW()",
			wantCheck: "episode_comments_withdrawn_at_check",
		},
		{
			name:      "published with a withdrawn_at",
			columns:   "status, published_at, withdrawn_at",
			values:    "'published', NOW(), NOW()",
			wantCheck: "episode_comments_withdrawn_at_check",
		},
		{
			name:      "hidden without a reason",
			columns:   "status, published_at, hidden_at",
			values:    "'hidden', NOW(), NOW()",
			wantCheck: "episode_comments_hidden_at_check",
		},
		{
			name:      "published carrying a removal",
			columns:   "status, published_at, hidden_at, hidden_reason",
			values:    "'published', NOW(), NOW(), 'staff'",
			wantCheck: "episode_comments_hidden_at_check",
		},
		{
			name:      "unknown removal reason",
			columns:   "status, published_at, hidden_at, hidden_reason",
			values:    "'hidden', NOW(), NOW(), 'spam'",
			wantCheck: "episode_comments_hidden_reason_check",
		},
		{
			name:      "automatic removal naming a staff actor",
			columns:   "status, published_at, hidden_at, hidden_reason, hidden_by",
			values:    "'hidden', NOW(), NOW(), 'auto_reports', $6",
			wantCheck: "episode_comments_hidden_reason_check",
		},
	}

	for index, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			args := []any{uuid.Must(uuid.NewV7()), seed.tenantID, "CHKROW" + string(rune('A'+index)) + "00000", seed.episodeID, seed.userID}
			if strings.Contains(tc.values, "$6") {
				args = append(args, seed.staffID)
			}
			_, err := pg.DB.ExecContext(ctx, `
				INSERT INTO episode_comments (id, tenant_id, public_id, episode_id, user_id, body, `+tc.columns+`)
				VALUES ($1, $2, $3, $4, $5, 'body', `+tc.values+`)
			`, args...)
			if !isCheckViolation(err) || checkName(err) != tc.wantCheck {
				t.Fatalf("error = %v (%s), want %s", err, checkName(err), tc.wantCheck)
			}
		})
	}
}

// episode_comments_tenant_isolation, exercised through the RLS-bound admin role
// rather than the owning superuser the other tests use.
func TestEpisodeCommentsEnforceTenantIsolation(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	a := seedCommentTenant(t, ctx, pg.DB, "RLA")
	b := seedCommentTenant(t, ctx, pg.DB, "RLB")
	queries := dbmodels.New(pg.DB)
	mustCreateComment(t, ctx, queries, a, "published", "RLAPUBLIC001")
	mustCreateComment(t, ctx, queries, b, "published", "RLBPUBLIC002")

	withAdminTenant(t, pg, a.tenantID, func(ctx context.Context, conn *sql.Conn) {
		visible := commentPublicIDsOnConn(t, ctx, conn)
		if !slices.Equal(visible, []string{"RLAPUBLIC001"}) {
			t.Fatalf("visible comments = %v, want only this tenant's RLAPUBLIC001", visible)
		}

		// The policy's WITH CHECK half: a write naming another tenant is refused
		// rather than silently landing outside the reader's own rows.
		_, err := conn.ExecContext(ctx, `
			INSERT INTO episode_comments (id, tenant_id, public_id, episode_id, user_id, body, status, published_at)
			VALUES ($1, $2, 'RLAXTENANT01', $3, $4, 'body', 'published', NOW())
		`, uuid.Must(uuid.NewV7()), b.tenantID, b.episodeID, b.userID)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
			t.Fatalf("insert for another tenant error = %v, want SQLSTATE 42501", err)
		}
	})

	withAdminTenant(t, pg, b.tenantID, func(ctx context.Context, conn *sql.Conn) {
		visible := commentPublicIDsOnConn(t, ctx, conn)
		if !slices.Equal(visible, []string{"RLBPUBLIC002"}) {
			t.Fatalf("visible comments = %v, want only this tenant's RLBPUBLIC002", visible)
		}
	})
}

func TestTenantConfigCommentModeDefaultsToDisabled(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "CMTMODETN01", "cmt-mode.example.com", "admin-cmt-mode.example.com", "Comment Mode Tenant")
	queries := dbmodels.New(pg.DB)
	config, err := queries.CreateTenantConfig(ctx, dbmodels.CreateTenantConfigParams{TenantID: tenantID})
	if err != nil {
		t.Fatalf("create tenant config: %v", err)
	}
	if config.CommentMode != "disabled" {
		t.Fatalf("comment_mode = %s, want disabled so a tenant opts in deliberately", config.CommentMode)
	}

	for _, mode := range []string{"immediate", "approval_required", "disabled"} {
		if _, err := pg.DB.ExecContext(ctx, `UPDATE tenant_config SET comment_mode = $2 WHERE tenant_id = $1`, tenantID, mode); err != nil {
			t.Fatalf("set comment_mode %s: %v", mode, err)
		}
	}

	_, err = pg.DB.ExecContext(ctx, `UPDATE tenant_config SET comment_mode = 'members_only' WHERE tenant_id = $1`, tenantID)
	if !isCheckViolation(err) || checkName(err) != "tenant_config_comment_mode_check" {
		t.Fatalf("unknown comment_mode error = %v (%s), want tenant_config_comment_mode_check", err, checkName(err))
	}
}

type commentSeed struct {
	tenantID     uuid.UUID
	episodeID    uuid.UUID
	userID       uuid.UUID
	userPublicID string
	staffID      uuid.UUID
}

// seedCommentTenant builds a tenant with one episode, the reader who comments on
// it, and the staff account that moderates. prefix keeps the globally unique
// public IDs of one test apart from another's.
func seedCommentTenant(t *testing.T, ctx context.Context, db *sql.DB, prefix string) *commentSeed {
	t.Helper()
	tenantID := mustInsertTenant(t, ctx, db,
		prefix+"TENANT001",
		strings.ToLower(prefix)+".example.com",
		"admin-"+strings.ToLower(prefix)+".example.com",
		prefix+" Tenant",
	)
	userPublicID := prefix + "READER001"
	return &commentSeed{
		tenantID:     tenantID,
		episodeID:    mustInsertEpisode(t, ctx, db, tenantID, prefix+"EPISODE01", prefix+" Episode"),
		userID:       mustInsertUser(t, ctx, db, tenantID, userPublicID, strings.ToLower(prefix)+"-reader@example.com", "Comment Reader"),
		userPublicID: userPublicID,
		staffID:      mustInsertUser(t, ctx, db, tenantID, prefix+"STAFF0001", strings.ToLower(prefix)+"-staff@example.com", "Comment Staff"),
	}
}

func newPublishedCommentParams(tenantID, episodeID, userID uuid.UUID, publicID string) dbmodels.CreateEpisodeCommentParams {
	return dbmodels.CreateEpisodeCommentParams{
		ID:          uuid.Must(uuid.NewV7()),
		TenantID:    tenantID,
		PublicID:    publicID,
		EpisodeID:   episodeID,
		UserID:      userID,
		Body:        "A comment.",
		Status:      "published",
		PublishedAt: sql.NullTime{Time: time.Now().UTC(), Valid: true},
	}
}

func mustCreateComment(t *testing.T, ctx context.Context, queries *dbmodels.Queries, seed *commentSeed, status, publicID string) dbmodels.EpisodeComment {
	t.Helper()
	params := newPublishedCommentParams(seed.tenantID, seed.episodeID, seed.userID, publicID)
	params.Status = status
	if status == "pending" {
		params.PublishedAt = sql.NullTime{}
	}
	comment, err := queries.CreateEpisodeComment(ctx, params)
	if err != nil {
		t.Fatalf("create %s comment %s: %v", status, publicID, err)
	}
	return comment
}

func mustInsertPublishedCommentAt(t *testing.T, ctx context.Context, db *sql.DB, seed *commentSeed, publicID string, createdAt time.Time) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	_, err := db.ExecContext(ctx, `
		INSERT INTO episode_comments (id, tenant_id, public_id, episode_id, user_id, body, status, created_at, updated_at, published_at)
		VALUES ($1, $2, $3, $4, $5, 'A comment.', 'published', $6, $6, $6)
	`, id, seed.tenantID, publicID, seed.episodeID, seed.userID, createdAt)
	if err != nil {
		t.Fatalf("insert published comment %s: %v", publicID, err)
	}
	return id
}

func mustInsertWithdrawnComment(t *testing.T, ctx context.Context, db *sql.DB, seed *commentSeed, publicID string, withdrawnAt time.Time) {
	t.Helper()
	_, err := db.ExecContext(ctx, `
		INSERT INTO episode_comments (id, tenant_id, public_id, episode_id, user_id, body, status, created_at, updated_at, published_at, withdrawn_at)
		VALUES ($1, $2, $3, $4, $5, 'A comment.', 'withdrawn', $6, $6, $6, $6)
	`, uuid.Must(uuid.NewV7()), seed.tenantID, publicID, seed.episodeID, seed.userID, withdrawnAt)
	if err != nil {
		t.Fatalf("insert withdrawn comment %s: %v", publicID, err)
	}
}

func commentPublicIDsInTenant(t *testing.T, ctx context.Context, db *sql.DB, tenantID uuid.UUID) []string {
	t.Helper()
	rows, err := db.QueryContext(ctx, `SELECT public_id FROM episode_comments WHERE tenant_id = $1 ORDER BY public_id`, tenantID)
	if err != nil {
		t.Fatalf("select remaining comments: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	var publicIDs []string
	for rows.Next() {
		var publicID string
		if err := rows.Scan(&publicID); err != nil {
			t.Fatalf("scan remaining comment: %v", err)
		}
		publicIDs = append(publicIDs, publicID)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate remaining comments: %v", err)
	}
	return publicIDs
}

func publishedCommentIDs(rows []dbmodels.ListPublishedEpisodeCommentsByCreatedAtDescRow) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	return ids
}

func publishedAscCommentIDs(rows []dbmodels.ListPublishedEpisodeCommentsByCreatedAtAscRow) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(rows))
	for index := len(rows) - 1; index >= 0; index-- {
		ids = append(ids, rows[index].ID)
	}
	return ids
}

func publishedCommentPublicIDs(rows []dbmodels.ListPublishedEpisodeCommentsByCreatedAtDescRow) []string {
	publicIDs := make([]string, 0, len(rows))
	for _, row := range rows {
		publicIDs = append(publicIDs, row.PublicID)
	}
	return publicIDs
}

func userCommentPublicIDs(rows []dbmodels.ListUserPendingOrHiddenEpisodeCommentsByCreatedAtDescRow) []string {
	publicIDs := make([]string, 0, len(rows))
	for _, row := range rows {
		publicIDs = append(publicIDs, row.PublicID)
	}
	return publicIDs
}

func commentPublicIDsOnConn(t *testing.T, ctx context.Context, conn *sql.Conn) []string {
	t.Helper()
	rows, err := conn.QueryContext(ctx, `SELECT public_id FROM episode_comments ORDER BY public_id`)
	if err != nil {
		t.Fatalf("select visible comments: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	var publicIDs []string
	for rows.Next() {
		var publicID string
		if err := rows.Scan(&publicID); err != nil {
			t.Fatalf("scan visible comment: %v", err)
		}
		publicIDs = append(publicIDs, publicID)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate visible comments: %v", err)
	}
	return publicIDs
}
