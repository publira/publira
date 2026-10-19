package adminapi

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect/v2"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func genreTranslationNames(translations []*publirattypesv1.GenreTranslation) []string {
	names := make([]string, 0, len(translations))
	for _, translation := range translations {
		names = append(names, translation.Locale+":"+translation.Name)
	}
	return names
}

// A name written in another locale is added beside the default locale's, and
// the console reads the genre by the default locale's name and slug whichever
// locale was written last.
func TestDBGenreNamesAreWrittenPerLocale(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.genreClient()
	ctx := testutil.WithBearer(context.Background(), tenant.token())

	genre := createGenre(t, client, tenant, "Kaiki")
	updated, err := client.UpdateGenre(ctx, &publiraadminv1.UpdateGenreRequest{
		Tenant:  tenant.tenantContext(),
		GenreId: genre.Id,
		Locale:  "en",
		Name:    "Horror",
	})
	if err != nil {
		t.Fatalf("UpdateGenre en: %v", err)
	}
	if updated.Genre.Name != "Kaiki" || updated.Genre.Slug != "kaiki" {
		t.Fatalf("genre after an en save = (%q, %q), want the ja name and its slug", updated.Genre.Name, updated.Genre.Slug)
	}
	if got := genreTranslationNames(updated.Genre.Translations); !slices.Equal(got, []string{"ja:Kaiki", "en:Horror"}) {
		t.Fatalf("translations = %v, want ja then en", got)
	}
	if listed := listGenres(t, client, tenant); len(listed) != 1 || listed[0].Name != "Kaiki" || len(listed[0].Translations) != 2 {
		t.Fatalf("ListGenres = %v, want the genre named in ja carrying both names", listed)
	}

	// Renaming in the default locale moves the slug with it.
	renamed, err := client.UpdateGenre(ctx, &publiraadminv1.UpdateGenreRequest{
		Tenant:  tenant.tenantContext(),
		GenreId: genre.Id,
		Name:    "Kaidan",
	})
	if err != nil {
		t.Fatalf("UpdateGenre default locale: %v", err)
	}
	if renamed.Genre.Name != "Kaidan" || renamed.Genre.Slug != "kaidan" {
		t.Fatalf("genre after a ja save = (%q, %q), want (Kaidan, kaidan)", renamed.Genre.Name, renamed.Genre.Slug)
	}
	if got := genreTranslationNames(renamed.Genre.Translations); !slices.Equal(got, []string{"ja:Kaidan", "en:Horror"}) {
		t.Fatalf("translations = %v, want the ja name replaced and the en one kept", got)
	}
}

// A genre is created in the locale the request names, and the slug comes from
// that name while it is the only one.
func TestDBCreateGenreInAnotherLocale(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.genreClient()

	created, err := client.CreateGenre(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateGenreRequest{
		Tenant: tenant.tenantContext(),
		Locale: "en",
		Name:   "Horror",
	})
	if err != nil {
		t.Fatalf("CreateGenre en: %v", err)
	}
	if created.Genre.Name != "Horror" || created.Genre.Slug != "horror" {
		t.Fatalf("genre = (%q, %q), want (Horror, horror)", created.Genre.Name, created.Genre.Slug)
	}
	if got := genreTranslationNames(created.Genre.Translations); !slices.Equal(got, []string{"en:Horror"}) {
		t.Fatalf("translations = %v, want the one en name", got)
	}
}

// A name is written only in a language the site offers: one switched off, or
// one the registry does not know, is refused rather than stored out of sight.
func TestDBGenreNameIsRefusedInALocaleTheTenantDoesNotOffer(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	if _, err := env.PG.DB.ExecContext(context.Background(), `UPDATE tenants SET supported_locales = '{ja,en}' WHERE id = $1`, tenant.Tenant.ID); err != nil {
		t.Fatalf("narrow the offered locales: %v", err)
	}
	client := env.genreClient()
	ctx := testutil.WithBearer(context.Background(), tenant.token())

	genre := createGenre(t, client, tenant, "Kaiki")
	for _, locale := range []string{"ko", "fr"} {
		_, err := client.CreateGenre(ctx, &publiraadminv1.CreateGenreRequest{
			Tenant: tenant.tenantContext(),
			Locale: locale,
			Name:   "Romance",
		})
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("CreateGenre in %s: code = %v, want invalid_argument (err=%v)", locale, connect.CodeOf(err), err)
		}
		_, err = client.UpdateGenre(ctx, &publiraadminv1.UpdateGenreRequest{
			Tenant:  tenant.tenantContext(),
			GenreId: genre.Id,
			Locale:  locale,
			Name:    "Horror",
		})
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("UpdateGenre in %s: code = %v, want invalid_argument (err=%v)", locale, connect.CodeOf(err), err)
		}
	}
	if count := env.countRows(t, "SELECT count(*) FROM genres WHERE tenant_id = $1", tenant.Tenant.ID); count != 1 {
		t.Fatalf("genres stored = %d, want only the ja one", count)
	}
	if count := env.countRows(t, "SELECT count(*) FROM genre_translations WHERE tenant_id = $1", tenant.Tenant.ID); count != 1 {
		t.Fatalf("genre names stored = %d, want only the ja one", count)
	}
}

// A genre keeps at least one name, and deleting one leaves the slug where it
// is, even when the deleted name is the one it was derived from.
func TestDBDeleteGenreTranslation(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.genreClient()
	ctx := testutil.WithBearer(context.Background(), tenant.token())

	genre := createGenre(t, client, tenant, "Kaiki")
	if _, err := client.UpdateGenre(ctx, &publiraadminv1.UpdateGenreRequest{
		Tenant:  tenant.tenantContext(),
		GenreId: genre.Id,
		Locale:  "en",
		Name:    "Horror",
	}); err != nil {
		t.Fatalf("UpdateGenre en: %v", err)
	}

	left, err := client.DeleteGenreTranslation(ctx, &publiraadminv1.DeleteGenreTranslationRequest{
		Tenant:  tenant.tenantContext(),
		GenreId: genre.Id,
		Locale:  "ja",
	})
	if err != nil {
		t.Fatalf("DeleteGenreTranslation ja: %v", err)
	}
	if left.Genre.Name != "Horror" || left.Genre.Slug != "kaiki" {
		t.Fatalf("genre after deleting its ja name = (%q, %q), want the en name and the slug it had", left.Genre.Name, left.Genre.Slug)
	}
	if got := genreTranslationNames(left.Genre.Translations); !slices.Equal(got, []string{"en:Horror"}) {
		t.Fatalf("translations = %v, want the en one left", got)
	}

	_, err = client.DeleteGenreTranslation(ctx, &publiraadminv1.DeleteGenreTranslationRequest{
		Tenant:  tenant.tenantContext(),
		GenreId: genre.Id,
		Locale:  "en",
	})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("DeleteGenreTranslation of the last one: code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
	_, err = client.DeleteGenreTranslation(ctx, &publiraadminv1.DeleteGenreTranslationRequest{
		Tenant:  tenant.tenantContext(),
		GenreId: genre.Id,
		Locale:  "ko",
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeleteGenreTranslation of a missing locale: code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	if count := env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'genre_translation_deleted' AND target_id = $2",
		tenant.Tenant.ID, genre.PublicId,
	); count != 1 {
		t.Fatalf("audit entries for genre_translation_deleted = %d, want 1", count)
	}
}

// A change of default locale moves no slug, so a genre whose name in the new
// default derives a slug another genre still holds saves as long as the save
// leaves that name alone. Renaming it in the new default re-derives the slug
// as any rename does.
func TestDBGenreSavesAfterTheDefaultLocaleChanges(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.genreClient()
	ctx := testutil.WithBearer(context.Background(), tenant.token())

	write := func(genreID, locale, name string) (*publirattypesv1.Genre, error) {
		t.Helper()
		updated, err := client.UpdateGenre(ctx, &publiraadminv1.UpdateGenreRequest{
			Tenant:  tenant.tenantContext(),
			GenreId: genreID,
			Locale:  locale,
			Name:    name,
		})
		if err != nil {
			return nil, err
		}
		return updated.Genre, nil
	}
	fantasy := createGenre(t, client, tenant, "Fantasy")
	if _, err := write(fantasy.Id, "en", "Horror"); err != nil {
		t.Fatalf("UpdateGenre en: %v", err)
	}
	horror := createGenre(t, client, tenant, "Horror")
	if _, err := write(horror.Id, "en", "Mystery"); err != nil {
		t.Fatalf("UpdateGenre en of the second genre: %v", err)
	}

	if _, err := env.PG.DB.ExecContext(context.Background(), `UPDATE tenants SET default_locale = 'en' WHERE id = $1`, tenant.Tenant.ID); err != nil {
		t.Fatalf("switch the default locale: %v", err)
	}

	saved, err := write(fantasy.Id, "en", "Horror")
	if err != nil {
		t.Fatalf("an unchanged save after the default locale changed: %v", err)
	}
	if saved.Name != "Horror" || saved.Slug != "fantasy" {
		t.Fatalf("genre after an unchanged save = (%q, %q), want (Horror, fantasy)", saved.Name, saved.Slug)
	}
	if _, err := write(fantasy.Id, "ja", "Gensou"); err != nil {
		t.Fatalf("a save in a locale other than the default: %v", err)
	}

	renamed, err := write(horror.Id, "en", "Suspense")
	if err != nil {
		t.Fatalf("a rename in the new default locale: %v", err)
	}
	if renamed.Slug != "suspense" {
		t.Fatalf("slug after a rename in the new default locale = %q, want suspense", renamed.Slug)
	}
}

// A genre of another tenant is out of reach of a deletion, as it is of every
// other genre write.
func TestDBDeleteGenreTranslationOfAnotherTenantIsNotFound(t *testing.T) {
	env := newAdminDBEnv(t)
	first := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	second := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBUSER01", "admin@tenant-b.example.com")
	client := env.genreClient()

	theirs := createGenre(t, client, second, "Kaiki")
	if _, err := client.UpdateGenre(testutil.WithBearer(context.Background(), second.token()), &publiraadminv1.UpdateGenreRequest{
		Tenant:  second.tenantContext(),
		GenreId: theirs.Id,
		Locale:  "en",
		Name:    "Horror",
	}); err != nil {
		t.Fatalf("UpdateGenre en: %v", err)
	}

	_, err := client.DeleteGenreTranslation(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.DeleteGenreTranslationRequest{
		Tenant:  first.tenantContext(),
		GenreId: theirs.Id,
		Locale:  "en",
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeleteGenreTranslation across tenants: code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM genre_translations WHERE genre_id = $1", theirs.Id); count != 2 {
		t.Fatalf("names of the other tenant's genre = %d, want both kept", count)
	}
}
