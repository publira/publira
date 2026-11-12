// Package tenantwebhooks owes a tenant's webhook endpoints the events they
// subscribed to. A writer calls one of the Queue functions in the transaction
// that records the change, which writes one webhook_deliveries row per
// endpoint and one outbox event that sends it, so the change and what it owes
// commit or roll back together. The worker's handler (internal/outbox) sends
// it with [NewHTTPClient], signed by [Sign].
package tenantwebhooks

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base32"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// The events an endpoint can subscribe to, as the body's type names them and
// as tenant_webhook_endpoints.event_types stores them.
const (
	EventPurchaseCompleted      = "purchase.completed"
	EventPurchaseRefunded       = "purchase.refunded"
	EventReaderSignedUp         = "reader.signed_up"
	EventSubscriptionStarted    = "subscription.started"
	EventSubscriptionEnded      = "subscription.ended"
	EventEpisodePublished       = "episode.published"
	EventEpisodeUnpublished     = "episode.unpublished"
	EventCommentPosted          = "comment.posted"
	EventContactMessageReceived = "contact_message.received"
	EventCoinPackPurchased      = "coin_pack.purchased"
	EventTipReceived            = "tip.received"
	// EventTest is what SendTestWebhook owes one endpoint. No endpoint
	// subscribes to it.
	EventTest = "webhook.test"
)

// EventTypes are the events an endpoint can subscribe to, in the order the
// console lists them.
var EventTypes = []string{
	EventPurchaseCompleted,
	EventPurchaseRefunded,
	EventReaderSignedUp,
	EventSubscriptionStarted,
	EventSubscriptionEnded,
	EventEpisodePublished,
	EventEpisodeUnpublished,
	EventCommentPosted,
	EventContactMessageReceived,
	EventCoinPackPurchased,
	EventTipReceived,
}

// Subscribable reports whether an endpoint can subscribe to eventType.
func Subscribable(eventType string) bool {
	return slices.Contains(EventTypes, eventType)
}

// Queries is what owing an event reads and writes, on the querier of the
// transaction that records the change.
type Queries interface {
	ListTenantWebhookEndpointsForEvent(ctx context.Context, arg dbmodels.ListTenantWebhookEndpointsForEventParams) ([]uuid.UUID, error)
	InsertWebhookDelivery(ctx context.Context, arg dbmodels.InsertWebhookDeliveryParams) (uuid.UUID, error)
	InsertOutboxEvent(ctx context.Context, arg dbmodels.InsertOutboxEventParams) (dbmodels.OutboxEvent, error)
	GetTenantByID(ctx context.Context, id uuid.UUID) (dbmodels.Tenant, error)
	GetWebhookPurchase(ctx context.Context, arg dbmodels.GetWebhookPurchaseParams) (dbmodels.GetWebhookPurchaseRow, error)
	GetWebhookReader(ctx context.Context, arg dbmodels.GetWebhookReaderParams) (dbmodels.GetWebhookReaderRow, error)
	GetWebhookSubscription(ctx context.Context, arg dbmodels.GetWebhookSubscriptionParams) (dbmodels.GetWebhookSubscriptionRow, error)
	GetWebhookEpisode(ctx context.Context, arg dbmodels.GetWebhookEpisodeParams) (dbmodels.GetWebhookEpisodeRow, error)
	GetWebhookUnpublishedEpisode(ctx context.Context, arg dbmodels.GetWebhookUnpublishedEpisodeParams) (dbmodels.GetWebhookUnpublishedEpisodeRow, error)
	ListWebhookPublishedEpisodesOfSeries(ctx context.Context, arg dbmodels.ListWebhookPublishedEpisodesOfSeriesParams) ([]dbmodels.ListWebhookPublishedEpisodesOfSeriesRow, error)
	GetWebhookComment(ctx context.Context, arg dbmodels.GetWebhookCommentParams) (dbmodels.GetWebhookCommentRow, error)
	GetWebhookContactMessage(ctx context.Context, arg dbmodels.GetWebhookContactMessageParams) (dbmodels.GetWebhookContactMessageRow, error)
	GetWebhookContactMessageReply(ctx context.Context, arg dbmodels.GetWebhookContactMessageReplyParams) (dbmodels.GetWebhookContactMessageReplyRow, error)
	GetWebhookCoinPackPurchase(ctx context.Context, arg dbmodels.GetWebhookCoinPackPurchaseParams) (dbmodels.GetWebhookCoinPackPurchaseRow, error)
	GetWebhookTip(ctx context.Context, arg dbmodels.GetWebhookTipParams) (dbmodels.GetWebhookTipRow, error)
}

// OutboxEventType is the outbox event that sends one delivery.
const OutboxEventType = "webhook_delivery"

// MaxAttempts is how many attempts a delivery gets before it is given up. The
// wait between two doubles from a second to the outbox's hour cap, so twenty
// span about half a day, where the outbox's default budget spans minutes: an
// endpoint the tenant runs may well be down for longer than that.
const MaxAttempts = 20

// Delivery statuses, as webhook_deliveries.status stores them.
const (
	StatusPending   = "pending"
	StatusFailed    = "failed"
	StatusDelivered = "delivered"
	StatusDead      = "dead"
)

// MaxEndpoints is how many endpoints one tenant keeps.
const MaxEndpoints = 5

// OutboxPayload is the body of an [OutboxEventType] event.
type OutboxPayload struct {
	TenantID   string `json:"tenant_id"`
	DeliveryID string `json:"delivery_id"`
}

// Envelope is the body POSTed to an endpoint.
type Envelope struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	CreatedAt string `json:"created_at"`
	TenantID  string `json:"tenant_id"`
	Data      any    `json:"data"`
}

// Purchase is the data of [EventPurchaseCompleted] and
// [EventPurchaseRefunded]. The ids are the ones the admin API answers the same
// records by: PurchaseID is what AdminPurchaseService.GetPurchase takes.
type Purchase struct {
	PurchaseID string `json:"purchase_id"`
	// Kind is "purchase", "rental", or "tip".
	Kind string `json:"kind"`
	// Item is what was bought: "episode", "volume", "series_bundle" (the rest
	// of a series), or "coin_pack".
	Item            string `json:"item"`
	SeriesPublicID  string `json:"series_public_id,omitempty"`
	EpisodePublicID string `json:"episode_public_id,omitempty"`
	VolumePublicID  string `json:"volume_public_id,omitempty"`
	// The buyer; both empty once the reader has deleted their account.
	ReaderPublicID string `json:"reader_public_id"`
	ReaderEmail    string `json:"reader_email"`
	// What the reader paid, and the price before a promotion code took its
	// discount off, in the minor unit of Currency.
	Price          int32  `json:"price"`
	ListPrice      int32  `json:"list_price"`
	Currency       string `json:"currency"`
	RefundedAmount int32  `json:"refunded_amount"`
	PurchasedAt    string `json:"purchased_at"`
	ExpiresAt      string `json:"expires_at,omitempty"`
	RefundedAt     string `json:"refunded_at,omitempty"`
	// Provider is the payment provider, or "coins"; Store is "app_store" or
	// "google_play". Both are empty for a purchase a promotion code granted.
	Provider string `json:"provider,omitempty"`
	Store    string `json:"store,omitempty"`
	Test     bool   `json:"test"`
}

// Reader is the data of [EventReaderSignedUp].
type Reader struct {
	ReaderPublicID string `json:"reader_public_id"`
	Email          string `json:"email"`
	Name           string `json:"name"`
	EmailVerified  bool   `json:"email_verified"`
	SignedUpAt     string `json:"signed_up_at"`
}

// Subscription is the data of [EventSubscriptionStarted] and
// [EventSubscriptionEnded].
type Subscription struct {
	PlanPublicID string `json:"plan_public_id"`
	PlanName     string `json:"plan_name"`
	// The subscriber; both empty once the reader has deleted their account.
	ReaderPublicID string `json:"reader_public_id"`
	ReaderEmail    string `json:"reader_email"`
	// Provider is "stripe", "app_store", or "google_play".
	Provider          string `json:"provider"`
	Status            string `json:"status"`
	CurrentPeriodEnd  string `json:"current_period_end,omitempty"`
	CancelAtPeriodEnd bool   `json:"cancel_at_period_end"`
	StartedAt         string `json:"started_at"`
	Test              bool   `json:"test"`
}

// Episode is the data of [EventEpisodePublished]. It names the episode and its
// series by the public ids the admin API answers them by, and carries no
// reader's data.
type Episode struct {
	EpisodePublicID string `json:"episode_public_id"`
	SeriesPublicID  string `json:"series_public_id"`
	// Title is the episode's title in the tenant's default language.
	Title       string `json:"title"`
	PublishedAt string `json:"published_at"`
}

// What an [EventEpisodeUnpublished] says was taken off the site, as
// [EpisodeWithdrawal.Withdrawn] names it.
const (
	// WithdrawnEpisode is the episode itself, taken back to a draft or given a
	// time again.
	WithdrawnEpisode = "episode"
	// WithdrawnSeries is the episode's series, hidden with every episode
	// published in it.
	WithdrawnSeries = "series"
)

// EpisodeWithdrawal is the data of [EventEpisodeUnpublished]. It names the
// episode and its series by the public ids the admin API answers them by, and
// carries no reader's data.
type EpisodeWithdrawal struct {
	EpisodePublicID string `json:"episode_public_id"`
	SeriesPublicID  string `json:"series_public_id"`
	// Withdrawn is [WithdrawnEpisode] or [WithdrawnSeries].
	Withdrawn string `json:"withdrawn"`
}

// Comment is the data of [EventCommentPosted]. It names the comment, its
// episode, and its series by their public ids, and its writer by their public
// id and display name, never by their address.
type Comment struct {
	CommentPublicID string `json:"comment_public_id"`
	EpisodePublicID string `json:"episode_public_id"`
	SeriesPublicID  string `json:"series_public_id"`
	Body            string `json:"body"`
	AuthorPublicID  string `json:"author_public_id"`
	// AuthorName is the writer's display name, as stored on their account.
	AuthorName  string `json:"author_name"`
	PublishedAt string `json:"published_at"`
}

// ContactMessage is the data of [EventContactMessageReceived]: a contact message a
// reader sent, or a reply they mailed to one. It names the reader by the
// public id and display name of the account that sent the message, both empty
// when they were not signed in or have deleted the account since, and never by
// the address they asked to be answered at.
type ContactMessage struct {
	MessagePublicID string `json:"message_public_id"`
	// Subject is the message's, empty when the reader gave it none. A reply
	// carries the subject of the message it replies to.
	Subject string `json:"subject"`
	// Body is what this event announces: the message, or the reply.
	Body string `json:"body"`
	// Reply is false for the message the reader sent through the contact
	// form, and true for a reply they mailed to an answer.
	Reply          bool   `json:"reply"`
	ReaderPublicID string `json:"reader_public_id"`
	ReaderName     string `json:"reader_name"`
	ReceivedAt     string `json:"received_at"`
}

// CoinPackPurchase is the data of [EventCoinPackPurchased]. PurchaseID is the
// same purchase the [EventPurchaseCompleted] of the purchase names, and the
// coins are what the purchase granted, as the reader was shown them when the
// checkout or the store's payment sheet opened, however the pack has been
// edited since.
type CoinPackPurchase struct {
	PurchaseID       string `json:"purchase_id"`
	CoinPackPublicID string `json:"coin_pack_public_id"`
	Coins            int32  `json:"coins"`
	BonusCoins       int32  `json:"bonus_coins"`
	// What the reader paid, in the minor unit of Currency.
	Price    int32  `json:"price"`
	Currency string `json:"currency"`
	// The buyer; empty once the reader has deleted their account.
	ReaderPublicID string `json:"reader_public_id"`
	PurchasedAt    string `json:"purchased_at"`
	// Provider is the payment provider; Store is "app_store" or
	// "google_play". One of the two is set.
	Provider string `json:"provider,omitempty"`
	Store    string `json:"store,omitempty"`
	Test     bool   `json:"test"`
}

// Tip is the data of [EventTipReceived]. PurchaseID is the same purchase the
// [EventPurchaseCompleted] of the tip names, and CreatorPublicIDs are the
// Authors the episode credited when the tip was recorded, each once and in the
// order of their credits.
type Tip struct {
	PurchaseID      string `json:"purchase_id"`
	EpisodePublicID string `json:"episode_public_id"`
	SeriesPublicID  string `json:"series_public_id"`
	// What the reader paid, in the minor unit of Currency.
	Price    int32  `json:"price"`
	Currency string `json:"currency"`
	// CreatorPublicIDs is empty, never null, for an episode that credits no
	// one.
	CreatorPublicIDs []string `json:"creator_public_ids"`
	// The reader who tipped; empty once they have deleted their account.
	ReaderPublicID string `json:"reader_public_id"`
	PurchasedAt    string `json:"purchased_at"`
	// Provider is the payment provider; Store is "app_store" or
	// "google_play". One of the two is set.
	Provider string `json:"provider,omitempty"`
	Store    string `json:"store,omitempty"`
	Test     bool   `json:"test"`
}

// QueuePurchaseCompleted owes the endpoints that subscribed to it the event of
// a purchase just recorded. A purchase is completed once, so the event is
// owed once however often the writer runs.
func QueuePurchaseCompleted(ctx context.Context, q Queries, tenantID, purchaseID uuid.UUID) error {
	return queue(ctx, q, tenantID, EventPurchaseCompleted, EventPurchaseCompleted+":"+purchaseID.String(), func() (any, error) {
		return purchaseData(ctx, q, tenantID, purchaseID)
	})
}

// QueuePurchaseRefunded owes the event of a refund just recorded on purchase,
// the row as the write that recorded it returned it. Its refunded total tells
// one refund in part from the next, and a notification delivered twice from a
// second refund. The event carries the refund as that row has it rather than
// as a later read would: a refund recorded outside a transaction can be
// followed by another before the purchase is read again, and each event has
// to say what its own refund left.
func QueuePurchaseRefunded(ctx context.Context, q Queries, purchase dbmodels.Purchase) error {
	key := fmt.Sprintf("%s:%s:%d:%t", EventPurchaseRefunded, purchase.ID, purchase.RefundedAmount.Int32, purchase.RefundedAt.Valid)
	return queue(ctx, q, purchase.TenantID, EventPurchaseRefunded, key, func() (any, error) {
		data, err := purchaseData(ctx, q, purchase.TenantID, purchase.ID)
		if err != nil {
			return nil, err
		}
		data.RefundedAmount = purchase.RefundedAmount.Int32
		data.RefundedAt = formatNullTime(purchase.RefundedAt)
		return data, nil
	})
}

// QueueCoinPackPurchased owes the event of a coin pack purchase just recorded,
// called in the transaction that records it once the coins it grants are
// recorded. A purchase is recorded once, so the event is owed once however
// often the payment is confirmed.
func QueueCoinPackPurchased(ctx context.Context, q Queries, tenantID, purchaseID uuid.UUID) error {
	return queue(ctx, q, tenantID, EventCoinPackPurchased, EventCoinPackPurchased+":"+purchaseID.String(), func() (any, error) {
		row, err := q.GetWebhookCoinPackPurchase(ctx, dbmodels.GetWebhookCoinPackPurchaseParams{TenantID: tenantID, ID: purchaseID})
		if err != nil {
			return nil, fmt.Errorf("read the coin pack purchase of a webhook event: %w", err)
		}
		return CoinPackPurchase{
			PurchaseID:       row.ID.String(),
			CoinPackPublicID: row.CoinPackPublicID,
			Coins:            row.Coins,
			BonusCoins:       row.BonusCoins,
			Price:            row.PriceAtPurchase,
			Currency:         row.Currency,
			ReaderPublicID:   row.ReaderPublicID.String,
			PurchasedAt:      formatTime(row.PurchasedAt),
			Provider:         row.Provider.String,
			Store:            row.Store.String,
			Test:             row.IsTest,
		}, nil
	})
}

// QueueTipReceived owes the event of a tip just recorded, called in the
// transaction that records it. A tip is recorded once, so the event is owed
// once however often the payment is confirmed.
func QueueTipReceived(ctx context.Context, q Queries, tenantID, purchaseID uuid.UUID) error {
	return queue(ctx, q, tenantID, EventTipReceived, EventTipReceived+":"+purchaseID.String(), func() (any, error) {
		row, err := q.GetWebhookTip(ctx, dbmodels.GetWebhookTipParams{TenantID: tenantID, ID: purchaseID})
		if err != nil {
			return nil, fmt.Errorf("read the tip of a webhook event: %w", err)
		}
		creators := row.CreatorPublicIds
		if creators == nil {
			creators = []string{}
		}
		return Tip{
			PurchaseID:       row.ID.String(),
			EpisodePublicID:  row.EpisodePublicID,
			SeriesPublicID:   row.SeriesPublicID,
			Price:            row.PriceAtPurchase,
			Currency:         row.Currency,
			CreatorPublicIDs: creators,
			ReaderPublicID:   row.ReaderPublicID.String,
			PurchasedAt:      formatTime(row.PurchasedAt),
			Provider:         row.Provider.String,
			Store:            row.Store.String,
			Test:             row.IsTest,
		}, nil
	})
}

// QueueReaderSignedUp owes the event of a reader's account just opened.
func QueueReaderSignedUp(ctx context.Context, q Queries, tenantID, userID uuid.UUID) error {
	return queue(ctx, q, tenantID, EventReaderSignedUp, EventReaderSignedUp+":"+userID.String(), func() (any, error) {
		row, err := q.GetWebhookReader(ctx, dbmodels.GetWebhookReaderParams{TenantID: uuid.NullUUID{UUID: tenantID, Valid: true}, ID: userID})
		if err != nil {
			return nil, fmt.Errorf("read the reader of a webhook event: %w", err)
		}
		return Reader{
			ReaderPublicID: row.PublicID,
			Email:          row.Email,
			Name:           row.Name,
			EmailVerified:  row.EmailVerifiedAt.Valid,
			SignedUpAt:     formatTime(row.CreatedAt),
		}, nil
	})
}

// QueueSubscriptionChange owes the event a subscription's change of status
// makes, if it makes one: starting to be billed when it was not, which a
// subscription recorded for the first time in a billed status does too, or
// stopping. A change between two billed statuses, or two that are not, owes
// nothing. The caller compares the status before the write with the one after
// it, so a notification delivered twice changes nothing the second time.
func QueueSubscriptionChange(ctx context.Context, q Queries, tenantID, subscriptionID uuid.UUID, wasBilled, billed bool) error {
	var eventType string
	switch {
	case !wasBilled && billed:
		eventType = EventSubscriptionStarted
	case wasBilled && !billed:
		eventType = EventSubscriptionEnded
	default:
		return nil
	}
	// A subscription may stop and start again, a store's especially, so the key
	// names this change rather than the subscription alone.
	key := eventType + ":" + subscriptionID.String() + ":" + uuid.Must(uuid.NewV7()).String()
	return queue(ctx, q, tenantID, eventType, key, func() (any, error) {
		row, err := q.GetWebhookSubscription(ctx, dbmodels.GetWebhookSubscriptionParams{TenantID: tenantID, ID: subscriptionID})
		if err != nil {
			return nil, fmt.Errorf("read the subscription of a webhook event: %w", err)
		}
		return Subscription{
			PlanPublicID:      row.PlanPublicID,
			PlanName:          row.PlanName,
			ReaderPublicID:    row.ReaderPublicID.String,
			ReaderEmail:       row.ReaderEmail.String,
			Provider:          row.Provider,
			Status:            row.Status,
			CurrentPeriodEnd:  formatNullTime(row.CurrentPeriodEnd),
			CancelAtPeriodEnd: row.CancelAtPeriodEnd,
			StartedAt:         formatTime(row.CreatedAt),
			Test:              row.IsTest,
		}, nil
	})
}

// QueueEpisodePublished owes the event of an episode just published, called in
// the transaction that publishes it. The key names the publication by its
// instant beside the episode, so an episode taken back to a draft and
// published again owes the event again, while the same publication read twice
// owes it once.
func QueueEpisodePublished(ctx context.Context, q Queries, tenantID, episodeID uuid.UUID) error {
	return queueKeyed(ctx, q, tenantID, EventEpisodePublished, func() (string, any, error) {
		row, err := q.GetWebhookEpisode(ctx, dbmodels.GetWebhookEpisodeParams{TenantID: tenantID, ID: episodeID})
		if err != nil {
			return "", nil, fmt.Errorf("read the episode of a webhook event: %w", err)
		}
		key := EventEpisodePublished + ":" + episodeID.String() + ":" + row.PublishedAt.UTC().Format(time.RFC3339Nano)
		return key, Episode{
			EpisodePublicID: row.EpisodePublicID,
			SeriesPublicID:  row.SeriesPublicID,
			Title:           row.Title,
			PublishedAt:     formatTime(row.PublishedAt),
		}, nil
	})
}

// QueueEpisodeUnpublished owes the event of a published episode just taken off
// the site, called in the transaction that takes it off. publishedAt is the
// instant of the publication it takes back, which names it in the key beside
// the episode: a publication is taken back once, so two saves that both saw
// the episode published owe one event between them.
func QueueEpisodeUnpublished(ctx context.Context, q Queries, tenantID, episodeID uuid.UUID, publishedAt time.Time) error {
	return queueKeyed(ctx, q, tenantID, EventEpisodeUnpublished, func() (string, any, error) {
		row, err := q.GetWebhookUnpublishedEpisode(ctx, dbmodels.GetWebhookUnpublishedEpisodeParams{TenantID: tenantID, ID: episodeID})
		if err != nil {
			return "", nil, fmt.Errorf("read the episode of a webhook event: %w", err)
		}
		key := EventEpisodeUnpublished + ":" + episodeID.String() + ":" + publishedAt.UTC().Format(time.RFC3339Nano)
		return key, EpisodeWithdrawal{
			EpisodePublicID: row.EpisodePublicID,
			SeriesPublicID:  row.SeriesPublicID,
			Withdrawn:       WithdrawnEpisode,
		}, nil
	})
}

// QueueSeriesUnpublished owes the event of every episode published in a series
// just hidden, one each, called in the transaction that hides it. publication
// is an instant naming the publication of the series it ends, which keys each
// event beside its episode the way [QueueEpisodeUnpublished] keys the
// episode's own.
func QueueSeriesUnpublished(ctx context.Context, q Queries, tenantID, seriesID uuid.UUID, publication time.Time) error {
	return queueAll(ctx, q, tenantID, EventEpisodeUnpublished, func() ([]keyedEvent, error) {
		rows, err := q.ListWebhookPublishedEpisodesOfSeries(ctx, dbmodels.ListWebhookPublishedEpisodesOfSeriesParams{TenantID: tenantID, SeriesID: seriesID})
		if err != nil {
			return nil, fmt.Errorf("list the episodes of a webhook event: %w", err)
		}
		events := make([]keyedEvent, 0, len(rows))
		for _, row := range rows {
			events = append(events, keyedEvent{
				key: EventEpisodeUnpublished + ":" + row.EpisodeID.String() + ":series:" + publication.UTC().Format(time.RFC3339Nano),
				data: EpisodeWithdrawal{
					EpisodePublicID: row.EpisodePublicID,
					SeriesPublicID:  row.SeriesPublicID,
					Withdrawn:       WithdrawnSeries,
				},
			})
		}
		return events, nil
	})
}

// QueueCommentPosted owes the event of a reader's comment just made visible,
// called in the transaction that makes it so: posting it where comments need
// no approval, or approving it. A comment becomes visible for the first time
// once, so the key names the comment alone: restoring one staff hid shows
// again a comment already announced, and does not call this.
func QueueCommentPosted(ctx context.Context, q Queries, tenantID, commentID uuid.UUID) error {
	return queue(ctx, q, tenantID, EventCommentPosted, EventCommentPosted+":"+commentID.String(), func() (any, error) {
		row, err := q.GetWebhookComment(ctx, dbmodels.GetWebhookCommentParams{TenantID: tenantID, ID: commentID})
		if err != nil {
			return nil, fmt.Errorf("read the comment of a webhook event: %w", err)
		}
		return Comment{
			CommentPublicID: row.CommentPublicID,
			EpisodePublicID: row.EpisodePublicID,
			SeriesPublicID:  row.SeriesPublicID,
			Body:            row.Body,
			AuthorPublicID:  row.AuthorPublicID,
			AuthorName:      row.AuthorName,
			PublishedAt:     formatTime(row.PublishedAt),
		}, nil
	})
}

// QueueContactMessageReceived owes the event of a contact message just
// stored, called in the transaction that stores it.
func QueueContactMessageReceived(ctx context.Context, q Queries, tenantID, messageID uuid.UUID) error {
	return queue(ctx, q, tenantID, EventContactMessageReceived, EventContactMessageReceived+":"+messageID.String(), func() (any, error) {
		row, err := q.GetWebhookContactMessage(ctx, dbmodels.GetWebhookContactMessageParams{TenantID: tenantID, ID: messageID})
		if err != nil {
			return nil, fmt.Errorf("read the contact message of a webhook event: %w", err)
		}
		return ContactMessage{
			MessagePublicID: row.MessagePublicID,
			Subject:         row.Subject.String,
			Body:            row.Body,
			ReaderPublicID:  row.ReaderPublicID.String,
			ReaderName:      row.ReaderName.String,
			ReceivedAt:      formatTime(row.CreatedAt),
		}, nil
	})
}

// QueueContactMessageReplyReceived owes the event of a reader's reply just
// stored under a contact message, called in the transaction that stores it.
// The key names the entry, so each reply is an event of its own and a mail
// delivered twice, which stores no second entry, owes none.
func QueueContactMessageReplyReceived(ctx context.Context, q Queries, tenantID, entryID uuid.UUID) error {
	return queue(ctx, q, tenantID, EventContactMessageReceived, EventContactMessageReceived+":reply:"+entryID.String(), func() (any, error) {
		row, err := q.GetWebhookContactMessageReply(ctx, dbmodels.GetWebhookContactMessageReplyParams{TenantID: tenantID, ID: entryID})
		if err != nil {
			return nil, fmt.Errorf("read the contact message reply of a webhook event: %w", err)
		}
		return ContactMessage{
			MessagePublicID: row.MessagePublicID,
			Subject:         row.Subject.String,
			Body:            row.Body,
			Reply:           true,
			ReaderPublicID:  row.ReaderPublicID.String,
			ReaderName:      row.ReaderName.String,
			ReceivedAt:      formatTime(row.CreatedAt),
		}, nil
	})
}

// QueueTest owes one endpoint a [EventTest] event, whether it is enabled or
// subscribed to anything, and answers the delivery's id.
func QueueTest(ctx context.Context, q Queries, tenantID, endpointID uuid.UUID) (uuid.UUID, error) {
	tenant, err := q.GetTenantByID(ctx, tenantID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("read the tenant of a webhook event: %w", err)
	}
	key := EventTest + ":" + uuid.Must(uuid.NewV7()).String()
	envelope, payload, err := envelopeFor(tenant, EventTest, key, struct{}{})
	if err != nil {
		return uuid.Nil, err
	}
	id, owed, err := owe(ctx, q, tenantID, endpointID, envelope, payload)
	if err != nil {
		return uuid.Nil, err
	}
	if !owed {
		return uuid.Nil, errors.New("a test event's id is already owed to the endpoint")
	}
	return id, nil
}

// QueueResend owes a delivery's outbox event again, under a key of its own so
// the event a delivery was first sent by does not swallow it.
func QueueResend(ctx context.Context, q Queries, tenantID, deliveryID uuid.UUID) error {
	return insertOutboxEvent(ctx, q, tenantID, deliveryID, OutboxEventType+":"+deliveryID.String()+":resend:"+uuid.Must(uuid.NewV7()).String())
}

// queue owes eventType to every endpoint of the tenant's that subscribed to it.
// data is read only when one has, so a tenant without webhooks pays one indexed
// read for every change it records.
func queue(ctx context.Context, q Queries, tenantID uuid.UUID, eventType, key string, data func() (any, error)) error {
	return queueKeyed(ctx, q, tenantID, eventType, func() (string, any, error) {
		body, err := data()
		return key, body, err
	})
}

// queueKeyed is [queue] for an event whose key is read with its data.
func queueKeyed(ctx context.Context, q Queries, tenantID uuid.UUID, eventType string, data func() (string, any, error)) error {
	return queueAll(ctx, q, tenantID, eventType, func() ([]keyedEvent, error) {
		key, body, err := data()
		if err != nil {
			return nil, err
		}
		return []keyedEvent{{key: key, data: body}}, nil
	})
}

// keyedEvent is one event [queueAll] owes, with the key that names it.
type keyedEvent struct {
	key  string
	data any
}

// queueAll is [queue] for a change that owes several events of one type, read
// together once an endpoint has subscribed to them.
func queueAll(ctx context.Context, q Queries, tenantID uuid.UUID, eventType string, data func() ([]keyedEvent, error)) error {
	endpoints, err := q.ListTenantWebhookEndpointsForEvent(ctx, dbmodels.ListTenantWebhookEndpointsForEventParams{
		TenantID:  tenantID,
		EventType: eventType,
	})
	if err != nil {
		return fmt.Errorf("list the webhook endpoints owed %s: %w", eventType, err)
	}
	if len(endpoints) == 0 {
		return nil
	}
	tenant, err := q.GetTenantByID(ctx, tenantID)
	if err != nil {
		return fmt.Errorf("read the tenant of a webhook event: %w", err)
	}
	events, err := data()
	if err != nil {
		return err
	}
	for _, event := range events {
		envelope, payload, err := envelopeFor(tenant, eventType, event.key, event.data)
		if err != nil {
			return err
		}
		for _, endpointID := range endpoints {
			if _, _, err := owe(ctx, q, tenantID, endpointID, envelope, payload); err != nil {
				return err
			}
		}
	}
	return nil
}

func envelopeFor(tenant dbmodels.Tenant, eventType, key string, data any) (Envelope, []byte, error) {
	envelope := Envelope{
		ID:        EventID(tenant.ID, key),
		Type:      eventType,
		CreatedAt: formatTime(time.Now()),
		TenantID:  tenant.PublicID,
		Data:      data,
	}
	payload, err := json.Marshal(envelope)
	if err != nil {
		return Envelope{}, nil, fmt.Errorf("marshal a webhook event: %w", err)
	}
	return envelope, payload, nil
}

// owe writes the delivery of envelope to one endpoint and the outbox event
// that sends it, in one statement so that a writer outside a transaction
// cannot leave one without the other, and reports false for an event already
// owed to the endpoint.
func owe(ctx context.Context, q Queries, tenantID, endpointID uuid.UUID, envelope Envelope, payload []byte) (uuid.UUID, bool, error) {
	id, err := q.InsertWebhookDelivery(ctx, dbmodels.InsertWebhookDeliveryParams{
		OutboxEventID: uuid.Must(uuid.NewV7()),
		ID:            uuid.Must(uuid.NewV7()),
		TenantID:      tenantID,
		EndpointID:    endpointID,
		EventType:     envelope.Type,
		EventID:       envelope.ID,
		Payload:       payload,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, false, nil
	}
	if err != nil {
		return uuid.Nil, false, fmt.Errorf("owe a webhook delivery: %w", err)
	}
	return id, true, nil
}

func insertOutboxEvent(ctx context.Context, q Queries, tenantID, deliveryID uuid.UUID, idempotencyKey string) error {
	payload, err := json.Marshal(OutboxPayload{TenantID: tenantID.String(), DeliveryID: deliveryID.String()})
	if err != nil {
		return fmt.Errorf("marshal a webhook delivery event: %w", err)
	}
	_, err = q.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      OutboxEventType,
		Payload:        payload,
		IdempotencyKey: idempotencyKey,
		AvailableAt:    time.Now().UTC(),
	})
	// The insert is a no-op for a key already queued, and :one then returns no
	// rows.
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("queue a webhook delivery: %w", err)
	}
	return nil
}

func purchaseData(ctx context.Context, q Queries, tenantID, purchaseID uuid.UUID) (Purchase, error) {
	row, err := q.GetWebhookPurchase(ctx, dbmodels.GetWebhookPurchaseParams{TenantID: tenantID, ID: purchaseID})
	if err != nil {
		return Purchase{}, fmt.Errorf("read the purchase of a webhook event: %w", err)
	}
	item := "episode"
	switch {
	case row.CoinPack:
		item = "coin_pack"
	case row.SeriesBundle:
		item = "series_bundle"
	case row.VolumePublicID.Valid:
		item = "volume"
	}
	return Purchase{
		PurchaseID:      row.ID.String(),
		Kind:            row.Kind,
		Item:            item,
		SeriesPublicID:  row.SeriesPublicID,
		EpisodePublicID: row.EpisodePublicID.String,
		VolumePublicID:  row.VolumePublicID.String,
		ReaderPublicID:  row.ReaderPublicID.String,
		ReaderEmail:     row.ReaderEmail.String,
		Price:           row.PriceAtPurchase,
		ListPrice:       row.ListPrice,
		Currency:        row.Currency,
		RefundedAmount:  row.RefundedAmount,
		PurchasedAt:     formatTime(row.PurchasedAt),
		ExpiresAt:       formatNullTime(row.ExpiresAt),
		RefundedAt:      formatNullTime(row.RefundedAt),
		Provider:        row.Provider.String,
		Store:           row.Store.String,
		Test:            row.IsTest,
	}, nil
}

// EventID is the id a receiver sees for the event key names: the same for
// every endpoint and every attempt, and for the same change recorded twice.
// It is derived from the key rather than random so that the second recording
// is recognized as the first, and hashed so that it carries no id of the
// database's own.
func EventID(tenantID uuid.UUID, key string) string {
	sum := sha256.Sum256([]byte(tenantID.String() + "\x00" + key))
	return "evt_" + lowerBase32(sum[:])[:26]
}

// NewSecret makes an endpoint's signing secret.
func NewSecret() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate a webhook secret: %w", err)
	}
	return "whsec_" + lowerBase32(raw), nil
}

func lowerBase32(raw []byte) string {
	return strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw))
}

func formatTime(at time.Time) string {
	return at.UTC().Format(time.RFC3339)
}

func formatNullTime(at sql.NullTime) string {
	if !at.Valid {
		return ""
	}
	return formatTime(at.Time)
}
