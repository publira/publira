package imageserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// releaseTrackingFactory hands out stub queries and records whether the
// tenant connection behind them has been given back.
type releaseTrackingFactory struct {
	q        TenantScopedQuerier
	released *atomic.Bool
}

func (f releaseTrackingFactory) ForTenant(context.Context, uuid.UUID) (TenantScopedQuerier, func(), error) {
	f.released.Store(false)
	return f.q, func() { f.released.Store(true) }, nil
}

// releaseCheckingStore records, for every object fetched, whether the tenant
// connection had been given back by then. The fetch is the first step of the
// conversion, so a connection still held here is held through all of it.
type releaseCheckingStore struct {
	*countingStore
	released *atomic.Bool
	heldAt   atomic.Int32
}

func (s *releaseCheckingStore) GetObject(ctx context.Context, key string) (ObjectResult, error) {
	if !s.released.Load() {
		s.heldAt.Add(1)
	}
	return s.countingStore.GetObject(ctx, key)
}

func TestImageRoutesGiveTheTenantConnectionBackBeforeTheConversion(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	const objectKey = "images/source.jpg"

	queries := stubTenantQueries{
		public: dbmodels.GetEpisodeImagePublicAccessByIDForTenantRow{
			ID:              mediaID,
			ObjectKey:       objectKey,
			ContentType:     "image/jpeg",
			IsPublished:     true,
			HasPublicAccess: true,
		},
		preview: dbmodels.GetEpisodePreviewImageByIDForTenantRow{
			ID:          mediaID,
			ObjectKey:   objectKey,
			ContentType: "image/jpeg",
			IsPublished: true,
		},
		creator: dbmodels.GetCreatorImageByIDForTenantRow{ObjectKey: objectKey, ContentType: "image/jpeg"},
		tenant:  dbmodels.GetTenantImageVariantByTypeForTenantRow{ObjectKey: objectKey, ContentType: "image/jpeg"},
		tenantKey: tenantVariantKey{
			tenantImageID: mediaID,
			tenantID:      tenantID,
			variantType:   "logo",
		},
		genre: dbmodels.GetGenreImageVariantByTypeAndWidthForTenantRow{ObjectKey: objectKey, ContentType: "image/jpeg"},
		genreKey: genreVariantKey{
			genreImageID: mediaID,
			tenantID:     tenantID,
			variantType:  "banner",
			width:        320,
		},
		series: dbmodels.GetSeriesImageVariantByTypeAndWidthForTenantRow{ObjectKey: objectKey, ContentType: "image/jpeg"},
		label:  dbmodels.GetLabelImageVariantByTypeAndWidthForTenantRow{ObjectKey: objectKey, ContentType: "image/jpeg"},
	}

	for _, path := range []string{
		"/images/episodes/" + mediaID.String(),
		"/images/episodes/" + mediaID.String() + "/preview",
		"/images/creators/" + mediaID.String(),
		"/images/tenants/" + mediaID.String() + "/logo",
		"/images/genres/" + mediaID.String() + "/banner/320",
		"/images/series/" + mediaID.String() + "/cover/320",
		"/images/labels/" + mediaID.String() + "/banner/320",
	} {
		t.Run(path, func(t *testing.T) {
			released := &atomic.Bool{}
			store := &releaseCheckingStore{
				countingStore: &countingStore{objects: map[string]storedObject{
					objectKey: {data: pageJPEG(t), contentType: "image/jpeg"},
				}},
				released: released,
			}
			srv := newTestServer(t,
				stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test", Timezone: "UTC"}},
				releaseTrackingFactory{q: queries, released: released},
				store,
			)

			req := httptest.NewRequest(http.MethodGet, path, nil)
			req.Host = "example.test"
			req.Header.Set("Accept", "image/webp,image/*,*/*;q=0.8")
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %q", rec.Code, rec.Body.String())
			}
			if store.getCount() == 0 {
				t.Fatal("the object was never fetched, so nothing was converted")
			}
			if held := store.heldAt.Load(); held != 0 {
				t.Fatalf("the tenant connection was still held at %d object fetch(es); it must be given back once the row is read", held)
			}
		})
	}
}
