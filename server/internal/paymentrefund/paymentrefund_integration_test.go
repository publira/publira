package paymentrefund

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/testutil"
)

// gatedProvider holds every refund it is asked for until the test releases
// it, telling the test which payment each one is of as it arrives.
type gatedProvider struct {
	paymentprovider.Provider
	entered chan string
	release chan struct{}
}

func newGatedProvider() *gatedProvider {
	return &gatedProvider{entered: make(chan string, 2), release: make(chan struct{})}
}

func (*gatedProvider) Declaration() paymentprovider.Declaration {
	return paymentprovider.Declaration{ID: "gated"}
}

func (p *gatedProvider) Refund(ctx context.Context, _ paymentprovider.Credentials, req paymentprovider.RefundRequest) (bool, error) {
	p.entered <- req.PaymentID
	select {
	case <-p.release:
		return true, nil
	case <-ctx.Done():
		return false, ctx.Err()
	}
}

func beginOn(db *sql.DB) func(context.Context) (*sql.Tx, error) {
	return func(ctx context.Context) (*sql.Tx, error) { return db.BeginTx(ctx, nil) }
}

// waitForAdvisoryLockWaiter returns once a session is waiting for the lock of
// a payment's refund, which is the second refund queued behind the first.
func waitForAdvisoryLockWaiter(t *testing.T, pg *testutil.PostgresEnv) {
	t.Helper()

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var waiting bool
		if err := pg.DB.QueryRowContext(context.Background(), `
			SELECT EXISTS (
				SELECT 1 FROM pg_stat_activity
				WHERE wait_event_type = 'Lock' AND wait_event = 'advisory'
					AND query LIKE '%payment-refund:%'
			)
		`).Scan(&waiting); err != nil {
			t.Fatalf("read pg_stat_activity: %v", err)
		}
		if waiting {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("no refund waited for the lock")
}

// A refund of a payment sent while another refund of it is at the provider
// reaches the provider only once that one has been answered, even from the
// other API's login, as the console and the storefront's notifications do.
func TestSendHoldsARefundBackWhileAnotherOfThePaymentIsAtTheProvider(t *testing.T) {
	pg := testutil.StartPostgres(t)
	admin, public := pg.OpenAdminDB(t), pg.OpenPublicDB(t)
	provider := newGatedProvider()
	tenantID := uuid.New()
	req := paymentprovider.RefundRequest{PaymentID: "pay_1", IdempotencyKey: "key", Amount: 100}

	first := make(chan error, 1)
	go func() {
		_, err := Send(t.Context(), beginOn(admin), tenantID, provider, nil, req)
		first <- err
	}()
	<-provider.entered

	second := make(chan error, 1)
	go func() {
		_, err := Send(t.Context(), beginOn(public), tenantID, provider, nil, req)
		second <- err
	}()
	waitForAdvisoryLockWaiter(t, pg)
	select {
	case <-provider.entered:
		t.Fatal("the second refund reached the provider while the first was there")
	default:
	}

	provider.release <- struct{}{}
	if err := <-first; err != nil {
		t.Fatalf("first Send: %v", err)
	}
	<-provider.entered
	provider.release <- struct{}{}
	if err := <-second; err != nil {
		t.Fatalf("second Send: %v", err)
	}
}

// The lock is the payment's, so refunds of other payments go on beside it.
func TestSendLetsRefundsOfOtherPaymentsOverlap(t *testing.T) {
	pg := testutil.StartPostgres(t)
	db := pg.OpenAdminDB(t)
	provider := newGatedProvider()
	tenantID := uuid.New()

	done := make(chan error, 2)
	for _, paymentID := range []string{"pay_1", "pay_2"} {
		go func() {
			_, err := Send(t.Context(), beginOn(db), tenantID, provider, nil, paymentprovider.RefundRequest{PaymentID: paymentID, IdempotencyKey: "key-" + paymentID})
			done <- err
		}()
	}
	timeout := time.After(10 * time.Second)
	for range 2 {
		select {
		case <-provider.entered:
		case <-timeout:
			t.Fatal("a refund of another payment waited for the first")
		}
	}
	close(provider.release)
	for range 2 {
		if err := <-done; err != nil {
			t.Fatalf("Send: %v", err)
		}
	}
}
