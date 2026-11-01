package paymentreconciliation

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"time"

	"golang.org/x/text/currency"

	"github.com/publira/publira/server/internal/appstore"
	"github.com/publira/publira/server/internal/googleplay"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentsettings"
)

// ErrCredentials reports a source whose credentials are not saved, or that
// refused them. Starting the run again changes nothing until a Tenant admin
// saves credentials that work.
var ErrCredentials = errors.New("paymentreconciliation: the source's credentials are missing or refused")

// source reads one source's payments over a range of instants. purchases are
// the install's purchases through the source over the same range, which a
// store that keeps no list of every payment is read by.
type source interface {
	records(ctx context.Context, from, to time.Time, purchases []Purchase) ([]Record, error)
}

// AppStoreHistory is the part of the App Store Server API a run calls.
type AppStoreHistory interface {
	GetTransactionHistory(ctx context.Context, credentials appstore.Credentials, environment, transactionID string, from, to time.Time) ([]string, error)
}

// TransactionVerifier checks the transactions the App Store signs.
type TransactionVerifier interface {
	VerifyTransaction(signed string) (appstore.Transaction, error)
}

// GooglePlayReader is the part of the Google Play Developer API a run calls.
type GooglePlayReader interface {
	GetProductPurchase(ctx context.Context, serviceAccountKey []byte, packageName, productID, token string) (googleplay.ProductPurchase, error)
	GetOrder(ctx context.Context, serviceAccountKey []byte, packageName, orderID string) (googleplay.Order, error)
	ListVoidedPurchases(ctx context.Context, serviceAccountKey []byte, packageName string, since, until time.Time) ([]googleplay.VoidedPurchase, error)
}

// providerSource is a web payment provider, which lists every payment it took.
type providerSource struct {
	provider    paymentprovider.Provider
	credentials paymentprovider.Credentials
}

func (s providerSource) records(ctx context.Context, from, to time.Time, _ []Purchase) ([]Record, error) {
	transactions, err := s.provider.ListTransactions(ctx, s.credentials, from, to)
	if errors.Is(err, paymentprovider.ErrCredentialsRefused) {
		return nil, fmt.Errorf("%w: %v", ErrCredentials, err)
	}
	if err != nil {
		return nil, err
	}
	records := make([]Record, 0, len(transactions))
	for _, t := range transactions {
		records = append(records, Record{
			PaymentID:      t.PaymentID,
			Test:           t.Test,
			OccurredAt:     t.Created,
			Amount:         t.Amount,
			Currency:       t.Currency,
			RefundedAmount: t.AmountRefunded,
			Refunded:       t.AmountRefunded > 0,
		})
	}
	return records, nil
}

// appStoreSource is the App Store, which keeps a transaction history per
// customer and none for the whole app. It is read through the history of
// every customer the install has a purchase of in the range, so a payment by
// a customer whose every purchase the app failed to confirm is one it cannot
// see.
type appStoreSource struct {
	history     AppStoreHistory
	verifier    TransactionVerifier
	credentials paymentsettings.AppStoreCredentials
}

func (s appStoreSource) records(ctx context.Context, from, to time.Time, purchases []Purchase) ([]Record, error) {
	credentials := appstore.Credentials{
		IssuerID:         s.credentials.IssuerID,
		KeyID:            s.credentials.KeyID,
		PrivateKey:       s.credentials.PrivateKey,
		BundleIdentifier: s.credentials.BundleIdentifier,
	}
	var records []Record
	seen := map[string]bool{}
	for _, p := range purchases {
		environment := appstore.EnvironmentProduction
		if p.Test {
			environment = appstore.EnvironmentSandbox
		}
		// One customer's history holds every one of their transactions, so a
		// purchase whose transaction an earlier history listed adds nothing.
		if p.PaymentID == "" || seen[environment+"/"+p.PaymentID] {
			continue
		}
		signed, err := s.history.GetTransactionHistory(ctx, credentials, environment, p.PaymentID, from, to)
		switch {
		case errors.Is(err, appstore.ErrTransactionNotFound):
			// The purchase is one the App Store has no record of, which the
			// match reports.
			continue
		case errors.Is(err, appstore.ErrUnauthorized), errors.Is(err, appstore.ErrInvalidCredentials):
			return nil, fmt.Errorf("%w: %v", ErrCredentials, err)
		case err != nil:
			return nil, err
		}
		for _, raw := range signed {
			transaction, err := s.verifier.VerifyTransaction(raw)
			if err != nil {
				return nil, fmt.Errorf("the App Store answered a transaction that does not verify: %w", err)
			}
			if transaction.BundleID != s.credentials.BundleIdentifier || transaction.Type != appstore.TypeConsumable {
				continue
			}
			key := transaction.Environment + "/" + transaction.TransactionID
			if seen[key] {
				continue
			}
			seen[key] = true
			record := Record{
				PaymentID:  transaction.TransactionID,
				Test:       transaction.Environment == appstore.EnvironmentSandbox,
				OccurredAt: time.UnixMilli(transaction.PurchaseDate).UTC(),
				Refunded:   transaction.RevocationDate != 0,
			}
			if amount, ok := fromMilliunits(transaction.Price, transaction.Currency); ok {
				record.Amount, record.Currency = amount, transaction.Currency
				if record.Refunded {
					record.RefundedAmount = amount
				}
			}
			records = append(records, record)
		}
	}
	return records, nil
}

// googlePlaySource is Google Play, which lists no payments but the ones it
// voided, and those only for thirty days. It is read through the install's
// own purchases, each looked up with its order, and through the voided
// purchases, which are the only payments the app did not confirm it can see.
type googlePlaySource struct {
	client      GooglePlayReader
	credentials paymentsettings.GooglePlayCredentials
	now         time.Time
}

func (s googlePlaySource) records(ctx context.Context, from, to time.Time, purchases []Purchase) ([]Record, error) {
	key := []byte(s.credentials.ServiceAccountKey)
	pkg := s.credentials.PackageName
	var records []Record
	index := map[string]int{}
	for _, p := range purchases {
		if p.PaymentID == "" || p.ProductID == "" {
			continue
		}
		if _, seen := index[p.PaymentID]; seen {
			continue
		}
		purchase, err := s.client.GetProductPurchase(ctx, key, pkg, p.ProductID, p.PaymentID)
		if errors.Is(err, googleplay.ErrPurchaseNotFound) {
			continue
		}
		if err != nil {
			return nil, googlePlayError(err)
		}
		record := Record{
			PaymentID:  p.PaymentID,
			Test:       purchase.IsTest(),
			OccurredAt: millis(purchase.PurchaseTimeMillis, p.PurchasedAt),
			Refunded:   purchase.PurchaseState == googleplay.PurchaseStateCanceled,
		}
		if purchase.OrderID != "" {
			order, err := s.client.GetOrder(ctx, key, pkg, purchase.OrderID)
			switch {
			case errors.Is(err, googleplay.ErrPurchaseNotFound):
			case err != nil:
				return nil, googlePlayError(err)
			default:
				applyOrder(&record, order)
			}
		}
		index[p.PaymentID] = len(records)
		records = append(records, record)
	}

	// The API selects by when a purchase was voided, which for a purchase of
	// the range may be any time since, so it is read up to now. It reads back
	// thirty days from the moment it answers, so the start is kept a little
	// inside them.
	since, until := from, s.now
	if earliest := s.now.Add(-googleplay.MaxVoidedPurchaseAge + time.Hour); since.Before(earliest) {
		since = earliest
	}
	if since.Before(until) {
		voided, err := s.client.ListVoidedPurchases(ctx, key, pkg, since, until)
		if err != nil {
			return nil, googlePlayError(err)
		}
		for _, v := range voided {
			if v.PurchaseToken == "" {
				continue
			}
			if i, ok := index[v.PurchaseToken]; ok {
				records[i].Refunded = true
				continue
			}
			index[v.PurchaseToken] = len(records)
			records = append(records, Record{
				PaymentID:  v.PurchaseToken,
				OccurredAt: millis(v.PurchaseTimeMillis, millis(v.VoidedTimeMillis, until)),
				Refunded:   true,
			})
		}
	}
	return records, nil
}

// applyOrder reads what an order charged and refunded onto record.
func applyOrder(record *Record, order googleplay.Order) {
	if order.Total == nil {
		return
	}
	amount, ok := fromMoney(*order.Total)
	if !ok {
		return
	}
	record.Amount, record.Currency = amount, order.Total.CurrencyCode
	var refunded int64
	for _, refund := range order.Refunds() {
		if part, ok := fromMoney(refund); ok && refund.CurrencyCode == order.Total.CurrencyCode {
			refunded += part
		}
	}
	if order.State == googleplay.OrderStateRefunded && refunded == 0 {
		refunded = amount
	}
	record.RefundedAmount = refunded
	if refunded > 0 || order.State == googleplay.OrderStateRefunded || order.State == googleplay.OrderStatePartiallyRefunded {
		record.Refunded = true
	}
}

func googlePlayError(err error) error {
	if errors.Is(err, googleplay.ErrUnauthorized) || errors.Is(err, googleplay.ErrInvalidCredentials) {
		return fmt.Errorf("%w: %v", ErrCredentials, err)
	}
	return err
}

// millis reads a count of milliseconds since the epoch spelled in decimal,
// or answers fallback for one that is missing.
func millis(value string, fallback time.Time) time.Time {
	n, err := strconv.ParseInt(value, 10, 64)
	if err != nil || n <= 0 {
		return fallback
	}
	return time.UnixMilli(n).UTC()
}

// minorUnitScale answers how many decimal places the minor unit of the ISO
// 4217 code sits below the currency's unit.
func minorUnitScale(code string) (int, bool) {
	unit, err := currency.ParseISO(code)
	if err != nil {
		return 0, false
	}
	scale, _ := currency.Standard.Rounding(unit)
	return scale, true
}

// fromMilliunits reads an amount the App Store gives in thousandths of the
// currency's unit as minor units, rounding a fraction of one toward zero.
func fromMilliunits(milliunits int64, code string) (int64, bool) {
	if code == "" {
		return 0, false
	}
	scale, ok := minorUnitScale(code)
	if !ok || scale > 3 {
		return 0, false
	}
	return milliunits / pow10(3-scale), true
}

// fromMoney reads a google.type.Money as minor units.
func fromMoney(m googleplay.Money) (int64, bool) {
	scale, ok := minorUnitScale(m.CurrencyCode)
	if !ok {
		return 0, false
	}
	units, ok := new(big.Int).SetString(m.Units, 10)
	if !ok {
		if m.Units != "" {
			return 0, false
		}
		units = new(big.Int)
	}
	minor := new(big.Int).Mul(units, big.NewInt(pow10(scale)))
	minor.Add(minor, big.NewInt(int64(m.Nanos)/pow10(9-scale)))
	if !minor.IsInt64() {
		return 0, false
	}
	return minor.Int64(), true
}

func pow10(n int) int64 {
	p := int64(1)
	for range n {
		p *= 10
	}
	return p
}
