// Package paymentreconciliation compares what a payment provider or a store
// recorded over a period of a tenant's days with the purchases the install
// recorded, and keeps the lines that match nothing on the other side.
//
// A Tenant admin starts a run from the console, which writes a row of
// payment_reconciliations for each source the tenant has ready; the worker
// runs it here, reading the source and writing the findings, and changes
// nothing in the source or in purchases.
package paymentreconciliation

import (
	"cmp"
	"slices"
	"time"

	"github.com/google/uuid"
)

// The kinds of finding, as payment_reconciliation_findings.kind spells them.
const (
	KindRecordUnmatched   = "record_unmatched"
	KindPurchaseUnmatched = "purchase_unmatched"
	KindAmountMismatch    = "amount_mismatch"
	KindHeldRefund        = "held_refund"
	KindHeldDispute       = "held_dispute"
)

// Margin is how far before and after the period a source's records are read
// and matched. A purchase is dated when the install confirmed it, which
// follows the payment by however long its notification took, so a payment
// taken on the last evening of the period may belong to a purchase dated the
// next morning. Read over the margin, the two still meet; neither side's lines
// outside the period are reported.
const Margin = 24 * time.Hour

// Record is one payment the source recorded.
type Record struct {
	// PaymentID is the source's id of the payment, as the purchase stores it.
	PaymentID string
	Test      bool
	// OccurredAt is when the source took the payment.
	OccurredAt time.Time
	// Amount is what the source charged and RefundedAmount what it has
	// refunded, in the minor unit of Currency. Currency is empty for a source
	// that reports no amount, which Refunded still says whether it refunded.
	Amount         int64
	Currency       string
	RefundedAmount int64
	Refunded       bool
}

// Purchase is one of the install's purchases through the source.
type Purchase struct {
	ID uuid.UUID
	// PaymentID is the source's id of the payment, empty on a purchase that
	// charged nothing.
	PaymentID string
	// Amount is what the reader paid and RefundedAmount what has been
	// refunded, in the minor unit of Currency.
	Amount         int64
	RefundedAmount int64
	Currency       string
	Test           bool
	PurchasedAt    time.Time
	// ProductID is the store product the purchase was bought as, which
	// Google Play looks a purchase up by.
	ProductID string
}

// Hold is a refund or a dispute that arrived for a payment no purchase named.
type Hold struct {
	// Kind is KindHeldRefund or KindHeldDispute.
	Kind      string
	PaymentID string
	// RefundedAmount is what the refund reported refunded, in the minor unit
	// of Currency, which is empty when it reported no amount.
	RefundedAmount int64
	Currency       string
	ReceivedAt     time.Time
}

// Finding is one line of a run.
type Finding struct {
	Kind string
	Test bool
	// PaymentID is the source's id of the payment.
	PaymentID string
	// Purchase is the purchase the line is about, if any, and Record the
	// source's payment, if any.
	Purchase *Purchase
	Record   *Record
	// Hold is the hold the line is about, on a hold's line.
	Hold       *Hold
	OccurredAt time.Time
}

// Input is what a run matches.
type Input struct {
	// From and To bound the period, half-open.
	From, To time.Time
	// Records are the source's payments read over the period widened by
	// Margin on both sides.
	Records []Record
	// Purchases are the install's purchases through the source in the period.
	Purchases []Purchase
	// Named are the purchases the records name, wherever they fall.
	Named []Purchase
	// Excluded are the ids of payments that paid for something other than a
	// purchase, such as a plan's invoice, which a run of purchases leaves out.
	Excluded map[string]bool
	// Holds are the refunds and disputes held since before the period began.
	Holds []Hold
	// StrictCurrency makes a record charged in a currency other than its
	// purchase's a mismatch, as it is for a web provider, which charges in the
	// tenant's currency. A store charges in the buyer's, so for a store an
	// amount is compared only when the two currencies agree, and otherwise
	// only whether the payment was refunded.
	StrictCurrency bool
}

// Result is what a run found.
type Result struct {
	// RecordCount is the source's payments in the period, PurchaseCount the
	// purchases in it, and MatchedCount the pairs of the two that met,
	// whichever side of the period's edge either fell on.
	RecordCount   int
	PurchaseCount int
	MatchedCount  int
	Findings      []Finding
}

type key struct {
	test      bool
	paymentID string
}

// Match compares in's two sides. A record and a purchase meet when they name
// the same payment in the same mode, so a test payment never meets a live
// purchase.
func Match(in Input) Result {
	inPeriod := func(at time.Time) bool { return !at.Before(in.From) && at.Before(in.To) }

	purchases := map[key]Purchase{}
	for _, list := range [][]Purchase{in.Named, in.Purchases} {
		for _, p := range list {
			if p.PaymentID != "" {
				purchases[key{p.Test, p.PaymentID}] = p
			}
		}
	}
	records := map[key]Record{}
	for _, r := range in.Records {
		if _, seen := records[key{r.Test, r.PaymentID}]; !seen {
			records[key{r.Test, r.PaymentID}] = r
		}
	}

	var result Result
	compared := map[uuid.UUID]bool{}
	pair := func(p Purchase, r Record) {
		result.MatchedCount++
		compared[p.ID] = true
		if differs(p, r, in.StrictCurrency) {
			result.Findings = append(result.Findings, Finding{
				Kind: KindAmountMismatch, Test: p.Test, PaymentID: p.PaymentID,
				Purchase: &p, Record: &r, OccurredAt: p.PurchasedAt,
			})
		}
	}

	for _, r := range sortedRecords(records) {
		if !inPeriod(r.OccurredAt) || in.Excluded[r.PaymentID] {
			continue
		}
		result.RecordCount++
		if p, ok := purchases[key{r.Test, r.PaymentID}]; ok {
			pair(p, r)
			continue
		}
		result.Findings = append(result.Findings, Finding{
			Kind: KindRecordUnmatched, Test: r.Test, PaymentID: r.PaymentID,
			Record: &r, OccurredAt: r.OccurredAt,
		})
	}

	for _, p := range in.Purchases {
		// A purchase a promotion code took the whole price off charged
		// nothing, and the source has no payment to show for it.
		if p.PaymentID == "" || !inPeriod(p.PurchasedAt) {
			continue
		}
		result.PurchaseCount++
		if compared[p.ID] {
			continue
		}
		if r, ok := records[key{p.Test, p.PaymentID}]; ok && !in.Excluded[r.PaymentID] {
			pair(p, r)
			continue
		}
		result.Findings = append(result.Findings, Finding{
			Kind: KindPurchaseUnmatched, Test: p.Test, PaymentID: p.PaymentID,
			Purchase: &p, OccurredAt: p.PurchasedAt,
		})
	}

	for _, h := range in.Holds {
		if !h.ReceivedAt.Before(in.From) {
			continue
		}
		result.Findings = append(result.Findings, Finding{
			Kind: h.Kind, PaymentID: h.PaymentID, Hold: &h, OccurredAt: h.ReceivedAt,
		})
	}

	slices.SortStableFunc(result.Findings, func(a, b Finding) int {
		return a.OccurredAt.Compare(b.OccurredAt)
	})
	return result
}

// differs reports a purchase and its payment that disagree.
func differs(p Purchase, r Record, strictCurrency bool) bool {
	switch {
	case r.Currency != "" && r.Currency == p.Currency:
		return r.Amount != p.Amount || r.RefundedAmount != p.RefundedAmount
	case r.Currency != "" && strictCurrency:
		return true
	default:
		return r.Refunded != (p.RefundedAmount > 0)
	}
}

func sortedRecords(records map[key]Record) []Record {
	sorted := make([]Record, 0, len(records))
	for _, r := range records {
		sorted = append(sorted, r)
	}
	slices.SortFunc(sorted, func(a, b Record) int {
		if c := a.OccurredAt.Compare(b.OccurredAt); c != 0 {
			return c
		}
		return cmp.Compare(a.PaymentID, b.PaymentID)
	})
	return sorted
}
