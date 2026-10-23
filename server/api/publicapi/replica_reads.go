package publicapi

import (
	"connectrpc.com/connect/v2"

	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
)

// replicaProcedures are the procedures a request may be answered on the read
// replica for. Nothing is answered there by default: a procedure is listed
// here when, asked in order,
//
//  1. it writes nothing — a hot standby refuses every write, and a procedure
//     that writes on the side of what it reads would fail there;
//  2. its answer is the same for every caller, the published catalogue a guest
//     is shown — the reads the web apps cache and share between readers, and
//     the bulk of what a growing install is asked; and
//  3. it is not one of the sign-in paths, which stay on the primary whatever
//     they read.
//
// A procedure that answers the caller about themselves — ListMy*, GetMy*,
// GetSeriesEpisodeAccess — fails the second question and is not listed, and a
// request to a listed one that carries a session is answered on the primary
// all the same (see [answeredOnReplica]). TestReplicaProceduresAreCatalogReads
// holds the list to the questions it can check from a name, and
// TestDBReplicaProceduresWriteNothing calls each against a standby.
//
// What a listed request may see is never older than what the primary had
// committed when it arrived, because internal/readreplica answers it on the
// replica only once the replica has replayed that far.
var replicaProcedures = map[string]bool{
	publirav1connect.CatalogServiceListPublishedLabelsProcedure:       true,
	publirav1connect.CatalogServiceListPublishedSeriesProcedure:       true,
	publirav1connect.CatalogServiceGetSeriesDetailProcedure:           true,
	publirav1connect.CatalogServiceGetEpisodeDetailProcedure:          true,
	publirav1connect.CatalogServiceListPublishedCreatorsProcedure:     true,
	publirav1connect.CatalogServiceGetPublishedCreatorDetailProcedure: true,
	publirav1connect.CatalogServiceGetPublishedLabelDetailProcedure:   true,
	publirav1connect.CatalogServiceListPublishedGenresProcedure:       true,
	publirav1connect.CatalogServiceListPublishedTagsProcedure:         true,
	publirav1connect.CatalogServiceSearchPublishedSeriesProcedure:     true,
	publirav1connect.CatalogServiceSearchPublishedCreatorsProcedure:   true,
	publirav1connect.CatalogServiceSearchPublishedLabelsProcedure:     true,
	publirav1connect.CatalogServiceListRecommendedSeriesProcedure:     true,
	publirav1connect.CatalogServiceListRankedSeriesProcedure:          true,
	publirav1connect.CatalogServiceListRelatedSeriesProcedure:         true,
	publirav1connect.CatalogServiceListSitemapEntriesProcedure:        true,
	publirav1connect.CatalogServiceListCampaignBannersProcedure:       true,
}

// answeredOnReplica reports whether a request to procedure may be answered on
// the read replica: the procedure is listed in [replicaProcedures] and the
// request carries no credential.
//
// A request with a credential is a signed-in reader's, and what it is answered
// with may hang on what that reader has just done — bought an episode, changed
// a setting, been signed out everywhere. GetEpisodeDetail is the listed
// procedure where this decides the answer: with a session it reads the
// reader's entitlement and age, and with none it is the guest's page. The
// replica would answer either correctly once caught up, but the entitlement
// and the session are where a mistake costs a reader what they paid for or
// leaves a revoked session working, so they never depend on it.
func answeredOnReplica(procedure string, header *connect.Header) bool {
	return replicaProcedures[procedure] && header.Get("Authorization") == ""
}
