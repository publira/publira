package dbtest

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// A foreign key that names only the parent's id proves the parent row exists
// and nothing more. The tenant isolation policies check the writing row's own
// tenant_id, and referential integrity checks are not subject to row-level
// security, so a single-column reference to a tenant-scoped parent is a hole
// the policies cannot see: a session scoped to one tenant can write a row
// carrying its own tenant_id while pointing at a row owned by another.
//
// The catalog is read rather than a list of the references being repeated here,
// because a table added after this test was written is the case it would
// otherwise miss.
func TestEveryTenantScopedForeignKeyNamesTenantID(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	rows, err := pg.DB.QueryContext(ctx, `
		SELECT con.conrelid::regclass::text, con.conname, con.confrelid::regclass::text
		FROM pg_constraint con
		WHERE con.contype = 'f'
			AND con.connamespace = 'public'::regnamespace
			-- The parent is tenant-scoped.
			AND EXISTS (
				SELECT 1 FROM pg_attribute pa
				WHERE pa.attrelid = con.confrelid AND pa.attname = 'tenant_id'
					AND pa.attnum > 0 AND NOT pa.attisdropped
			)
			-- The child carries a tenant_id the reference could have named.
			AND EXISTS (
				SELECT 1 FROM pg_attribute ca
				WHERE ca.attrelid = con.conrelid AND ca.attname = 'tenant_id'
					AND ca.attnum > 0 AND NOT ca.attisdropped
			)
			-- And it does not point the one at the other. The two sides are
			-- paired by position, because naming tenant_id on the child while
			-- matching it against some other column of the parent would leave
			-- the same hole open.
			AND NOT EXISTS (
				SELECT 1
				FROM generate_subscripts(con.conkey, 1) AS pos(i)
				JOIN pg_attribute ca
					ON ca.attrelid = con.conrelid AND ca.attnum = con.conkey[pos.i]
				JOIN pg_attribute pa
					ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[pos.i]
				WHERE ca.attname = 'tenant_id' AND pa.attname = 'tenant_id'
			)
		ORDER BY 1, 2
	`)
	if err != nil {
		t.Fatalf("list the references to tenant-scoped parents: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	var offenders []string
	for rows.Next() {
		var child, constraint, parent string
		if err := rows.Scan(&child, &constraint, &parent); err != nil {
			t.Fatalf("scan a reference: %v", err)
		}
		offenders = append(offenders, fmt.Sprintf("%s.%s -> %s", child, constraint, parent))
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read the references: %v", err)
	}
	if len(offenders) > 0 {
		t.Fatalf("references to a tenant-scoped parent that do not name tenant_id:\n\t%s", strings.Join(offenders, "\n\t"))
	}
}

// Every reference the sweep converted, exercised from the outside: a statement
// pairing one tenant's tenant_id with another tenant's parent row is refused,
// and refused by the constraint that is supposed to catch it rather than by
// some other rule that happens to fire first.
func TestCrossTenantParentReferencesAreRejected(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// Superuser bypasses RLS; the declarative integrity is what is under test.
	db := pg.DB
	first := seedForeignKeyTenant(t, ctx, db, "FKA")
	second := seedForeignKeyTenant(t, ctx, db, "FKB")

	cases := []struct {
		name       string
		constraint string
		statement  string
		args       []any
	}{
		{
			name:       "tenant_image_variants.tenant_image_id",
			constraint: "tenant_image_variants_tenant_tenant_image_id_fkey",
			statement: `INSERT INTO tenant_image_variants
				(id, tenant_id, tenant_image_id, label, variant_type, storage_provider, object_key, content_type, file_size_bytes, width, height)
				VALUES ($1, $2, $3, 'logo-1x', 'logo', 's3', 'tenants/logo.webp', 'image/webp', 1, 320, 320)`,
			args: []any{mustUUID(t), first.tenantID, second.tenantImageID},
		},
		{
			name:       "tenant_themes.logo_image_id",
			constraint: "tenant_themes_tenant_logo_image_id_fkey",
			statement:  `UPDATE tenant_themes SET logo_image_id = $2 WHERE tenant_id = $1`,
			args:       []any{first.tenantID, second.tenantImageID},
		},
		{
			name:       "tenant_themes.icon_image_id",
			constraint: "tenant_themes_tenant_icon_image_id_fkey",
			statement:  `UPDATE tenant_themes SET icon_image_id = $2 WHERE tenant_id = $1`,
			args:       []any{first.tenantID, second.tenantImageID},
		},
		{
			name:       "label_images.label_id",
			constraint: "label_images_tenant_label_id_fkey",
			statement:  `INSERT INTO label_images (id, tenant_id, label_id) VALUES ($1, $2, $3)`,
			args:       []any{mustUUID(t), first.tenantID, second.labelID},
		},
		{
			name:       "label_image_variants.label_image_id",
			constraint: "label_image_variants_tenant_label_image_id_fkey",
			statement: `INSERT INTO label_image_variants
				(id, tenant_id, label_image_id, label, variant_type, storage_provider, object_key, content_type, file_size_bytes, width, height)
				VALUES ($1, $2, $3, 'portrait-320', 'portrait', 's3', 'tenants/label.webp', 'image/webp', 1, 320, 480)`,
			args: []any{mustUUID(t), first.tenantID, second.labelImageID},
		},
		{
			name:       "labels.eye_catch_image_id",
			constraint: "labels_tenant_eye_catch_image_id_fkey",
			statement:  `UPDATE labels SET eye_catch_image_id = $2 WHERE id = $1`,
			args:       []any{first.labelID, second.labelImageID},
		},
		{
			name:       "creators.icon_image_id",
			constraint: "creators_tenant_icon_image_id_fkey",
			statement:  `UPDATE creators SET icon_image_id = $2 WHERE id = $1`,
			args:       []any{first.creatorID, second.creatorImageID},
		},
		{
			name:       "creator_image_variants.creator_image_id",
			constraint: "creator_image_variants_tenant_creator_image_id_fkey",
			statement: `INSERT INTO creator_image_variants
				(id, tenant_id, creator_image_id, label, storage_provider, object_key, content_type, file_size_bytes, width, height)
				VALUES ($1, $2, $3, 'icon-320', 's3', 'tenants/creator.webp', 'image/webp', 1, 320, 320)`,
			args: []any{mustUUID(t), first.tenantID, second.creatorImageID},
		},
		{
			name:       "genre_images.genre_id",
			constraint: "genre_images_tenant_genre_id_fkey",
			statement:  `INSERT INTO genre_images (id, tenant_id, genre_id) VALUES ($1, $2, $3)`,
			args:       []any{mustUUID(t), first.tenantID, second.genreID},
		},
		{
			name:       "genre_image_variants.genre_image_id",
			constraint: "genre_image_variants_tenant_genre_image_id_fkey",
			statement: `INSERT INTO genre_image_variants
				(id, tenant_id, genre_image_id, label, variant_type, storage_provider, object_key, content_type, file_size_bytes, width, height)
				VALUES ($1, $2, $3, 'portrait-320', 'portrait', 's3', 'tenants/genre.webp', 'image/webp', 1, 320, 480)`,
			args: []any{mustUUID(t), first.tenantID, second.genreImageID},
		},
		{
			name:       "genres.eye_catch_image_id",
			constraint: "genres_tenant_eye_catch_image_id_fkey",
			statement:  `UPDATE genres SET eye_catch_image_id = $2 WHERE id = $1`,
			args:       []any{first.genreID, second.genreImageID},
		},
		{
			name:       "series.label_id",
			constraint: "series_tenant_label_id_fkey",
			statement:  `UPDATE series SET label_id = $2 WHERE id = $1`,
			args:       []any{first.seriesID, second.labelID},
		},
		{
			name:       "series.eye_catch_image_id",
			constraint: "series_tenant_eye_catch_image_id_fkey",
			statement:  `UPDATE series SET eye_catch_image_id = $2 WHERE id = $1`,
			args:       []any{first.seriesID, second.seriesImageID},
		},
		{
			name:       "series_image_variants.series_image_id",
			constraint: "series_image_variants_tenant_series_image_id_fkey",
			statement: `INSERT INTO series_image_variants
				(id, tenant_id, series_image_id, label, variant_type, storage_provider, object_key, content_type, file_size_bytes, width, height)
				VALUES ($1, $2, $3, 'portrait-320', 'portrait', 's3', 'tenants/series.webp', 'image/webp', 1, 320, 480)`,
			args: []any{mustUUID(t), first.tenantID, second.seriesImageID},
		},
		{
			name:       "episode_image_variants.episode_image_id",
			constraint: "episode_image_variants_tenant_episode_image_id_fkey",
			statement: `INSERT INTO episode_image_variants
				(id, tenant_id, episode_image_id, label, storage_provider, object_key, content_type, file_size_bytes, width, height)
				VALUES ($1, $2, $3, 'page-1600', 's3', 'tenants/page.webp', 'image/webp', 1, 1600, 2400)`,
			args: []any{mustUUID(t), first.tenantID, second.episodeImageID},
		},
		{
			name:       "page_versions.page_id",
			constraint: "page_versions_tenant_page_id_fkey",
			statement:  `INSERT INTO page_versions (id, tenant_id, page_id, version_number) VALUES ($1, $2, $3, 2)`,
			args:       []any{mustUUID(t), first.tenantID, second.pageID},
		},
		{
			name:       "pages.published_version_id",
			constraint: "pages_tenant_published_version_id_fkey",
			statement:  `UPDATE pages SET published_version_id = $2 WHERE id = $1`,
			args:       []any{first.pageID, second.pageVersionID},
		},
		{
			name:       "notification_reads.notification_id",
			constraint: "notification_reads_tenant_notification_id_fkey",
			statement:  `INSERT INTO notification_reads (notification_id, user_id, tenant_id) VALUES ($1, $2, $3)`,
			args:       []any{second.notificationID, first.userID, first.tenantID},
		},
		{
			name:       "announcement_reads.announcement_id",
			constraint: "announcement_reads_tenant_announcement_id_fkey",
			statement:  `INSERT INTO announcement_reads (announcement_id, user_id, tenant_id) VALUES ($1, $2, $3)`,
			args:       []any{second.announcementID, first.userID, first.tenantID},
		},
		{
			name:       "access_tickets.created_by_user_id",
			constraint: "access_tickets_tenant_created_by_user_id_fkey",
			statement:  `UPDATE access_tickets SET created_by_user_id = $2 WHERE id = $1`,
			args:       []any{first.accessTicketID, second.userID},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := db.ExecContext(ctx, tc.statement, tc.args...)
			if !isForeignKeyViolation(err) {
				t.Fatalf("cross-tenant %s error = %v, want foreign_key_violation", tc.name, err)
			}
			if !strings.Contains(err.Error(), tc.constraint) {
				t.Fatalf("cross-tenant %s error = %v, want %s", tc.name, err, tc.constraint)
			}
		})
	}
}

// A composite reference that deletes with SET NULL nulls every column it names
// unless it is told which one to null. tenant_id is NOT NULL on every child
// below, so the untold form would turn deleting an image into an error instead
// of clearing the row that elected it.
func TestDeletingAnElectedParentNullsOnlyTheReference(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	db := pg.DB
	seeded := seedForeignKeyTenant(t, ctx, db, "FKN")

	// The ticket's own user_id cascades, so the staff account that granted it
	// has to be somebody else for the SET NULL to be observable at all.
	staffID := mustInsertUser(t, ctx, db, seeded.tenantID, "FKNSTAFF001", "fkn-staff@example.com", "FKN Staff")
	mustExec(t, ctx, db, `UPDATE access_tickets SET created_by_user_id = $2 WHERE id = $1`, seeded.accessTicketID, staffID)
	mustExec(t, ctx, db, `UPDATE pages SET published_version_id = $2 WHERE id = $1`, seeded.pageID, seeded.pageVersionID)
	mustExec(t, ctx, db, `UPDATE tenant_themes SET logo_image_id = $2, icon_image_id = $2 WHERE tenant_id = $1`,
		seeded.tenantID, seeded.tenantImageID)
	mustExec(t, ctx, db, `UPDATE labels SET eye_catch_image_id = $2 WHERE id = $1`, seeded.labelID, seeded.labelImageID)
	mustExec(t, ctx, db, `UPDATE genres SET eye_catch_image_id = $2 WHERE id = $1`, seeded.genreID, seeded.genreImageID)
	mustExec(t, ctx, db, `UPDATE creators SET icon_image_id = $2 WHERE id = $1`, seeded.creatorID, seeded.creatorImageID)

	cases := []struct {
		name    string
		delete  string
		deleted uuid.UUID
		// survivor reads the child's tenant_id and its reference back, in that
		// order, so the test can say the row is still there and still its
		// tenant's.
		survivor string
		owner    uuid.UUID
	}{
		{
			name:     "tenant_themes.logo_image_id",
			delete:   `DELETE FROM tenant_images WHERE id = $1`,
			deleted:  seeded.tenantImageID,
			survivor: `SELECT tenant_id, logo_image_id FROM tenant_themes WHERE tenant_id = $1`,
			owner:    seeded.tenantID,
		},
		{
			name:     "creators.icon_image_id",
			delete:   `DELETE FROM creator_images WHERE id = $1`,
			deleted:  seeded.creatorImageID,
			survivor: `SELECT tenant_id, icon_image_id FROM creators WHERE id = $1`,
			owner:    seeded.creatorID,
		},
		{
			name:     "labels.eye_catch_image_id",
			delete:   `DELETE FROM label_images WHERE id = $1`,
			deleted:  seeded.labelImageID,
			survivor: `SELECT tenant_id, eye_catch_image_id FROM labels WHERE id = $1`,
			owner:    seeded.labelID,
		},
		{
			name:     "genres.eye_catch_image_id",
			delete:   `DELETE FROM genre_images WHERE id = $1`,
			deleted:  seeded.genreImageID,
			survivor: `SELECT tenant_id, eye_catch_image_id FROM genres WHERE id = $1`,
			owner:    seeded.genreID,
		},
		{
			name:     "series.eye_catch_image_id",
			delete:   `DELETE FROM series_images WHERE id = $1`,
			deleted:  seeded.seriesImageID,
			survivor: `SELECT tenant_id, eye_catch_image_id FROM series WHERE id = $1`,
			owner:    seeded.seriesID,
		},
		{
			name:     "pages.published_version_id",
			delete:   `DELETE FROM page_versions WHERE id = $1`,
			deleted:  seeded.pageVersionID,
			survivor: `SELECT tenant_id, published_version_id FROM pages WHERE id = $1`,
			owner:    seeded.pageID,
		},
		{
			name:     "access_tickets.created_by_user_id",
			delete:   `DELETE FROM users WHERE id = $1`,
			deleted:  staffID,
			survivor: `SELECT tenant_id, created_by_user_id FROM access_tickets WHERE id = $1`,
			owner:    seeded.accessTicketID,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := db.ExecContext(ctx, tc.delete, tc.deleted); err != nil {
				t.Fatalf("delete the parent of %s: %v", tc.name, err)
			}
			var tenantID uuid.UUID
			var reference uuid.NullUUID
			if err := db.QueryRowContext(ctx, tc.survivor, tc.owner).Scan(&tenantID, &reference); err != nil {
				t.Fatalf("read %s back: %v", tc.name, err)
			}
			if reference.Valid {
				t.Fatalf("%s = %v after its parent was deleted, want NULL", tc.name, reference.UUID)
			}
			if tenantID != seeded.tenantID {
				t.Fatalf("tenant_id of %s = %v, want %v", tc.name, tenantID, seeded.tenantID)
			}
		})
	}
}

// One tenant holding a row of every kind the cases above pair across tenants.
type foreignKeyTenant struct {
	tenantID       uuid.UUID
	userID         uuid.UUID
	seriesID       uuid.UUID
	seriesImageID  uuid.UUID
	episodeImageID uuid.UUID
	creatorID      uuid.UUID
	creatorImageID uuid.UUID
	labelID        uuid.UUID
	labelImageID   uuid.UUID
	genreID        uuid.UUID
	genreImageID   uuid.UUID
	tenantImageID  uuid.UUID
	pageID         uuid.UUID
	pageVersionID  uuid.UUID
	notificationID uuid.UUID
	announcementID uuid.UUID
	accessTicketID uuid.UUID
}

// seedForeignKeyTenant builds one whole tenant. prefix keeps the public ids
// apart, several of which are unique across tenants rather than within one.
func seedForeignKeyTenant(t *testing.T, ctx context.Context, db *sql.DB, prefix string) foreignKeyTenant {
	t.Helper()

	seeded := foreignKeyTenant{}
	seeded.tenantID = mustInsertTenant(t, ctx, db,
		prefix+"TENANT001", strings.ToLower(prefix)+".example.com", strings.ToLower(prefix)+"-admin.example.com", prefix+" Tenant")
	seeded.userID = mustInsertUser(t, ctx, db, seeded.tenantID,
		prefix+"USER00001", strings.ToLower(prefix)+"-reader@example.com", prefix+" Reader")

	episodeID := mustInsertEpisode(t, ctx, db, seeded.tenantID, prefix+"EPISODE01", prefix+" Episode")
	mustQueryRow(t, ctx, db, `SELECT series_id FROM episodes WHERE id = $1`, &seeded.seriesID, episodeID)
	seeded.seriesImageID = mustInsertSeriesImage(t, ctx, db, seeded.tenantID, seeded.seriesID)

	seeded.episodeImageID = mustUUID(t)
	mustExec(t, ctx, db, `INSERT INTO episode_images (id, tenant_id, episode_id) VALUES ($1, $2, $3)`,
		seeded.episodeImageID, seeded.tenantID, episodeID)

	seeded.creatorID = mustUUID(t)
	mustExec(t, ctx, db, `INSERT INTO creators (id, tenant_id, public_id, name) VALUES ($1, $2, $3, $4)`,
		seeded.creatorID, seeded.tenantID, prefix+"CREATOR01", prefix+" Creator")
	seeded.creatorImageID = mustUUID(t)
	mustExec(t, ctx, db, `INSERT INTO creator_images (id, tenant_id, creator_id) VALUES ($1, $2, $3)`,
		seeded.creatorImageID, seeded.tenantID, seeded.creatorID)

	seeded.labelID = mustUUID(t)
	mustExec(t, ctx, db, `INSERT INTO labels (id, tenant_id, public_id, name) VALUES ($1, $2, $3, $4)`,
		seeded.labelID, seeded.tenantID, prefix+"LABEL0001", prefix+" Label")
	seeded.labelImageID = mustUUID(t)
	mustExec(t, ctx, db, `INSERT INTO label_images (id, tenant_id, label_id) VALUES ($1, $2, $3)`,
		seeded.labelImageID, seeded.tenantID, seeded.labelID)

	seeded.genreID = mustUUID(t)
	mustExec(t, ctx, db, `INSERT INTO genres (id, tenant_id, public_id, name, slug) VALUES ($1, $2, $3, $4, $5)`,
		seeded.genreID, seeded.tenantID, prefix+"GENRE0001", prefix+" Genre", strings.ToLower(prefix)+"-genre")
	seeded.genreImageID = mustUUID(t)
	mustExec(t, ctx, db, `INSERT INTO genre_images (id, tenant_id, genre_id) VALUES ($1, $2, $3)`,
		seeded.genreImageID, seeded.tenantID, seeded.genreID)

	seeded.tenantImageID = mustUUID(t)
	mustExec(t, ctx, db, `INSERT INTO tenant_images (id, tenant_id) VALUES ($1, $2)`,
		seeded.tenantImageID, seeded.tenantID)
	mustExec(t, ctx, db, `INSERT INTO tenant_themes (tenant_id) VALUES ($1)`, seeded.tenantID)

	seeded.pageID = mustUUID(t)
	mustExec(t, ctx, db, `INSERT INTO pages (id, tenant_id, slug, title) VALUES ($1, $2, 'about', $3)`,
		seeded.pageID, seeded.tenantID, prefix+" About")
	seeded.pageVersionID = mustUUID(t)
	mustExec(t, ctx, db, `INSERT INTO page_versions (id, tenant_id, page_id, version_number) VALUES ($1, $2, $3, 1)`,
		seeded.pageVersionID, seeded.tenantID, seeded.pageID)

	seeded.notificationID = mustUUID(t)
	mustExec(t, ctx, db, `
		INSERT INTO notifications (id, tenant_id, user_id, notification_type, subject_key)
		VALUES ($1, $2, $3, 'episode_published', $4)`,
		seeded.notificationID, seeded.tenantID, seeded.userID, prefix+"-subject")

	seeded.announcementID = mustUUID(t)
	mustExec(t, ctx, db, `
		INSERT INTO announcements (id, tenant_id, announcement_type, title, body)
		VALUES ($1, $2, 'maintenance', $3, 'Body')`,
		seeded.announcementID, seeded.tenantID, prefix+" Announcement")

	seeded.accessTicketID = mustUUID(t)
	mustExec(t, ctx, db, `
		INSERT INTO access_tickets (id, tenant_id, public_id, episode_id, user_id, created_by_user_id)
		VALUES ($1, $2, $3, $4, $5, $5)`,
		seeded.accessTicketID, seeded.tenantID, prefix+"TICKET001", episodeID, seeded.userID)

	return seeded
}

func mustUUID(t *testing.T) uuid.UUID {
	t.Helper()
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("uuid: %v", err)
	}
	return id
}

func mustExec(t *testing.T, ctx context.Context, db *sql.DB, statement string, args ...any) {
	t.Helper()
	if _, err := db.ExecContext(ctx, statement, args...); err != nil {
		t.Fatalf("%s: %v", statement, err)
	}
}

func mustQueryRow(t *testing.T, ctx context.Context, db *sql.DB, statement string, dest any, args ...any) {
	t.Helper()
	if err := db.QueryRowContext(ctx, statement, args...).Scan(dest); err != nil {
		t.Fatalf("%s: %v", statement, err)
	}
}
