// Package announcementaudience is the audience a targeted announcement is
// addressed to: the conditions a reader has to meet every one of, as
// announcements.audience stores them and as the admin API sends them.
//
// The stored form names series and plans by their internal ids, so a public id
// that changes does not redirect an announcement already posted, and the
// console's form names them by public id. [FromProto] turns the one into the
// other against the tenant's catalog and refuses what the tenant does not own;
// [Decode] is what the worker reads back before it delivers. Which readers a
// stored audience selects is answered by the database function
// announcement_audience_members, which reads the same JSON.
package announcementaudience

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/locale"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
)

// Version is the shape of the stored audience this release writes and reads.
// announcement_audience_members selects nobody for any other, so an audience a
// later release writes in a shape this one cannot evaluate is never delivered
// to everyone by it.
const Version = 1

// MaxDays bounds the day counts a condition takes: ten years, past which a
// reader's history says nothing a shorter window does not.
const MaxDays = 3650

// Type names one condition, and is its "type" in the stored JSON.
type Type string

const (
	TypeFollowsSeries       Type = "follows_series"
	TypeBoughtSeriesEpisode Type = "bought_series_episode"
	TypeSubscription        Type = "subscription"
	TypeNeverPurchased      Type = "never_purchased"
	TypeLastReadDaysAgo     Type = "last_read_days_ago"
	TypeSignedUpWithinDays  Type = "signed_up_within_days"
	TypeLocale              Type = "locale"
	TypeHasMobilePushDevice Type = "has_mobile_push_device"
)

// SubscriptionState is the state a subscription condition asks for.
type SubscriptionState string

const (
	SubscriptionActive SubscriptionState = "active"
	SubscriptionEnded  SubscriptionState = "ended"
)

// Audience is a stored audience: at least one condition, each type at most
// once.
type Audience struct {
	Version    int         `json:"version"`
	Conditions []Condition `json:"conditions"`
}

// Condition is one condition of an audience. Only the fields its type takes
// are set: SeriesID for the two series conditions, PlanID and State for a
// subscription, Days for the two day counts, Locale for a locale.
type Condition struct {
	Type     Type
	SeriesID uuid.UUID
	// PlanID is nil for a subscription to any plan.
	PlanID *uuid.UUID
	State  SubscriptionState
	Days   int32
	Locale string
}

// storedCondition is every field a condition may carry in the JSON, for
// reading one back whatever its type.
type storedCondition struct {
	Type     Type              `json:"type"`
	SeriesID *uuid.UUID        `json:"series_id"`
	PlanID   *uuid.UUID        `json:"plan_id"`
	State    SubscriptionState `json:"state"`
	Days     *int32            `json:"days"`
	Locale   *string           `json:"locale"`
}

// MarshalJSON writes the fields the condition's type takes and no others, so
// the stored JSON reads as the condition it is. A subscription to any plan
// stores plan_id as null rather than leaving it out, saying so on its face.
func (c Condition) MarshalJSON() ([]byte, error) {
	switch c.Type {
	case TypeFollowsSeries, TypeBoughtSeriesEpisode:
		return json.Marshal(struct {
			Type     Type      `json:"type"`
			SeriesID uuid.UUID `json:"series_id"`
		}{c.Type, c.SeriesID})
	case TypeSubscription:
		return json.Marshal(struct {
			Type   Type              `json:"type"`
			PlanID *uuid.UUID        `json:"plan_id"`
			State  SubscriptionState `json:"state"`
		}{c.Type, c.PlanID, c.State})
	case TypeLastReadDaysAgo, TypeSignedUpWithinDays:
		return json.Marshal(struct {
			Type Type  `json:"type"`
			Days int32 `json:"days"`
		}{c.Type, c.Days})
	case TypeLocale:
		return json.Marshal(struct {
			Type   Type   `json:"type"`
			Locale string `json:"locale"`
		}{c.Type, c.Locale})
	case TypeNeverPurchased, TypeHasMobilePushDevice:
		return json.Marshal(struct {
			Type Type `json:"type"`
		}{c.Type})
	default:
		return nil, fmt.Errorf("audience condition type %q is unknown", c.Type)
	}
}

// UnmarshalJSON reads a condition back. A field its type does not take is
// ignored; one its type needs and the JSON lacks is left zero for [Validate]
// to refuse.
func (c *Condition) UnmarshalJSON(data []byte) error {
	var stored storedCondition
	if err := json.Unmarshal(data, &stored); err != nil {
		return err
	}
	*c = Condition{Type: stored.Type}
	switch stored.Type {
	case TypeFollowsSeries, TypeBoughtSeriesEpisode:
		if stored.SeriesID != nil {
			c.SeriesID = *stored.SeriesID
		}
	case TypeSubscription:
		c.PlanID = stored.PlanID
		c.State = stored.State
	case TypeLastReadDaysAgo, TypeSignedUpWithinDays:
		if stored.Days != nil {
			c.Days = *stored.Days
		}
	case TypeLocale:
		if stored.Locale != nil {
			c.Locale = *stored.Locale
		}
	}
	return nil
}

// Encode is the JSON announcements.audience stores.
func (a Audience) Encode() (json.RawMessage, error) {
	if err := Validate(a); err != nil {
		return nil, err
	}
	return json.Marshal(a)
}

// Decode reads a stored audience and validates it. A nil or JSON null raw is
// no audience: the announcement is for everyone, and ok is false.
func Decode(raw []byte) (audience Audience, ok bool, err error) {
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return Audience{}, false, nil
	}
	if err := json.Unmarshal(raw, &audience); err != nil {
		return Audience{}, false, fmt.Errorf("decode announcement audience: %w", err)
	}
	if err := Validate(audience); err != nil {
		return Audience{}, false, err
	}
	return audience, true, nil
}

// Validate checks what an audience says on its own, without the tenant: the
// version, at least one condition, each type once, and the fields each type
// takes. Whether the tenant owns a series or plan, or offers a locale, is
// [FromProto]'s to check when the audience is written.
func Validate(a Audience) error {
	if a.Version != Version {
		return fmt.Errorf("announcement audience version %d is not %d", a.Version, Version)
	}
	if len(a.Conditions) == 0 {
		return errors.New("announcement audience has no conditions")
	}
	seen := make(map[Type]bool, len(a.Conditions))
	for _, condition := range a.Conditions {
		if seen[condition.Type] {
			return fmt.Errorf("announcement audience names %s more than once", condition.Type)
		}
		seen[condition.Type] = true
		if err := validateCondition(condition); err != nil {
			return err
		}
	}
	return nil
}

func validateCondition(c Condition) error {
	switch c.Type {
	case TypeFollowsSeries, TypeBoughtSeriesEpisode:
		if c.SeriesID == uuid.Nil {
			return fmt.Errorf("%s names no series", c.Type)
		}
	case TypeSubscription:
		if c.PlanID != nil && *c.PlanID == uuid.Nil {
			return fmt.Errorf("%s names the nil plan", c.Type)
		}
		if c.State != SubscriptionActive && c.State != SubscriptionEnded {
			return fmt.Errorf("%s state %q is neither active nor ended", c.Type, c.State)
		}
	case TypeLastReadDaysAgo, TypeSignedUpWithinDays:
		if c.Days < 1 || c.Days > MaxDays {
			return fmt.Errorf("%s days %d is outside 1 to %d", c.Type, c.Days, MaxDays)
		}
	case TypeLocale:
		if _, err := locale.Normalize(c.Locale); err != nil {
			return fmt.Errorf("%s %q is not a supported locale", c.Type, c.Locale)
		}
	case TypeNeverPurchased, TypeHasMobilePushDevice:
	default:
		return fmt.Errorf("announcement audience condition type %q is unknown", c.Type)
	}
	return nil
}

// Querier is the statements that turn public ids into ids and back.
type Querier interface {
	ListAnnouncementAudienceSeries(ctx context.Context, arg dbmodels.ListAnnouncementAudienceSeriesParams) ([]dbmodels.ListAnnouncementAudienceSeriesRow, error)
	ListAnnouncementAudiencePlans(ctx context.Context, arg dbmodels.ListAnnouncementAudiencePlansParams) ([]dbmodels.ListAnnouncementAudiencePlansRow, error)
}

// FromProto turns the audience CreateAnnouncement was sent into the one it
// stores. A refusal is a [*fielderr.Invalid] naming the request field behind
// it: no condition, a type named twice, a series or plan the tenant does not
// own, a day count outside 1 to [MaxDays], a locale the tenant does not offer.
// Any other error is the database's.
func FromProto(
	ctx context.Context,
	queries Querier,
	tenant dbmodels.Tenant,
	src *publiraadminv1.AnnouncementAudience,
) (Audience, error) {
	conditions := src.GetConditions()
	if len(conditions) == 0 {
		return Audience{}, invalid("audience.conditions", errors.New("audience must name at least one condition"))
	}

	var seriesPublicIDs, planPublicIDs []string
	for _, condition := range conditions {
		switch kind := condition.GetCondition().(type) {
		case *publiraadminv1.AnnouncementAudienceCondition_FollowsSeries_:
			seriesPublicIDs = append(seriesPublicIDs, kind.FollowsSeries.GetSeriesPublicId())
		case *publiraadminv1.AnnouncementAudienceCondition_BoughtSeriesEpisode_:
			seriesPublicIDs = append(seriesPublicIDs, kind.BoughtSeriesEpisode.GetSeriesPublicId())
		case *publiraadminv1.AnnouncementAudienceCondition_Subscription_:
			if id := kind.Subscription.GetPlanPublicId(); id != "" {
				planPublicIDs = append(planPublicIDs, id)
			}
		}
	}
	ids, err := resolve(ctx, queries, tenant.ID, seriesPublicIDs, planPublicIDs, nil, nil)
	if err != nil {
		return Audience{}, err
	}

	audience := Audience{Version: Version, Conditions: make([]Condition, 0, len(conditions))}
	seen := make(map[Type]bool, len(conditions))
	for i, condition := range conditions {
		field := fmt.Sprintf("audience.conditions[%d]", i)
		converted, err := conditionFromProto(condition, field, tenant, ids)
		if err != nil {
			return Audience{}, err
		}
		if seen[converted.Type] {
			return Audience{}, invalid(field, errors.New("audience must name each condition once"))
		}
		seen[converted.Type] = true
		audience.Conditions = append(audience.Conditions, converted)
	}
	return audience, nil
}

func conditionFromProto(
	src *publiraadminv1.AnnouncementAudienceCondition,
	field string,
	tenant dbmodels.Tenant,
	ids publicIDs,
) (Condition, error) {
	seriesID := func(publicID, field string) (uuid.UUID, error) {
		id, ok := ids.seriesByPublicID[publicID]
		if !ok {
			return uuid.Nil, invalid(field, errors.New("series_public_id must name a series of the tenant"))
		}
		return id, nil
	}
	days := func(days int32, field string) (int32, error) {
		if days < 1 || days > MaxDays {
			return 0, invalid(field, fmt.Errorf("days must be 1 to %d", MaxDays))
		}
		return days, nil
	}

	switch kind := src.GetCondition().(type) {
	case *publiraadminv1.AnnouncementAudienceCondition_FollowsSeries_:
		id, err := seriesID(kind.FollowsSeries.GetSeriesPublicId(), field+".follows_series.series_public_id")
		return Condition{Type: TypeFollowsSeries, SeriesID: id}, err
	case *publiraadminv1.AnnouncementAudienceCondition_BoughtSeriesEpisode_:
		id, err := seriesID(kind.BoughtSeriesEpisode.GetSeriesPublicId(), field+".bought_series_episode.series_public_id")
		return Condition{Type: TypeBoughtSeriesEpisode, SeriesID: id}, err
	case *publiraadminv1.AnnouncementAudienceCondition_Subscription_:
		condition := Condition{Type: TypeSubscription}
		if publicID := kind.Subscription.GetPlanPublicId(); publicID != "" {
			id, ok := ids.planByPublicID[publicID]
			if !ok {
				return Condition{}, invalid(field+".subscription.plan_public_id", errors.New("plan_public_id must name a subscription plan of the tenant"))
			}
			condition.PlanID = &id
		}
		switch kind.Subscription.GetState() {
		case publiraadminv1.SubscriptionState_SUBSCRIPTION_STATE_ACTIVE:
			condition.State = SubscriptionActive
		case publiraadminv1.SubscriptionState_SUBSCRIPTION_STATE_ENDED:
			condition.State = SubscriptionEnded
		default:
			return Condition{}, invalid(field+".subscription.state", errors.New("state must be active or ended"))
		}
		return condition, nil
	case *publiraadminv1.AnnouncementAudienceCondition_NeverPurchased_:
		return Condition{Type: TypeNeverPurchased}, nil
	case *publiraadminv1.AnnouncementAudienceCondition_LastReadDaysAgo_:
		n, err := days(kind.LastReadDaysAgo.GetDays(), field+".last_read_days_ago.days")
		return Condition{Type: TypeLastReadDaysAgo, Days: n}, err
	case *publiraadminv1.AnnouncementAudienceCondition_SignedUpWithinDays_:
		n, err := days(kind.SignedUpWithinDays.GetDays(), field+".signed_up_within_days.days")
		return Condition{Type: TypeSignedUpWithinDays, Days: n}, err
	case *publiraadminv1.AnnouncementAudienceCondition_Locale_:
		code, err := locale.Normalize(kind.Locale.GetLocale())
		if err != nil || !slices.Contains(tenant.SupportedLocales, code) {
			return Condition{}, invalid(field+".locale.locale", errors.New("locale must be a locale the tenant offers"))
		}
		return Condition{Type: TypeLocale, Locale: code}, nil
	case *publiraadminv1.AnnouncementAudienceCondition_HasMobilePushDevice_:
		return Condition{Type: TypeHasMobilePushDevice}, nil
	default:
		return Condition{}, invalid(field, errors.New("condition must be set"))
	}
}

// PublicIDs is what [ToProto] names series and plans by: their public ids,
// read for every audience a page of announcements carries in one query each.
type PublicIDs struct {
	ids publicIDs
}

type publicIDs struct {
	seriesByPublicID map[string]uuid.UUID
	planByPublicID   map[string]uuid.UUID
	seriesPublicID   map[uuid.UUID]string
	planPublicID     map[uuid.UUID]string
}

// LookUpPublicIDs reads the public ids of every series and plan the audiences
// name.
func LookUpPublicIDs(ctx context.Context, queries Querier, tenantID uuid.UUID, audiences ...Audience) (PublicIDs, error) {
	var seriesIDs, planIDs []uuid.UUID
	for _, audience := range audiences {
		for _, condition := range audience.Conditions {
			if condition.SeriesID != uuid.Nil {
				seriesIDs = append(seriesIDs, condition.SeriesID)
			}
			if condition.PlanID != nil {
				planIDs = append(planIDs, *condition.PlanID)
			}
		}
	}
	ids, err := resolve(ctx, queries, tenantID, nil, nil, seriesIDs, planIDs)
	if err != nil {
		return PublicIDs{}, err
	}
	return PublicIDs{ids: ids}, nil
}

// ToProto answers a stored audience as the admin API sends it. A series or
// plan deleted since the announcement was posted is answered with an empty
// public id.
func ToProto(a Audience, names PublicIDs) *publiraadminv1.AnnouncementAudience {
	conditions := make([]*publiraadminv1.AnnouncementAudienceCondition, 0, len(a.Conditions))
	for _, c := range a.Conditions {
		out := &publiraadminv1.AnnouncementAudienceCondition{}
		switch c.Type {
		case TypeFollowsSeries:
			out.Condition = &publiraadminv1.AnnouncementAudienceCondition_FollowsSeries_{
				FollowsSeries: &publiraadminv1.AnnouncementAudienceCondition_FollowsSeries{
					SeriesPublicId: names.ids.seriesPublicID[c.SeriesID],
				},
			}
		case TypeBoughtSeriesEpisode:
			out.Condition = &publiraadminv1.AnnouncementAudienceCondition_BoughtSeriesEpisode_{
				BoughtSeriesEpisode: &publiraadminv1.AnnouncementAudienceCondition_BoughtSeriesEpisode{
					SeriesPublicId: names.ids.seriesPublicID[c.SeriesID],
				},
			}
		case TypeSubscription:
			subscription := &publiraadminv1.AnnouncementAudienceCondition_Subscription{
				State: publiraadminv1.SubscriptionState_SUBSCRIPTION_STATE_ACTIVE,
			}
			if c.State == SubscriptionEnded {
				subscription.State = publiraadminv1.SubscriptionState_SUBSCRIPTION_STATE_ENDED
			}
			if c.PlanID != nil {
				subscription.PlanPublicId = names.ids.planPublicID[*c.PlanID]
			}
			out.Condition = &publiraadminv1.AnnouncementAudienceCondition_Subscription_{Subscription: subscription}
		case TypeNeverPurchased:
			out.Condition = &publiraadminv1.AnnouncementAudienceCondition_NeverPurchased_{
				NeverPurchased: &publiraadminv1.AnnouncementAudienceCondition_NeverPurchased{},
			}
		case TypeLastReadDaysAgo:
			out.Condition = &publiraadminv1.AnnouncementAudienceCondition_LastReadDaysAgo_{
				LastReadDaysAgo: &publiraadminv1.AnnouncementAudienceCondition_LastReadDaysAgo{Days: c.Days},
			}
		case TypeSignedUpWithinDays:
			out.Condition = &publiraadminv1.AnnouncementAudienceCondition_SignedUpWithinDays_{
				SignedUpWithinDays: &publiraadminv1.AnnouncementAudienceCondition_SignedUpWithinDays{Days: c.Days},
			}
		case TypeLocale:
			out.Condition = &publiraadminv1.AnnouncementAudienceCondition_Locale_{
				Locale: &publiraadminv1.AnnouncementAudienceCondition_Locale{Locale: c.Locale},
			}
		case TypeHasMobilePushDevice:
			out.Condition = &publiraadminv1.AnnouncementAudienceCondition_HasMobilePushDevice_{
				HasMobilePushDevice: &publiraadminv1.AnnouncementAudienceCondition_HasMobilePushDevice{},
			}
		}
		conditions = append(conditions, out)
	}
	return &publiraadminv1.AnnouncementAudience{Conditions: conditions}
}

// resolve reads the tenant's series and plans named either way, skipping the
// query for a kind nothing names.
func resolve(
	ctx context.Context,
	queries Querier,
	tenantID uuid.UUID,
	seriesPublicIDs, planPublicIDs []string,
	seriesIDs, planIDs []uuid.UUID,
) (publicIDs, error) {
	ids := publicIDs{
		seriesByPublicID: map[string]uuid.UUID{},
		planByPublicID:   map[string]uuid.UUID{},
		seriesPublicID:   map[uuid.UUID]string{},
		planPublicID:     map[uuid.UUID]string{},
	}
	if len(seriesPublicIDs) > 0 || len(seriesIDs) > 0 {
		rows, err := queries.ListAnnouncementAudienceSeries(ctx, dbmodels.ListAnnouncementAudienceSeriesParams{
			TenantID:  tenantID,
			PublicIds: nonNil(seriesPublicIDs),
			Ids:       nonNil(seriesIDs),
		})
		if err != nil {
			return publicIDs{}, fmt.Errorf("list audience series: %w", err)
		}
		for _, row := range rows {
			ids.seriesByPublicID[row.PublicID] = row.ID
			ids.seriesPublicID[row.ID] = row.PublicID
		}
	}
	if len(planPublicIDs) > 0 || len(planIDs) > 0 {
		rows, err := queries.ListAnnouncementAudiencePlans(ctx, dbmodels.ListAnnouncementAudiencePlansParams{
			TenantID:  tenantID,
			PublicIds: nonNil(planPublicIDs),
			Ids:       nonNil(planIDs),
		})
		if err != nil {
			return publicIDs{}, fmt.Errorf("list audience plans: %w", err)
		}
		for _, row := range rows {
			ids.planByPublicID[row.PublicID] = row.ID
			ids.planPublicID[row.ID] = row.PublicID
		}
	}
	return ids, nil
}

// nonNil sends an empty array rather than NULL, under which = ANY matches
// nothing either way but reads as a mistake.
func nonNil[T any](values []T) []T {
	if values == nil {
		return []T{}
	}
	return values
}

func invalid(field string, err error) error {
	return &fielderr.Invalid{Field: field, Err: err}
}
