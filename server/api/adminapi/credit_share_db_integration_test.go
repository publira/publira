package adminapi

import (
	"context"
	"maps"
	"testing"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/creatorroles"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// seedEditor adds a tenant_editor to the tenant, signing the requests made as
// them.
func seedEditor(t *testing.T, env *adminDBEnv, tenant adminDBTenant) adminDBTenant {
	t.Helper()

	return tenant.as(env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TAEDITOR01", "editor@tenant-a.example.com", "Editor", auth.RoleTenantEditor))
}

// creditSharesByName reads what each credit of an episode, or of a series, is
// paid, by the name of the person credited. Every fixture here credits a
// person in one role, so the name is enough to tell the credits apart.
func creditSharesByName(t *testing.T, env *adminDBEnv, table, ownerColumn, ownerTable, publicID string) map[string]int32 {
	t.Helper()

	rows, err := env.PG.DB.QueryContext(context.Background(), `
		SELECT c.name, credit.share_bps
		FROM `+table+` credit
			JOIN creators c ON c.id = credit.creator_id
			JOIN `+ownerTable+` owner ON owner.id = credit.`+ownerColumn+`
		WHERE owner.public_id = $1
	`, publicID)
	if err != nil {
		t.Fatalf("read credit shares: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	shares := make(map[string]int32)
	for rows.Next() {
		var name string
		var share int32
		if err := rows.Scan(&name, &share); err != nil {
			t.Fatalf("scan credit share: %v", err)
		}
		shares[name] = share
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read credit shares: %v", err)
	}
	return shares
}

func storedEpisodeCreditShares(t *testing.T, env *adminDBEnv, episodePublicID string) map[string]int32 {
	t.Helper()

	return creditSharesByName(t, env, "episode_creators", "episode_id", "episodes", episodePublicID)
}

func storedSeriesCreditShares(t *testing.T, env *adminDBEnv, seriesPublicID string) map[string]int32 {
	t.Helper()

	return creditSharesByName(t, env, "series_creators", "series_id", "series", seriesPublicID)
}

// paid is one credit of a whole list, with the share it asks for.
type paid struct {
	creator string
	role    string
	share   int32
}

func (f bulkCreditFixture) paidCredits(t *testing.T, credits ...paid) []*publiraadminv1.EpisodeCreatorCredit {
	t.Helper()

	list := make([]*publiraadminv1.EpisodeCreatorCredit, 0, len(credits))
	for _, credit := range credits {
		message := f.credit(t, credit.creator, credit.role)
		message.ShareBps = credit.share
		list = append(list, message)
	}
	return list
}

func replaceEpisodeCredits(t *testing.T, env *adminDBEnv, as adminDBTenant, episodeID string, credits []*publiraadminv1.EpisodeCreatorCredit) error {
	t.Helper()

	_, err := env.seriesClient().ReplaceEpisodeCredits(testutil.WithBearer(context.Background(), as.token()), &publiraadminv1.ReplaceEpisodeCreditsRequest{
		Tenant:         as.tenantContext(),
		EpisodeId:      episodeID,
		CreatorCredits: credits,
	})
	return err
}

// An editor corrects who an episode credits, and a tenant_admin alone decides
// what any of them is paid: a save that changes a share, drops a paid credit,
// moves one onto someone else, or pays a new one is refused whole.
func TestDBAnEditorChangesAnEpisodesCreditsButNotWhatTheyArePaid(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	original, artist, supervisor := creatorroles.Defaults[0].Name, creatorroles.Defaults[1].Name, creatorroles.Defaults[3].Name
	fixture := seedSeriesRun(t, env, map[string]string{original: "Aoi Sakura", artist: "Ren Takahashi"}, 1)
	fixture.seedCreator(t, env, "Kaoru Ito")
	fixture.seedCreator(t, env, "Hana Kubo")
	editor := seedEditor(t, env, fixture.tenant)
	episode := fixture.episodes[0]
	episodeID := env.episodeID(t, episode)

	if err := replaceEpisodeCredits(t, env, fixture.tenant, episodeID, fixture.paidCredits(t,
		paid{"Aoi Sakura", original, 4000},
		paid{"Ren Takahashi", artist, 2000},
	)); err != nil {
		t.Fatalf("ReplaceEpisodeCredits as the tenant admin: %v", err)
	}
	if err := replaceEpisodeCredits(t, env, editor, episodeID, fixture.paidCredits(t,
		paid{"Aoi Sakura", original, 4000},
		paid{"Ren Takahashi", artist, 2000},
		paid{"Kaoru Ito", supervisor, 0},
	)); err != nil {
		t.Fatalf("ReplaceEpisodeCredits as an editor adding an unpaid guest: %v", err)
	}
	want := map[string]int32{"Aoi Sakura": 4000, "Ren Takahashi": 2000, "Kaoru Ito": 0}
	if got := storedEpisodeCreditShares(t, env, episode); !maps.Equal(got, want) {
		t.Fatalf("shares after the editor's save = %v, want %v", got, want)
	}

	for _, refused := range []struct {
		name    string
		credits []paid
	}{
		{"a changed share", []paid{{"Aoi Sakura", original, 5000}, {"Ren Takahashi", artist, 2000}, {"Kaoru Ito", supervisor, 0}}},
		{"a paid credit dropped", []paid{{"Aoi Sakura", original, 4000}, {"Kaoru Ito", supervisor, 0}}},
		{"a paid credit moved onto someone else", []paid{{"Aoi Sakura", original, 4000}, {"Hana Kubo", artist, 2000}, {"Kaoru Ito", supervisor, 0}}},
		{"a new credit paid", []paid{{"Aoi Sakura", original, 4000}, {"Ren Takahashi", artist, 2000}, {"Kaoru Ito", supervisor, 1000}}},
	} {
		t.Run(refused.name, func(t *testing.T) {
			err := replaceEpisodeCredits(t, env, editor, episodeID, fixture.paidCredits(t, refused.credits...))
			if connect.CodeOf(err) != connect.CodePermissionDenied {
				t.Fatalf("ReplaceEpisodeCredits = %v, want %v", err, connect.CodePermissionDenied)
			}
			if got := storedEpisodeCreditShares(t, env, episode); !maps.Equal(got, want) {
				t.Fatalf("shares after the refused save = %v, want them untouched, %v", got, want)
			}
		})
	}

	if err := replaceEpisodeCredits(t, env, editor, episodeID, fixture.paidCredits(t,
		paid{"Aoi Sakura", original, 4000},
		paid{"Ren Takahashi", artist, 2000},
	)); err != nil {
		t.Fatalf("ReplaceEpisodeCredits as an editor dropping the unpaid guest: %v", err)
	}
}

// A range edit is held to the same rule: an editor's set_share is refused, and
// so is a replace or a remove of a credit the range pays, while the same
// operations on episodes where the credit is paid nothing go through.
func TestDBAnEditorsRangeEditMovesNoShare(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	original, artist := creatorroles.Defaults[0].Name, creatorroles.Defaults[1].Name
	fixture := seedSeriesRun(t, env, map[string]string{original: "Aoi Sakura", artist: "Ren Takahashi"}, 3)
	fixture.seedCreator(t, env, "Hana Kubo")
	editor := seedEditor(t, env, fixture.tenant)
	paidEpisodes, unpaidEpisodes := fixture.episodes[:2], fixture.episodes[2:]

	bulkEdit := func(as adminDBTenant, episodes []string, operation func(*publiraadminv1.BulkEditEpisodeCreditsRequest)) error {
		t.Helper()
		request := &publiraadminv1.BulkEditEpisodeCreditsRequest{
			Tenant:     as.tenantContext(),
			SeriesId:   fixture.series.ID.String(),
			EpisodeIds: env.episodeIDs(t, episodes),
		}
		operation(request)
		_, err := env.seriesClient().BulkEditEpisodeCredits(testutil.WithBearer(context.Background(), as.token()), request)
		return err
	}
	setShare := func(share int32) func(*publiraadminv1.BulkEditEpisodeCreditsRequest) {
		return func(request *publiraadminv1.BulkEditEpisodeCreditsRequest) {
			credit := fixture.credit(t, "Ren Takahashi", artist)
			credit.ShareBps = share
			request.Operation = &publiraadminv1.BulkEditEpisodeCreditsRequest_SetShare{SetShare: &publiraadminv1.SetEpisodeCreditShareOperation{Credit: credit}}
		}
	}
	replaceArtist := func(request *publiraadminv1.BulkEditEpisodeCreditsRequest) {
		request.Operation = &publiraadminv1.BulkEditEpisodeCreditsRequest_Replace{Replace: &publiraadminv1.ReplaceEpisodeCreditOperation{
			From: fixture.credit(t, "Ren Takahashi", artist),
			To:   fixture.credit(t, "Hana Kubo", artist),
		}}
	}
	remove := func(creator, role string) func(*publiraadminv1.BulkEditEpisodeCreditsRequest) {
		return func(request *publiraadminv1.BulkEditEpisodeCreditsRequest) {
			request.Operation = &publiraadminv1.BulkEditEpisodeCreditsRequest_Remove{Remove: &publiraadminv1.RemoveEpisodeCreditOperation{Credit: fixture.credit(t, creator, role)}}
		}
	}

	if err := bulkEdit(fixture.tenant, paidEpisodes, setShare(2500)); err != nil {
		t.Fatalf("set_share as the tenant admin: %v", err)
	}
	if err := bulkEdit(editor, paidEpisodes, setShare(2500)); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("set_share as an editor = %v, want %v", err, connect.CodePermissionDenied)
	}
	if err := bulkEdit(editor, fixture.episodes, replaceArtist); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("replace of a paid credit as an editor = %v, want %v", err, connect.CodePermissionDenied)
	}
	if err := bulkEdit(editor, paidEpisodes[:1], remove("Ren Takahashi", artist)); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("remove of a paid credit as an editor = %v, want %v", err, connect.CodePermissionDenied)
	}
	for _, episode := range paidEpisodes {
		want := map[string]int32{"Aoi Sakura": 0, "Ren Takahashi": 2500}
		if got := storedEpisodeCreditShares(t, env, episode); !maps.Equal(got, want) {
			t.Fatalf("shares of %s after the refused edits = %v, want %v", episode, got, want)
		}
	}

	if err := bulkEdit(editor, unpaidEpisodes, replaceArtist); err != nil {
		t.Fatalf("replace of an unpaid credit as an editor: %v", err)
	}
	if err := bulkEdit(editor, fixture.episodes, remove("Aoi Sakura", original)); err != nil {
		t.Fatalf("remove of an unpaid credit as an editor: %v", err)
	}
	want := map[string]int32{"Hana Kubo": 0}
	if got := storedEpisodeCreditShares(t, env, unpaidEpisodes[0]); !maps.Equal(got, want) {
		t.Fatalf("shares of the unpaid episode = %v, want %v", got, want)
	}
}

// The series' credits are the template every new episode is paid from, so an
// editor's series save keeps them as a tenant_admin set them, from the first
// save on.
func TestDBAnEditorSavesASeriesWithoutChangingItsShares(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	editor := seedEditor(t, env, admin)
	aoi := env.PG.SeedCreator(t, admin.Tenant.ID, testutil.CreatorSeed{Name: "Aoi Sakura"})
	ren := env.PG.SeedCreator(t, admin.Tenant.ID, testutil.CreatorSeed{Name: "Ren Takahashi"})
	credits := func(shares ...int32) []*publiraadminv1.SeriesCreatorCredit {
		list := env.creatorCredits(t, admin, aoi.ID.String(), ren.ID.String())[:len(shares)]
		for index, share := range shares {
			list[index].ShareBps = share
		}
		return list
	}

	if _, err := env.seriesClient().CreateSeries(testutil.WithBearer(context.Background(), editor.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant:         editor.tenantContext(),
		Title:          "Paid by an editor",
		CreatorCredits: credits(1000),
	}); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("CreateSeries with a share as an editor = %v, want %v", err, connect.CodePermissionDenied)
	}
	created, err := env.seriesClient().CreateSeries(testutil.WithBearer(context.Background(), admin.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant:         admin.tenantContext(),
		Title:          "Long Running Series",
		CreatorCredits: credits(3000, 0),
	})
	if err != nil {
		t.Fatalf("CreateSeries as the tenant admin: %v", err)
	}
	seriesPublicID := created.Series.PublicId
	seriesID := env.seriesID(t, seriesPublicID)
	updateSeries := func(title string, credits []*publiraadminv1.SeriesCreatorCredit) error {
		_, err := env.seriesClient().UpdateSeries(testutil.WithBearer(context.Background(), editor.token()), &publiraadminv1.UpdateSeriesRequest{
			Tenant:         editor.tenantContext(),
			SeriesId:       seriesID,
			Title:          title,
			CreatorCredits: credits,
		})
		return err
	}

	if err := updateSeries("Renamed by an editor", credits(3000, 0)); err != nil {
		t.Fatalf("UpdateSeries as an editor keeping the shares: %v", err)
	}
	want := map[string]int32{"Aoi Sakura": 3000, "Ren Takahashi": 0}
	for name, credits := range map[string][]*publiraadminv1.SeriesCreatorCredit{
		"a changed share":       credits(5000, 0),
		"a paid credit dropped": credits(3000, 0)[1:],
	} {
		if err := updateSeries("Refused", credits); connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("UpdateSeries with %s as an editor = %v, want %v", name, err, connect.CodePermissionDenied)
		}
		if got := storedSeriesCreditShares(t, env, seriesPublicID); !maps.Equal(got, want) {
			t.Fatalf("series shares after %s was refused = %v, want %v", name, got, want)
		}
	}
	if err := updateSeries("Renamed by an editor", credits(3000)); err != nil {
		t.Fatalf("UpdateSeries as an editor dropping the unpaid credit: %v", err)
	}
}

// A key with catalog:write writes the catalogue as an editor does, and is held
// to the same rule about shares.
func TestDBAnAPIKeyChangesNoCreditShare(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	original := creatorroles.Defaults[0].Name
	fixture := seedSeriesRun(t, env, map[string]string{original: "Aoi Sakura"}, 1)
	key := createAPIKey(t, env, fixture.tenant, publiraadminv1.ApiKeyScope_API_KEY_SCOPE_CATALOG_WRITE)
	withKey := testutil.WithBearer(context.Background(), key.Key)
	episodeID := env.episodeID(t, fixture.episodes[0])

	if _, err := env.seriesClient().ReplaceEpisodeCredits(withKey, &publiraadminv1.ReplaceEpisodeCreditsRequest{
		Tenant:         fixture.tenant.tenantContext(),
		EpisodeId:      episodeID,
		CreatorCredits: fixture.paidCredits(t, paid{"Aoi Sakura", original, 0}),
	}); err != nil {
		t.Fatalf("ReplaceEpisodeCredits with a key keeping the shares: %v", err)
	}
	if _, err := env.seriesClient().ReplaceEpisodeCredits(withKey, &publiraadminv1.ReplaceEpisodeCreditsRequest{
		Tenant:         fixture.tenant.tenantContext(),
		EpisodeId:      episodeID,
		CreatorCredits: fixture.paidCredits(t, paid{"Aoi Sakura", original, 10000}),
	}); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("ReplaceEpisodeCredits with a key changing a share = %v, want %v", err, connect.CodePermissionDenied)
	}
	if _, err := env.seriesClient().UpdateSeries(withKey, &publiraadminv1.UpdateSeriesRequest{
		Tenant:   fixture.tenant.tenantContext(),
		SeriesId: fixture.series.ID.String(),
		Title:    fixture.series.Title,
		CreatorCredits: []*publiraadminv1.SeriesCreatorCredit{{
			CreatorId: fixture.creators["Aoi Sakura"].ID.String(),
			RoleId:    fixture.roles[original].ID.String(),
			ShareBps:  10000,
		}},
	}); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("UpdateSeries with a key changing a share = %v, want %v", err, connect.CodePermissionDenied)
	}
	if got, want := storedEpisodeCreditShares(t, env, fixture.episodes[0]), map[string]int32{"Aoi Sakura": 0}; !maps.Equal(got, want) {
		t.Fatalf("shares after the key's refused save = %v, want %v", got, want)
	}
}
