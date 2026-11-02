package paymentreconciliation

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/googleplay"
)

var (
	periodFrom = time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	periodTo   = time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
)

func paid(id string, at time.Time, amount int64) Record {
	return Record{PaymentID: id, OccurredAt: at, Amount: amount, Currency: "JPY"}
}

func bought(id string, at time.Time, amount int64) Purchase {
	return Purchase{ID: uuid.New(), PaymentID: id, Amount: amount, Currency: "JPY", PurchasedAt: at}
}

func kinds(result Result) []string {
	var got []string
	for _, f := range result.Findings {
		got = append(got, f.Kind)
	}
	return got
}

func TestMatchACleanPeriodFindsNothing(t *testing.T) {
	at := periodFrom.Add(48 * time.Hour)
	result := Match(Input{
		From: periodFrom, To: periodTo, StrictCurrency: true,
		Records:   []Record{paid("pi_1", at, 500), paid("pi_2", at.Add(time.Hour), 300)},
		Purchases: []Purchase{bought("pi_1", at, 500), bought("pi_2", at.Add(time.Hour), 300)},
	})
	if len(result.Findings) != 0 || result.RecordCount != 2 || result.PurchaseCount != 2 || result.MatchedCount != 2 {
		t.Fatalf("result = %+v, want two pairs and no finding", result)
	}
}

func TestMatchAPaymentWhoseNotificationNeverArrivedNamesTheProvidersID(t *testing.T) {
	at := periodFrom.Add(48 * time.Hour)
	result := Match(Input{
		From: periodFrom, To: periodTo, StrictCurrency: true,
		Records:   []Record{paid("pi_1", at, 500), paid("pi_lost", at.Add(time.Hour), 300)},
		Purchases: []Purchase{bought("pi_1", at, 500)},
	})
	if len(result.Findings) != 1 {
		t.Fatalf("findings = %+v, want one", result.Findings)
	}
	f := result.Findings[0]
	if f.Kind != KindRecordUnmatched || f.PaymentID != "pi_lost" || f.Purchase != nil || f.Record == nil || f.Record.Amount != 300 {
		t.Fatalf("finding = %+v, want the provider's pi_lost with no purchase", f)
	}
}

func TestMatchAPurchaseTheProviderHasNoRecordOf(t *testing.T) {
	at := periodFrom.Add(48 * time.Hour)
	purchase := bought("pi_ghost", at, 500)
	result := Match(Input{From: periodFrom, To: periodTo, StrictCurrency: true, Purchases: []Purchase{purchase}})
	if got := kinds(result); len(got) != 1 || got[0] != KindPurchaseUnmatched || result.Findings[0].Purchase.ID != purchase.ID {
		t.Fatalf("findings = %+v, want the purchase with no payment", result.Findings)
	}
}

func TestMatchAPairThatDisagreesIsOneMismatch(t *testing.T) {
	at := periodFrom.Add(48 * time.Hour)
	for name, record := range map[string]Record{
		"amount":   paid("pi_1", at, 400),
		"refund":   {PaymentID: "pi_1", OccurredAt: at, Amount: 500, Currency: "JPY", RefundedAmount: 200, Refunded: true},
		"currency": {PaymentID: "pi_1", OccurredAt: at, Amount: 500, Currency: "USD"},
	} {
		t.Run(name, func(t *testing.T) {
			result := Match(Input{
				From: periodFrom, To: periodTo, StrictCurrency: true,
				Records:   []Record{record},
				Purchases: []Purchase{bought("pi_1", at, 500)},
			})
			if got := kinds(result); len(got) != 1 || got[0] != KindAmountMismatch || result.MatchedCount != 1 {
				t.Fatalf("result = %+v, want one mismatched pair", result)
			}
		})
	}
}

// A store charges in the buyer's currency, so a store record in another one
// is compared only on whether it was refunded.
func TestMatchAStoreRecordInAnotherCurrencyComparesTheRefundAlone(t *testing.T) {
	at := periodFrom.Add(48 * time.Hour)
	purchase := bought("tx_1", at, 300)
	usd := Record{PaymentID: "tx_1", OccurredAt: at, Amount: 199, Currency: "USD"}
	if result := Match(Input{From: periodFrom, To: periodTo, Records: []Record{usd}, Purchases: []Purchase{purchase}}); len(result.Findings) != 0 {
		t.Fatalf("findings = %+v, want none for a store charging in the buyer's currency", result.Findings)
	}
	usd.Refunded = true
	if got := kinds(Match(Input{From: periodFrom, To: periodTo, Records: []Record{usd}, Purchases: []Purchase{purchase}})); len(got) != 1 || got[0] != KindAmountMismatch {
		t.Fatalf("findings = %v, want a mismatch for a refund the purchase does not record", got)
	}
}

func TestMatchKeepsTestAndLiveApart(t *testing.T) {
	at := periodFrom.Add(48 * time.Hour)
	test := paid("pi_1", at, 500)
	test.Test = true
	result := Match(Input{
		From: periodFrom, To: periodTo, StrictCurrency: true,
		Records:   []Record{test},
		Purchases: []Purchase{bought("pi_1", at, 500)},
	})
	if len(result.Findings) != 2 || result.MatchedCount != 0 {
		t.Fatalf("result = %+v, want a test record and a live purchase that do not meet", result)
	}
	for _, f := range result.Findings {
		if (f.Kind == KindRecordUnmatched) != f.Test {
			t.Fatalf("finding = %+v, want the record's line test and the purchase's live", f)
		}
	}
}

// A payment taken late on the last day meets the purchase the install recorded
// the next morning, and neither side's lines outside the period are reported.
func TestMatchMeetsAPairAcrossThePeriodsEdge(t *testing.T) {
	lastEvening := periodTo.Add(-time.Hour)
	nextMorning := periodTo.Add(8 * time.Hour)
	result := Match(Input{
		From: periodFrom, To: periodTo, StrictCurrency: true,
		Records:   []Record{paid("pi_edge", lastEvening, 500), paid("pi_after", nextMorning, 300)},
		Purchases: []Purchase{bought("pi_before", periodFrom.Add(-time.Hour), 700)},
		Named:     []Purchase{bought("pi_edge", nextMorning, 500)},
	})
	if len(result.Findings) != 0 || result.RecordCount != 1 || result.MatchedCount != 1 || result.PurchaseCount != 0 {
		t.Fatalf("result = %+v, want the edge pair matched and nothing outside the period", result)
	}
}

func TestMatchLeavesOutTheExcludedPayments(t *testing.T) {
	at := periodFrom.Add(48 * time.Hour)
	result := Match(Input{
		From: periodFrom, To: periodTo, StrictCurrency: true,
		Records:  []Record{paid("pi_invoice", at, 980)},
		Excluded: map[string]bool{"pi_invoice": true},
	})
	if len(result.Findings) != 0 || result.RecordCount != 0 {
		t.Fatalf("result = %+v, want a plan's invoice left out", result)
	}
}

func TestMatchReportsAHoldOlderThanThePeriod(t *testing.T) {
	result := Match(Input{
		From: periodFrom, To: periodTo, StrictCurrency: true,
		Holds: []Hold{
			{Kind: KindHeldRefund, PaymentID: "pi_old", RefundedAmount: 500, Currency: "JPY", ReceivedAt: periodFrom.Add(-24 * time.Hour)},
			{Kind: KindHeldDispute, PaymentID: "pi_new", ReceivedAt: periodFrom.Add(24 * time.Hour)},
		},
	})
	if len(result.Findings) != 1 || result.Findings[0].Kind != KindHeldRefund || result.Findings[0].PaymentID != "pi_old" || result.Findings[0].Test {
		t.Fatalf("findings = %+v, want the refund held since before the period, as live", result.Findings)
	}
}

func TestMatchSkipsAPurchaseThatChargedNothing(t *testing.T) {
	result := Match(Input{
		From: periodFrom, To: periodTo, StrictCurrency: true,
		Purchases: []Purchase{bought("", periodFrom.Add(time.Hour), 0)},
	})
	if len(result.Findings) != 0 || result.PurchaseCount != 0 {
		t.Fatalf("result = %+v, want a free purchase left out", result)
	}
}

func TestMinorUnitConversions(t *testing.T) {
	for _, tc := range []struct {
		milliunits int64
		currency   string
		want       int64
	}{
		{300_000, "JPY", 300},
		{1_990, "USD", 199},
		{1_234, "KWD", 1_234},
	} {
		if got, ok := fromMilliunits(tc.milliunits, tc.currency); !ok || got != tc.want {
			t.Errorf("fromMilliunits(%d, %s) = %d, %v; want %d", tc.milliunits, tc.currency, got, ok, tc.want)
		}
	}
	if _, ok := fromMilliunits(1_000, ""); ok {
		t.Error("an amount with no currency converted")
	}
	for _, tc := range []struct {
		money googleplay.Money
		want  int64
	}{
		{googleplay.Money{CurrencyCode: "USD", Units: "2", Nanos: 990_000_000}, 299},
		{googleplay.Money{CurrencyCode: "JPY", Units: "300"}, 300},
		{googleplay.Money{CurrencyCode: "USD", Nanos: 500_000_000}, 50},
	} {
		if got, ok := fromMoney(tc.money); !ok || got != tc.want {
			t.Errorf("fromMoney(%+v) = %d, %v; want %d", tc.money, got, ok, tc.want)
		}
	}
}
