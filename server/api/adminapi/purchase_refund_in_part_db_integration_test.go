package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func (f *purchaseFixture) refundInPart(purchaseID uuid.UUID, amount int64) (*publiraadminv1.AdminPurchase, error) {
	res, err := f.client().RefundPurchaseInPart(f.ctx(), &publiraadminv1.RefundPurchaseInPartRequest{
		Tenant:     f.admin.tenantContext(),
		PurchaseId: purchaseID.String(),
		Amount:     amount,
		Reason:     purchaseTestRefundReason,
	})
	if err != nil {
		return nil, err
	}
	return res.Purchase, nil
}

func (f *purchaseFixture) get(t *testing.T, purchaseID uuid.UUID) *publiraadminv1.AdminPurchase {
	t.Helper()

	res, err := f.client().GetPurchase(f.ctx(), &publiraadminv1.GetPurchaseRequest{Tenant: f.admin.tenantContext(), PurchaseId: purchaseID.String()})
	if err != nil {
		t.Fatalf("GetPurchase: %v", err)
	}
	return res.Purchase
}

// recordRefundNotification records what Stripe's notification of a refund on
// paymentID reports, as the webhook does: total refunded on it so far.
func (f *purchaseFixture) recordRefundNotification(t *testing.T, paymentID string, total int32) {
	t.Helper()

	if _, err := dbmodels.New(f.env.PG.DB).RecordRefundOnPurchase(context.Background(), dbmodels.RecordRefundOnPurchaseParams{
		TenantID:          f.admin.Tenant.ID,
		Provider:          stripe.ID,
		ProviderPaymentID: paymentID,
		RefundedAmount:    sql.NullInt32{Int32: total, Valid: true},
		Currency:          sql.NullString{String: "JPY", Valid: true},
	}); err != nil {
		t.Fatalf("record the refund notification: %v", err)
	}
}

// recordFailedRefundNotification records what Stripe's notification that a
// refund on paymentID failed reports, as the webhook does: the total that stays
// refunded on it, and the key the failed refund was made under.
func (f *purchaseFixture) recordFailedRefundNotification(t *testing.T, paymentID string, total int32, key string) {
	t.Helper()

	if _, err := dbmodels.New(f.env.PG.DB).RecordFailedRefundOnPurchase(context.Background(), dbmodels.RecordFailedRefundOnPurchaseParams{
		TenantID:          f.admin.Tenant.ID,
		Provider:          stripe.ID,
		ProviderPaymentID: paymentID,
		Currency:          "JPY",
		RefundedAmount:    total,
		RefundKey:         key,
	}); err != nil {
		t.Fatalf("record the failed refund notification: %v", err)
	}
}

// refundKeys answers the idempotency keys of the refunds Stripe was asked for
// on paymentID, in order.
func (f *purchaseFixture) refundKeys(paymentID string) []string {
	var keys []string
	for _, refund := range f.stripe.Refunds() {
		if refund.PaymentIntentID == paymentID {
			keys = append(keys, refund.IdempotencyKey)
		}
	}
	return keys
}

// A refund in part asks Stripe for that amount and leaves the purchase open,
// showing the amount as requested until the notification records it. Asking
// again for it refunds nothing more, and refunding the rest afterwards is a
// refund in full under a key of its own.
func TestDBRefundPurchaseInPartLeavesThePurchaseOpen(t *testing.T) {
	t.Parallel()

	f := newPurchaseFixture(t)
	purchaseID := f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: time.Now().Add(-time.Hour), paymentID: "pi_part"})

	requested, err := f.refundInPart(purchaseID, 200)
	if err != nil {
		t.Fatalf("RefundPurchaseInPart: %v", err)
	}
	if requested.RevokedAt != "" || requested.RefundRequestedAmount != 200 || requested.RefundedAmount != 0 || !requested.Refundable {
		t.Fatalf("purchase = %+v, want open, refundable, and 200 requested", requested)
	}
	refunds := f.stripe.Refunds()
	if len(refunds) != 1 || refunds[0].PaymentIntentID != "pi_part" || refunds[0].Amount != 200 {
		t.Fatalf("refunds = %+v, want 200 back on pi_part", refunds)
	}
	f.assertRefundEntries(t, purchaseID, 1, 1, 0)
	if got := f.env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action IN ('purchase_refund_requested', 'purchase_refunded') AND target_id = $2 AND reason = $3",
		f.admin.Tenant.ID, purchaseID.String(), "amount=200 JPY; "+purchaseTestRefundReason,
	); got != 2 {
		t.Fatalf("audit entries carrying the amount and the reason = %d, want the request and the refund", got)
	}

	if _, err := f.refundInPart(purchaseID, 200); err != nil {
		t.Fatalf("RefundPurchaseInPart again: %v", err)
	}
	if got := f.stripe.RefundedTotal(purchaseTestSecretKey, "pi_part"); got != 200 {
		t.Fatalf("refunded total after a repeat = %d, want 200", got)
	}
	f.assertRefundEntries(t, purchaseID, 1, 1, 0)

	f.recordRefundNotification(t, "pi_part", 200)
	recorded := f.get(t, purchaseID)
	if recorded.RevokedAt != "" || recorded.RefundedAmount != 200 || recorded.RefundRequestedAmount != 0 || recorded.RefundedAt != "" {
		t.Fatalf("purchase after the notification = %+v, want open with 200 refunded and nothing requested", recorded)
	}

	rest, err := f.refundInPart(purchaseID, 300)
	if err != nil {
		t.Fatalf("RefundPurchaseInPart of the rest: %v", err)
	}
	if rest.RevocationReason != publiraadminv1.PurchaseRevocationReason_PURCHASE_REVOCATION_REASON_STAFF || rest.RefundRequestedAmount != 0 {
		t.Fatalf("purchase after refunding the rest = %+v, want revoked by staff", rest)
	}
	if got := f.stripe.RefundedTotal(purchaseTestSecretKey, "pi_part"); got != 500 {
		t.Fatalf("refunded total after the rest = %d, want 500", got)
	}
	if keys := f.refundKeys("pi_part"); len(keys) != 2 || keys[0] == keys[1] {
		t.Fatalf("idempotency keys = %v, want two different ones", keys)
	}
	f.assertRefundEntries(t, purchaseID, 2, 2, 0)
}

func TestDBRefundPurchaseInPartRefusesAnAmountOutsideWhatIsLeft(t *testing.T) {
	t.Parallel()

	f := newPurchaseFixture(t)
	purchaseID := f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: time.Now().Add(-time.Hour), paymentID: "pi_bounds"})
	f.stripe.SetRefunded(purchaseTestSecretKey, "pi_bounds", 100)
	f.recordRefundNotification(t, "pi_bounds", 100)

	for _, amount := range []int64{0, -1, 401} {
		_, err := f.refundInPart(purchaseID, amount)
		assertConnectCode(t, "RefundPurchaseInPart", err, connect.CodeInvalidArgument)
	}
	if refunds := f.stripe.Refunds(); len(refunds) != 0 {
		t.Fatalf("refunds = %+v, want none", refunds)
	}
	f.assertRefundEntries(t, purchaseID, 0, 0, 0)

	// What is left, the 400 Stripe has not refunded, is a refund in full.
	purchase, err := f.refundInPart(purchaseID, 400)
	if err != nil {
		t.Fatalf("RefundPurchaseInPart of what is left: %v", err)
	}
	if purchase.RevocationReason != publiraadminv1.PurchaseRevocationReason_PURCHASE_REVOCATION_REASON_STAFF {
		t.Fatalf("purchase = %+v, want revoked by staff", purchase)
	}
	if got := f.stripe.RefundedTotal(purchaseTestSecretKey, "pi_bounds"); got != 500 {
		t.Fatalf("refunded total = %d, want 500", got)
	}
}

// While a refund in part waits for the provider, only a request for the same
// amount goes on to it; another amount, the whole, and a refund in part of a
// purchase revoked for a refund of the whole are refused.
func TestDBRefundPurchaseInPartRefusesWhatWouldShareItsKey(t *testing.T) {
	t.Parallel()

	f := newPurchaseFixture(t)
	purchasedAt := time.Now().Add(-time.Hour)
	waiting := f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: purchasedAt, paymentID: "pi_waiting"})
	if _, err := f.refundInPart(waiting, 200); err != nil {
		t.Fatalf("RefundPurchaseInPart: %v", err)
	}
	_, err := f.refundInPart(waiting, 100)
	assertConnectCode(t, "RefundPurchaseInPart of another amount", err, connect.CodeFailedPrecondition)
	_, err = f.refund(waiting)
	assertConnectCode(t, "RefundPurchase while a refund in part waits", err, connect.CodeFailedPrecondition)
	if purchase := f.get(t, waiting); purchase.RevokedAt != "" || purchase.RefundRequestedAmount != 200 {
		t.Fatalf("purchase = %+v, want open with 200 still requested", purchase)
	}

	revoked := f.seedPurchase(t, purchaseSeed{reader: f.bob, episode: f.episodeB, purchasedAt: purchasedAt, paymentID: "pi_revoked", revocationReason: purchaseRevocationStaff})
	_, err = f.refundInPart(revoked, 200)
	assertConnectCode(t, "RefundPurchaseInPart of a purchase staff revoked", err, connect.CodeFailedPrecondition)

	f.env.PG.SeedCoinSettings(t, f.admin.Tenant.ID, testutil.CoinSettingsSeed{Names: map[string]string{"en": "Points"}})
	pack := f.env.PG.SeedCoinPack(t, f.admin.Tenant.ID, testutil.CoinPackSeed{PublicID: "PARTPACK0001", Coins: 1000, BonusCoins: 100, Price: 1000})
	packPurchase := f.seedCoinPackPurchase(t, f.alice, pack, "pi_part_pack")
	_, err = f.refundInPart(packPurchase, 200)
	assertConnectCode(t, "RefundPurchaseInPart of a pack", err, connect.CodeFailedPrecondition)

	if refunds := f.stripe.Refunds(); len(refunds) != 1 || refunds[0].PaymentIntentID != "pi_waiting" {
		t.Fatalf("refunds = %+v, want only the one on pi_waiting", refunds)
	}
}

// A refund in part Stripe refuses takes the request back, and asking again is
// a new attempt under a new idempotency key.
func TestDBRefundPurchaseInPartRetriesARefusedRefundUnderANewKey(t *testing.T) {
	t.Parallel()

	f := newPurchaseFixture(t)
	purchaseID := f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: time.Now().Add(-time.Hour), paymentID: "pi_part_failed"})
	f.stripe.FailNextRefund(purchaseTestSecretKey, "pi_part_failed")

	_, err := f.refundInPart(purchaseID, 200)
	assertConnectCode(t, "the first RefundPurchaseInPart", err, connect.CodeFailedPrecondition)
	if purchase := f.get(t, purchaseID); purchase.RefundRequestedAmount != 0 || !purchase.Refundable {
		t.Fatalf("purchase after a refused refund = %+v, want nothing requested and refundable", purchase)
	}

	if _, err := f.refundInPart(purchaseID, 300); err != nil {
		t.Fatalf("RefundPurchaseInPart again: %v", err)
	}
	if keys := f.refundKeys("pi_part_failed"); len(keys) != 2 || keys[0] == keys[1] {
		t.Fatalf("idempotency keys = %v, want two different ones", keys)
	}
	if got := f.stripe.RefundedTotal(purchaseTestSecretKey, "pi_part_failed"); got != 300 {
		t.Fatalf("refunded total = %d, want 300", got)
	}
	f.assertRefundEntries(t, purchaseID, 2, 1, 1)
}

// A refusal heard late, by a request of an attempt Stripe refused and that
// another request has taken back already, leaves the next attempt's request
// waiting under its key, even for the same total.
func TestDBRefundPurchaseInPartKeepsTheNextAttemptThroughALateRefusal(t *testing.T) {
	t.Parallel()

	f := newPurchaseFixture(t)
	purchaseID := f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: time.Now().Add(-time.Hour), paymentID: "pi_part_late_refusal"})
	f.stripe.FailNextRefund(purchaseTestSecretKey, "pi_part_late_refusal")
	_, err := f.refundInPart(purchaseID, 200)
	assertConnectCode(t, "the refused RefundPurchaseInPart", err, connect.CodeFailedPrecondition)
	if _, err := f.refundInPart(purchaseID, 200); err != nil {
		t.Fatalf("RefundPurchaseInPart of the next attempt: %v", err)
	}

	// The slower request of the refused attempt hearing the refusal.
	_, err = dbmodels.New(f.env.PG.DB).ClearStaffRefundInPart(context.Background(), dbmodels.ClearStaffRefundInPartParams{
		TenantID:       f.admin.Tenant.ID,
		ID:             purchaseID,
		Attempt:        0,
		RequestedTotal: 200,
		NextAttempt:    true,
	})
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("taking back the refused attempt's request: error = %v, want no row", err)
	}
	if purchase := f.get(t, purchaseID); purchase.RefundRequestedAmount != 200 {
		t.Fatalf("purchase after the late refusal = %+v, want 200 still requested", purchase)
	}
	if _, err := f.refundInPart(purchaseID, 200); err != nil {
		t.Fatalf("RefundPurchaseInPart again: %v", err)
	}
	if keys := f.refundKeys("pi_part_late_refusal"); len(keys) != 2 || keys[0] == keys[1] {
		t.Fatalf("idempotency keys = %v, want the refused attempt's and the waiting one's", keys)
	}
}

// A refund in part marked on the purchase but never asked of Stripe, as a
// request cut off between the two leaves it, is asked of Stripe when staff ask
// for the same amount again, once.
func TestDBRefundPurchaseInPartFinishesARefundAnEarlierRequestLeftUnasked(t *testing.T) {
	t.Parallel()

	f := newPurchaseFixture(t)
	purchaseID := f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: time.Now().Add(-time.Hour), paymentID: "pi_part_unasked"})
	// A refund recorded after the purchase was read counts toward the total
	// the mark stores, which is the one the mark answers.
	f.recordRefundNotification(t, "pi_part_unasked", 100)
	marked, err := dbmodels.New(f.env.PG.DB).RequestStaffRefundInPart(context.Background(), dbmodels.RequestStaffRefundInPartParams{
		TenantID: f.admin.Tenant.ID,
		ID:       purchaseID,
		Amount:   200,
	})
	if err != nil {
		t.Fatalf("mark the refund in part: %v", err)
	}
	if marked.StaffRefundRequestedTotal != 300 {
		t.Fatalf("requested total = %d, want 300", marked.StaffRefundRequestedTotal)
	}

	for range 2 {
		purchase, err := f.refundInPart(purchaseID, 200)
		if err != nil {
			t.Fatalf("RefundPurchaseInPart: %v", err)
		}
		if purchase.RefundRequestedAmount != 200 {
			t.Fatalf("purchase = %+v, want 200 still requested", purchase)
		}
	}
	if refunds := f.stripe.Refunds(); len(refunds) != 1 || refunds[0].Amount != 200 {
		t.Fatalf("refunds = %+v, want one of 200", refunds)
	}
	f.assertRefundEntries(t, purchaseID, 0, 0, 0)
}

// A refund in part the provider accepted and then failed, as its notification
// reports, stops waiting, and asking again is a new attempt under a new
// idempotency key.
func TestDBRefundPurchaseInPartStopsWaitingForARefundThatFailedLater(t *testing.T) {
	t.Parallel()

	f := newPurchaseFixture(t)
	purchaseID := f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: time.Now().Add(-time.Hour), paymentID: "pi_part_failed_later"})
	if _, err := f.refundInPart(purchaseID, 200); err != nil {
		t.Fatalf("RefundPurchaseInPart: %v", err)
	}
	f.stripe.SetRefunded(purchaseTestSecretKey, "pi_part_failed_later", 0)
	f.recordFailedRefundNotification(t, "pi_part_failed_later", 0, f.refundKeys("pi_part_failed_later")[0])
	if purchase := f.get(t, purchaseID); purchase.RefundRequestedAmount != 0 || purchase.RevokedAt != "" || !purchase.Refundable {
		t.Fatalf("purchase after its refund failed = %+v, want open, refundable, and nothing requested", purchase)
	}

	if _, err := f.refundInPart(purchaseID, 300); err != nil {
		t.Fatalf("RefundPurchaseInPart again: %v", err)
	}
	if keys := f.refundKeys("pi_part_failed_later"); len(keys) != 2 || keys[0] == keys[1] {
		t.Fatalf("idempotency keys = %v, want two different ones", keys)
	}
	if got := f.stripe.RefundedTotal(purchaseTestSecretKey, "pi_part_failed_later"); got != 300 {
		t.Fatalf("refunded total = %d, want 300", got)
	}
}

// The failure of another refund than the one a refund in part waits for, such
// as an earlier one whose notification arrives late or again, leaves it
// waiting under its key: a new attempt could refund its amount a second time
// while the provider still pays the one waiting. It waits for a total lowered
// by what the failed refund no longer adds, and only once.
func TestDBRefundPurchaseInPartKeepsWaitingThroughAnotherRefundsFailure(t *testing.T) {
	t.Parallel()

	f := newPurchaseFixture(t)
	purchaseID := f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: time.Now().Add(-time.Hour), paymentID: "pi_part_other_failed"})
	if _, err := f.refundInPart(purchaseID, 100); err != nil {
		t.Fatalf("RefundPurchaseInPart: %v", err)
	}
	f.recordRefundNotification(t, "pi_part_other_failed", 100)
	if _, err := f.refundInPart(purchaseID, 200); err != nil {
		t.Fatalf("RefundPurchaseInPart of another amount: %v", err)
	}

	earlier := f.refundKeys("pi_part_other_failed")[0]
	for range 2 {
		f.recordFailedRefundNotification(t, "pi_part_other_failed", 0, earlier)
		if purchase := f.get(t, purchaseID); purchase.RefundedAmount != 0 || purchase.RefundRequestedAmount != 200 {
			t.Fatalf("purchase after the earlier refund failed = %+v, want nothing refunded and 200 still requested", purchase)
		}
	}
	if _, err := f.refundInPart(purchaseID, 200); err != nil {
		t.Fatalf("RefundPurchaseInPart again: %v", err)
	}
	if keys := f.refundKeys("pi_part_other_failed"); len(keys) != 2 || keys[0] == keys[1] {
		t.Fatalf("idempotency keys = %v, want the earlier refund's and the waiting one's", keys)
	}

	f.recordRefundNotification(t, "pi_part_other_failed", 200)
	if purchase := f.get(t, purchaseID); purchase.RefundedAmount != 200 || purchase.RefundRequestedAmount != 0 {
		t.Fatalf("purchase after the notification = %+v, want 200 refunded and nothing requested", purchase)
	}
}
