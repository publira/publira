package announcementaudience

import (
	"context"
	"encoding/json"
	"slices"
	"testing"

	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fielderr"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
)

// stubQuerier holds one tenant's series and plans.
type stubQuerier struct {
	series map[uuid.UUID]string
	plans  map[uuid.UUID]string
}

func (s stubQuerier) ListAnnouncementAudienceSeries(_ context.Context, arg dbmodels.ListAnnouncementAudienceSeriesParams) ([]dbmodels.ListAnnouncementAudienceSeriesRow, error) {
	var rows []dbmodels.ListAnnouncementAudienceSeriesRow
	for id, publicID := range s.series {
		if slices.Contains(arg.PublicIds, publicID) || slices.Contains(arg.Ids, id) {
			rows = append(rows, dbmodels.ListAnnouncementAudienceSeriesRow{ID: id, PublicID: publicID})
		}
	}
	return rows, nil
}

func (s stubQuerier) ListAnnouncementAudiencePlans(_ context.Context, arg dbmodels.ListAnnouncementAudiencePlansParams) ([]dbmodels.ListAnnouncementAudiencePlansRow, error) {
	var rows []dbmodels.ListAnnouncementAudiencePlansRow
	for id, publicID := range s.plans {
		if slices.Contains(arg.PublicIds, publicID) || slices.Contains(arg.Ids, id) {
			rows = append(rows, dbmodels.ListAnnouncementAudiencePlansRow{ID: id, PublicID: publicID})
		}
	}
	return rows, nil
}

var (
	seriesID = uuid.MustParse("01970000-0000-7000-8000-000000000001")
	planID   = uuid.MustParse("01970000-0000-7000-8000-000000000002")
	tenant   = dbmodels.Tenant{ID: uuid.New(), DefaultLocale: "ja", SupportedLocales: []string{"ja", "en"}}
	catalog  = stubQuerier{
		series: map[uuid.UUID]string{seriesID: "SERIES000001"},
		plans:  map[uuid.UUID]string{planID: "PLAN00000001"},
	}
)

func everyCondition() *publiraadminv1.AnnouncementAudience {
	return &publiraadminv1.AnnouncementAudience{Conditions: []*publiraadminv1.AnnouncementAudienceCondition{
		{Condition: &publiraadminv1.AnnouncementAudienceCondition_FollowsSeries_{FollowsSeries: &publiraadminv1.AnnouncementAudienceCondition_FollowsSeries{SeriesPublicId: "SERIES000001"}}},
		{Condition: &publiraadminv1.AnnouncementAudienceCondition_BoughtSeriesEpisode_{BoughtSeriesEpisode: &publiraadminv1.AnnouncementAudienceCondition_BoughtSeriesEpisode{SeriesPublicId: "SERIES000001"}}},
		{Condition: &publiraadminv1.AnnouncementAudienceCondition_Subscription_{Subscription: &publiraadminv1.AnnouncementAudienceCondition_Subscription{PlanPublicId: "PLAN00000001", State: publiraadminv1.SubscriptionState_SUBSCRIPTION_STATE_ENDED}}},
		{Condition: &publiraadminv1.AnnouncementAudienceCondition_NeverPurchased_{NeverPurchased: &publiraadminv1.AnnouncementAudienceCondition_NeverPurchased{}}},
		{Condition: &publiraadminv1.AnnouncementAudienceCondition_LastReadDaysAgo_{LastReadDaysAgo: &publiraadminv1.AnnouncementAudienceCondition_LastReadDaysAgo{Days: 30}}},
		{Condition: &publiraadminv1.AnnouncementAudienceCondition_SignedUpWithinDays_{SignedUpWithinDays: &publiraadminv1.AnnouncementAudienceCondition_SignedUpWithinDays{Days: MaxDays}}},
		{Condition: &publiraadminv1.AnnouncementAudienceCondition_Locale_{Locale: &publiraadminv1.AnnouncementAudienceCondition_Locale{Locale: "en"}}},
		{Condition: &publiraadminv1.AnnouncementAudienceCondition_HasMobilePushDevice_{HasMobilePushDevice: &publiraadminv1.AnnouncementAudienceCondition_HasMobilePushDevice{}}},
	}}
}

// Every condition survives the trip from the request to the stored JSON and
// back to the answer, and the JSON names series and plans by id.
func TestEveryConditionRoundTripsThroughTheStoredForm(t *testing.T) {
	sent := everyCondition()
	audience, err := FromProto(context.Background(), catalog, tenant, sent)
	if err != nil {
		t.Fatalf("FromProto: %v", err)
	}
	encoded, err := audience.Encode()
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	want := `{"version":1,"conditions":[` +
		`{"type":"follows_series","series_id":"` + seriesID.String() + `"},` +
		`{"type":"bought_series_episode","series_id":"` + seriesID.String() + `"},` +
		`{"type":"subscription","plan_id":"` + planID.String() + `","state":"ended"},` +
		`{"type":"never_purchased"},` +
		`{"type":"last_read_days_ago","days":30},` +
		`{"type":"signed_up_within_days","days":3650},` +
		`{"type":"locale","locale":"en"},` +
		`{"type":"has_mobile_push_device"}]}`
	if string(encoded) != want {
		t.Fatalf("stored = %s\nwant     %s", encoded, want)
	}

	decoded, ok, err := Decode(encoded)
	if err != nil || !ok {
		t.Fatalf("Decode = %v, %v", ok, err)
	}
	names, err := LookUpPublicIDs(context.Background(), catalog, tenant.ID, decoded)
	if err != nil {
		t.Fatalf("LookUpPublicIDs: %v", err)
	}
	if answered := ToProto(decoded, names); !proto.Equal(answered, sent) {
		t.Fatalf("answered = %v, want %v", answered, sent)
	}
}

// A subscription to any plan is stored with plan_id null, and read back as one.
func TestASubscriptionToAnyPlanStoresANullPlan(t *testing.T) {
	audience, err := FromProto(context.Background(), catalog, tenant, &publiraadminv1.AnnouncementAudience{Conditions: []*publiraadminv1.AnnouncementAudienceCondition{
		{Condition: &publiraadminv1.AnnouncementAudienceCondition_Subscription_{Subscription: &publiraadminv1.AnnouncementAudienceCondition_Subscription{State: publiraadminv1.SubscriptionState_SUBSCRIPTION_STATE_ACTIVE}}},
	}})
	if err != nil {
		t.Fatalf("FromProto: %v", err)
	}
	encoded, err := audience.Encode()
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	if want := `{"version":1,"conditions":[{"type":"subscription","plan_id":null,"state":"active"}]}`; string(encoded) != want {
		t.Fatalf("stored = %s, want %s", encoded, want)
	}
	decoded, _, err := Decode(encoded)
	if err != nil || decoded.Conditions[0].PlanID != nil {
		t.Fatalf("Decode = %+v, %v; want a subscription to any plan", decoded, err)
	}
}

// Each refusal names the field it is about.
func TestFromProtoRefusesWhatTheTenantCannotAddress(t *testing.T) {
	condition := func(c *publiraadminv1.AnnouncementAudienceCondition) *publiraadminv1.AnnouncementAudience {
		return &publiraadminv1.AnnouncementAudience{Conditions: []*publiraadminv1.AnnouncementAudienceCondition{c}}
	}
	for _, tc := range []struct {
		name     string
		audience *publiraadminv1.AnnouncementAudience
		field    string
	}{
		{"no conditions", &publiraadminv1.AnnouncementAudience{}, "audience.conditions"},
		{"an unset condition", condition(&publiraadminv1.AnnouncementAudienceCondition{}), "audience.conditions[0]"},
		{"another tenant's series", condition(&publiraadminv1.AnnouncementAudienceCondition{Condition: &publiraadminv1.AnnouncementAudienceCondition_BoughtSeriesEpisode_{BoughtSeriesEpisode: &publiraadminv1.AnnouncementAudienceCondition_BoughtSeriesEpisode{SeriesPublicId: "ELSEWHERE001"}}}), "audience.conditions[0].bought_series_episode.series_public_id"},
		{"another tenant's plan", condition(&publiraadminv1.AnnouncementAudienceCondition{Condition: &publiraadminv1.AnnouncementAudienceCondition_Subscription_{Subscription: &publiraadminv1.AnnouncementAudienceCondition_Subscription{PlanPublicId: "ELSEWHERE001", State: publiraadminv1.SubscriptionState_SUBSCRIPTION_STATE_ACTIVE}}}), "audience.conditions[0].subscription.plan_public_id"},
		{"no subscription state", condition(&publiraadminv1.AnnouncementAudienceCondition{Condition: &publiraadminv1.AnnouncementAudienceCondition_Subscription_{Subscription: &publiraadminv1.AnnouncementAudienceCondition_Subscription{}}}), "audience.conditions[0].subscription.state"},
		{"no days", condition(&publiraadminv1.AnnouncementAudienceCondition{Condition: &publiraadminv1.AnnouncementAudienceCondition_LastReadDaysAgo_{LastReadDaysAgo: &publiraadminv1.AnnouncementAudienceCondition_LastReadDaysAgo{}}}), "audience.conditions[0].last_read_days_ago.days"},
		{"a locale the tenant does not offer", condition(&publiraadminv1.AnnouncementAudienceCondition{Condition: &publiraadminv1.AnnouncementAudienceCondition_Locale_{Locale: &publiraadminv1.AnnouncementAudienceCondition_Locale{Locale: "ko"}}}), "audience.conditions[0].locale.locale"},
		{"a type twice", &publiraadminv1.AnnouncementAudience{Conditions: []*publiraadminv1.AnnouncementAudienceCondition{everyCondition().Conditions[3], everyCondition().Conditions[3]}}, "audience.conditions[1]"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := FromProto(context.Background(), catalog, tenant, tc.audience)
			if got := fielderr.Field(err); got != tc.field {
				t.Fatalf("refused field = %q (err=%v), want %q", got, err, tc.field)
			}
		})
	}
}

// No audience decodes as none, so an announcement for everyone is never
// refused by the worker.
func TestDecodeReadsNoAudienceAsEveryone(t *testing.T) {
	for _, raw := range [][]byte{nil, []byte("null")} {
		if _, ok, err := Decode(raw); ok || err != nil {
			t.Fatalf("Decode(%q) = %v, %v; want no audience", raw, ok, err)
		}
	}
	if _, _, err := Decode(json.RawMessage(`{"version": 1, "conditions": [{"type": "follows_series"}]}`)); err == nil {
		t.Fatal("Decode of a series condition with no series succeeded")
	}
}
