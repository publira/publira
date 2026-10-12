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

// A consent row is the record of what a reader agreed to, so the version it
// names cannot be deleted out from under it. Deleting the reader or the whole
// tenant takes the record with it.
func TestUserPageConsentsKeepTheAgreedVersion(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	reader := pg.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "reader@tenant-a.example.com", "Reader")
	leaving := pg.SeedEndUser(t, tenant.ID, "ENDUSERA0002", "leaving@tenant-a.example.com", "Leaving")
	terms := pg.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "tos", Title: "Terms of Service", Published: true})
	for _, userID := range []any{reader.ID, leaving.ID} {
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO user_page_consents (tenant_id, user_id, page_version_id) VALUES ($1, $2, $3)
		`, tenant.ID, userID, terms.VersionID); err != nil {
			t.Fatalf("record consent: %v", err)
		}
	}

	if _, err := pg.DB.ExecContext(ctx, `DELETE FROM pages WHERE id = $1`, terms.ID); !isForeignKeyViolation(err) {
		t.Fatalf("delete an agreed page error = %v, want foreign_key_violation (23503)", err)
	}

	if _, err := pg.DB.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, leaving.ID); err != nil {
		t.Fatalf("delete a reader who agreed: %v", err)
	}
	var remaining int
	if err := pg.DB.QueryRowContext(ctx, `SELECT count(*) FROM user_page_consents`).Scan(&remaining); err != nil {
		t.Fatalf("count consents: %v", err)
	}
	if remaining != 1 {
		t.Fatalf("consents after deleting one reader = %d, want 1", remaining)
	}

	if _, err := pg.DB.ExecContext(ctx, `DELETE FROM tenants WHERE id = $1`, tenant.ID); err != nil {
		t.Fatalf("delete the tenant: %v", err)
	}
	if err := pg.DB.QueryRowContext(ctx, `SELECT count(*) FROM user_page_consents`).Scan(&remaining); err != nil {
		t.Fatalf("count consents: %v", err)
	}
	if remaining != 0 {
		t.Fatalf("consents after deleting the tenant = %d, want 0", remaining)
	}
}

// A reader has agreed to a page as far as its tenant asks when they agreed to a
// version published at or after the last request in that version's own
// translation, and every reader has while no publication has asked at all.
func TestReaderHasAgreedToPageFollowsTheLastRequestInEachTranslation(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	now := time.Now().UTC().Truncate(time.Microsecond)
	terms := pg.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "tos", Title: "Terms of Service", Published: true, PublishedAt: now.Add(-time.Hour)})
	other := "en"
	if tenant.DefaultLocale == "en" {
		other = "ja"
	}
	translated := pg.SeedPageTranslation(t, tenant.ID, terms.ID, testutil.PageTranslationSeed{Locale: other, Title: "Terms", Published: true, PublishedAt: now.Add(-time.Hour)})

	var number int32 = 1
	// publish adds a version to the default-locale translation and makes it the
	// live one, published at the given time and asking for agreement when
	// requireAgreement is set.
	publish := func(at time.Time, requireAgreement bool) uuid.UUID {
		t.Helper()
		number++
		id := uuid.Must(uuid.NewV7())
		requiredAt := sql.NullTime{}
		if requireAgreement {
			requiredAt = sql.NullTime{Time: at, Valid: true}
		}
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO page_versions (id, page_id, translation_id, tenant_id, version_number, content_markdown, status, published_at, agreement_required_at)
			VALUES ($1, $2, $3, $4, $5, 'Revised terms.', 'published', $6, $7)
		`, id, terms.ID, terms.TranslationID, tenant.ID, number, at, requiredAt); err != nil {
			t.Fatalf("insert version %d: %v", number, err)
		}
		if _, err := pg.DB.ExecContext(ctx, `UPDATE page_translations SET published_version_id = $1 WHERE id = $2`, id, terms.TranslationID); err != nil {
			t.Fatalf("publish version %d: %v", number, err)
		}
		return id
	}
	readers := 0
	reader := func(agreedVersionIDs ...uuid.UUID) uuid.UUID {
		t.Helper()
		readers++
		publicID := fmt.Sprintf("ENDUSERA%04d", readers)
		user := pg.SeedEndUser(t, tenant.ID, publicID, strings.ToLower(publicID)+"@tenant-a.example.com", "Reader")
		for _, versionID := range agreedVersionIDs {
			if _, err := pg.DB.ExecContext(ctx, `
				INSERT INTO user_page_consents (tenant_id, user_id, page_version_id) VALUES ($1, $2, $3)
			`, tenant.ID, user.ID, versionID); err != nil {
				t.Fatalf("record consent: %v", err)
			}
		}
		return user.ID
	}
	assertAgreed := func(name string, userID uuid.UUID, want bool) {
		t.Helper()
		var agreed bool
		if err := pg.DB.QueryRowContext(ctx, `SELECT reader_has_agreed_to_page($1, $2)`, userID, terms.ID).Scan(&agreed); err != nil {
			t.Fatalf("reader_has_agreed_to_page for %s: %v", name, err)
		}
		if agreed != want {
			t.Fatalf("reader_has_agreed_to_page for %s = %v, want %v", name, agreed, want)
		}
	}

	original := reader(terms.VersionID)
	inOtherLocale := reader(translated.VersionID)
	neverAgreed := reader()
	assertAgreed("a reader before any request", original, true)
	assertAgreed("a reader who never agreed, before any request", neverAgreed, true)

	revised := publish(now.Add(-30*time.Minute), true)
	assertAgreed("a reader who agreed to the text the request replaced", original, false)
	assertAgreed("a reader who never agreed", neverAgreed, false)
	assertAgreed("a reader who agreed to a translation the request left alone", inOtherLocale, true)

	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO user_page_consents (tenant_id, user_id, page_version_id) VALUES ($1, $2, $3)
	`, tenant.ID, original, revised); err != nil {
		t.Fatalf("record consent to the revision: %v", err)
	}
	assertAgreed("a reader who agreed to the revision", original, true)

	corrected := publish(now.Add(-20*time.Minute), false)
	assertAgreed("a reader who agreed to the revision a correction followed", original, true)
	assertAgreed("a reader who agreed to the correction", reader(corrected), true)

	stale := reader(terms.VersionID)
	assertAgreed("a reader who agreed to a version superseded before the request", stale, false)

	if _, err := pg.DB.ExecContext(ctx, `
		UPDATE page_versions SET published_at = $1 WHERE id = $2
	`, now.Add(-10*time.Minute), terms.VersionID); err != nil {
		t.Fatalf("republish the first version: %v", err)
	}
	assertAgreed("a reader who agreed to a version republished after the request", stale, true)
}

// Only a publication asks readers to agree, so a draft cannot carry a request.
func TestPageVersionAgreementRequestNeedsAPublication(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	draft := pg.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "tos", Title: "Terms of Service"})
	_, err := pg.DB.ExecContext(ctx, `UPDATE page_versions SET agreement_required_at = now() WHERE id = $1`, draft.VersionID)
	if !isCheckViolation(err) {
		t.Fatalf("request agreement to a draft error = %v, want check_violation (23514)", err)
	}
}
