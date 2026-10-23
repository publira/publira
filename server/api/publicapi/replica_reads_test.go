package publicapi

import (
	"strings"
	"testing"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/reflect/protoreflect"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
)

// The questions [replicaProcedures] is placed by that a name can answer: a
// listed procedure is a read of CatalogService, the published catalogue, and
// none of the reads that answer the caller about themselves.
func TestReplicaProceduresAreCatalogReads(t *testing.T) {
	catalog := publirav1.File_publira_v1_catalog_proto.Services().ByName("CatalogService")
	if catalog == nil {
		t.Fatal("CatalogService is not in publira/v1/catalog.proto")
	}
	// Reads of CatalogService that answer the caller, which no name pattern
	// gives away.
	answersTheCaller := map[string]bool{
		publirav1connect.CatalogServiceGetSeriesEpisodeAccessProcedure: true,
	}

	for procedure := range replicaProcedures {
		service, method, ok := strings.Cut(strings.TrimPrefix(procedure, "/"), "/")
		if !ok || protoreflect.FullName(service) != catalog.FullName() {
			t.Errorf("%s is not a CatalogService procedure", procedure)
			continue
		}
		if catalog.Methods().ByName(protoreflect.Name(method)) == nil {
			t.Errorf("%s names no method of CatalogService", procedure)
			continue
		}
		if !strings.HasPrefix(method, "Get") && !strings.HasPrefix(method, "List") && !strings.HasPrefix(method, "Search") {
			t.Errorf("%s is not a read", procedure)
		}
		if strings.Contains(method, "My") || answersTheCaller[procedure] {
			t.Errorf("%s answers the caller about themselves", procedure)
		}
	}
}

func TestAnsweredOnReplica(t *testing.T) {
	withCredential := func(value string) *connect.Header {
		var header connect.Header
		header.Set("Authorization", value)
		return &header
	}
	for _, tc := range []struct {
		name      string
		procedure string
		header    *connect.Header
		want      bool
	}{
		{
			name:      "a guest's catalog read",
			procedure: publirav1connect.CatalogServiceGetSeriesDetailProcedure,
			want:      true,
		},
		{
			name:      "a signed-in reader's catalog read",
			procedure: publirav1connect.CatalogServiceGetEpisodeDetailProcedure,
			header:    withCredential("Bearer token"),
		},
		{
			name:      "a credential the server will not accept",
			procedure: publirav1connect.CatalogServiceGetEpisodeDetailProcedure,
			header:    withCredential("Basic dXNlcjpwYXNz"),
		},
		{
			name:      "a read that answers the caller",
			procedure: publirav1connect.CatalogServiceListMyRecommendedSeriesProcedure,
		},
		{
			name:      "a write",
			procedure: publirav1connect.RatingServiceRateEpisodeProcedure,
		},
		{
			name:      "a sign-in",
			procedure: publirav1connect.AuthServiceLoginProcedure,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := answeredOnReplica(tc.procedure, tc.header); got != tc.want {
				t.Fatalf("answeredOnReplica(%s) = %v, want %v", tc.procedure, got, tc.want)
			}
		})
	}
}
