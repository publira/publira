package adminapi

import (
	"encoding/base64"
	"log/slog"
	"net/http"
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/DATA-DOG/go-sqlmock"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/episodeimages"
	"github.com/publira/publira/server/internal/imageproc"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/testutil"
)

func newReadLimitHandler(t *testing.T) (http.Handler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	handler, err := newTestHandler(db, dbmodels.New(db), &testStorageProvider{}, slog.Default(), nil, nil)
	if err != nil {
		t.Fatalf("new admin handler: %v", err)
	}
	return handler, mock
}

// Every procedure reads at most its bound of one request, and one byte more is
// refused while it is read, before anything decodes it: the namespace is
// reached before a session is checked. A request of exactly the bound is read
// and then fails to decode, which is what tells the two apart.
func TestReadLimitsBoundEveryProcedure(t *testing.T) {
	handler, _ := newReadLimitHandler(t)
	bounds := map[string]int{
		publiraadminv1connect.AdminAuthServiceLoginProcedure:        rpcmiddleware.DefaultReadMaxBytes,
		publiraadminv1connect.AdminSeriesServiceListSeriesProcedure: rpcmiddleware.DefaultReadMaxBytes,
		publiraadminv1connect.AdminPagesServiceCreatePageProcedure:  rpcmiddleware.DefaultReadMaxBytes,
	}
	for procedure, bound := range readLimits {
		bounds[procedure] = bound
	}
	for procedure, bound := range bounds {
		t.Run(procedure, func(t *testing.T) {
			if got := testutil.ReadLimitCode(t, handler, procedure, int64(bound)); got != connect.CodeInvalidArgument {
				t.Errorf("a request of %d bytes: %v, want it read and then refused as invalid_argument", bound, got)
			}
			if got := testutil.ReadLimitCode(t, handler, procedure, int64(bound)+1); got != connect.CodeResourceExhausted {
				t.Errorf("a request of %d bytes: %v, want resource_exhausted", bound+1, got)
			}
		})
	}
}

// Every upload is read whole at the largest image it is documented to take,
// in either encoding the server accepts, and reaches the session check, which
// looks up the tenant it names and refuses it here for naming none, rather
// than being refused for its size.
func TestReadLimitsAdmitTheLargestDocumentedUpload(t *testing.T) {
	tenant := &publirattypesv1.TenantContext{TenantId: "00000000-0000-0000-0000-000000000001"}
	image := func(n int) []byte { return make([]byte, n) }
	uploads := map[string]proto.Message{
		publiraadminv1connect.AdminSeriesServiceUploadEpisodeImagesProcedure: &publiraadminv1.UploadEpisodeImagesRequest{
			Tenant: tenant,
			Images: []*publiraadminv1.EpisodeImageUpload{{Filename: "001.png", ContentType: "image/png", Data: image(imageproc.MaxUploadBytes)}},
		},
		publiraadminv1connect.AdminSeriesServiceReplaceEpisodeImageProcedure: &publiraadminv1.ReplaceEpisodeImageRequest{
			Tenant: tenant, Filename: "001.png", ContentType: "image/png", Data: image(imageproc.MaxUploadBytes),
		},
		publiraadminv1connect.AdminSeriesServiceCreateSeriesProcedure: &publiraadminv1.CreateSeriesRequest{
			Tenant: tenant, EyeCatchImageData: image(imageproc.EyeCatchMaxBytes),
		},
		publiraadminv1connect.AdminSeriesServiceUpdateSeriesProcedure: &publiraadminv1.UpdateSeriesRequest{
			Tenant: tenant, EyeCatchImageData: image(imageproc.EyeCatchMaxBytes),
		},
		publiraadminv1connect.AdminSeriesServiceUploadSeriesEyeCatchAspectImageProcedure: &publiraadminv1.UploadSeriesEyeCatchAspectImageRequest{
			Tenant: tenant, ImageData: image(imageproc.EyeCatchMaxBytes),
		},
		publiraadminv1connect.AdminLabelServiceCreateLabelProcedure: &publiraadminv1.CreateLabelRequest{
			Tenant: tenant, EyeCatchImageData: image(imageproc.EyeCatchMaxBytes),
		},
		publiraadminv1connect.AdminLabelServiceUpdateLabelProcedure: &publiraadminv1.UpdateLabelRequest{
			Tenant: tenant, EyeCatchImageData: image(imageproc.EyeCatchMaxBytes),
		},
		publiraadminv1connect.AdminLabelServiceUploadLabelEyeCatchAspectImageProcedure: &publiraadminv1.UploadLabelEyeCatchAspectImageRequest{
			Tenant: tenant, ImageData: image(imageproc.EyeCatchMaxBytes),
		},
		publiraadminv1connect.AdminGenreServiceCreateGenreProcedure: &publiraadminv1.CreateGenreRequest{
			Tenant: tenant, EyeCatchImageData: image(imageproc.EyeCatchMaxBytes),
		},
		publiraadminv1connect.AdminGenreServiceUpdateGenreProcedure: &publiraadminv1.UpdateGenreRequest{
			Tenant: tenant, EyeCatchImageData: image(imageproc.EyeCatchMaxBytes),
		},
		publiraadminv1connect.AdminGenreServiceUploadGenreEyeCatchAspectImageProcedure: &publiraadminv1.UploadGenreEyeCatchAspectImageRequest{
			Tenant: tenant, ImageData: image(imageproc.EyeCatchMaxBytes),
		},
		publiraadminv1connect.AdminCreatorServiceCreateCreatorProcedure: &publiraadminv1.CreateCreatorRequest{
			Tenant: tenant, IconImageData: image(creatorIconMaxUploadBytes),
		},
		publiraadminv1connect.AdminCreatorServiceUpdateCreatorProcedure: &publiraadminv1.UpdateCreatorRequest{
			Tenant: tenant, IconImageData: image(creatorIconMaxUploadBytes),
		},
		publiraadminv1connect.TenantThemeServiceUploadTenantIconProcedure: &publiraadminv1.UploadTenantIconRequest{
			Tenant: tenant, IconData: image(imageproc.IconMaxBytes),
		},
		publiraadminv1connect.TenantThemeServiceUploadTenantLogoProcedure: &publiraadminv1.UploadTenantLogoRequest{
			Tenant: tenant, LogoData: image(imageproc.LogoMaxBytes),
		},
	}
	encodings := map[string]func(*testing.T, http.Handler, string, proto.Message) connect.Code{
		"binary": testutil.RequestCode,
		"JSON":   testutil.JSONRequestCode,
	}
	for procedure, req := range uploads {
		for encoding, send := range encodings {
			t.Run(procedure+"/"+encoding, func(t *testing.T) {
				handler, mock := newReadLimitHandler(t)
				mock.ExpectQuery("FROM tenants").WillReturnRows(sqlmock.NewRows(nil))
				if got := send(t, handler, procedure, req); got != connect.CodeNotFound {
					t.Errorf("an upload of a %d-byte message: %v, want not_found", proto.Size(req), got)
				}
				if err := mock.ExpectationsWereMet(); err != nil {
					t.Errorf("the tenant the upload names was not looked up: %v", err)
				}
			})
		}
	}
}

// An episode upload carrying the largest archive episodeimages takes fits its
// procedure's read limit in either encoding, the JSON one carrying the archive
// in base64 a third larger. The sizes are worked out rather than sent: such a
// message runs to well over a hundred megabytes, and
// TestReadLimitsBoundEveryProcedure already shows that a request of exactly
// the limit is read.
func TestReadLimitsAdmitTheLargestEpisodeArchive(t *testing.T) {
	sample := []byte{0, 0, 0}
	req := &publiraadminv1.UploadEpisodeImagesRequest{
		Tenant:             &publirattypesv1.TenantContext{TenantId: "00000000-0000-0000-0000-000000000001"},
		ArchiveData:        sample,
		ArchiveFilename:    "episode.zip",
		ArchiveContentType: "application/zip",
		EpisodeId:          "EPISODE00001",
		SeriesId:           "SERIES000001",
	}
	encoded, err := protojson.Marshal(req)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	const archive = episodeimages.MaxUploadBytes
	sizes := map[string]int{
		"binary": proto.Size(req) - len(sample) - protowire.SizeVarint(uint64(len(sample))) + archive + protowire.SizeVarint(archive),
		"JSON":   len(encoded) - base64.StdEncoding.EncodedLen(len(sample)) + base64.StdEncoding.EncodedLen(archive),
	}
	limit := readLimits[publiraadminv1connect.AdminSeriesServiceUploadEpisodeImagesProcedure]
	for encoding, size := range sizes {
		if size > limit {
			t.Errorf("an archive of %d bytes in the %s encoding is a %d-byte message, past the %d-byte read limit", archive, encoding, size, limit)
		}
	}
}
