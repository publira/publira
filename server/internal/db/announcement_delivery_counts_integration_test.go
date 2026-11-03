package dbtest

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/publira/publira/server/internal/testutil"
)

// announce writes a delivered announcement, a notification row for each of
// notified, and a read for each of opened, as the fan-out and the storefront
// would.
func (f *audienceFixture) announce(notified, opened []uuid.UUID) uuid.UUID {
	f.t.Helper()
	id := uuid.Must(uuid.NewV7())
	f.exec("INSERT INTO announcements (id, tenant_id, announcement_type, delivered_at) VALUES ($1, $2, 'announcement', now())", id, f.tenant.ID)
	for _, userID := range notified {
		f.exec(`INSERT INTO notifications (id, tenant_id, user_id, notification_type, subject_key, payload, category)
			VALUES (uuidv7(), $1, $2, 'announcement_posted', 'announcement:' || $3::text, '{}', 'announcements')`, f.tenant.ID, userID, id)
	}
	for _, userID := range opened {
		f.exec("INSERT INTO announcement_reads (announcement_id, tenant_id, user_id) VALUES ($1, $2, $3)", id, f.tenant.ID, userID)
	}
	return id
}

// count_announcement_deliveries and count_announcement_opens count the rows
// the console's role cannot read, for the tenant the connection set alone: an
// announcement of another tenant, or any announcement on a connection that set
// none, counts nobody, and the storefront's role may not call them.
func TestAnnouncementDeliveryCountsCountOnlyTheConnectionsTenant(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	f := newAudienceFixture(t, pg)
	first, second, third := f.reader("First reader"), f.reader("Second reader"), f.reader("Third reader")
	announcementID := f.announce([]uuid.UUID{first, second, third}, []uuid.UUID{first})
	// Another notification of the same reader, about something else, is not
	// this announcement's.
	f.exec(`INSERT INTO notifications (id, tenant_id, user_id, notification_type, subject_key, payload, category)
		VALUES (uuidv7(), $1, $2, 'announcement_posted', 'announcement:' || $3::text, '{}', 'announcements')`, f.tenant.ID, first, f.announce(nil, nil))
	other := newAudienceFixture(t, pg)
	otherID := other.announce([]uuid.UUID{other.reader("Reader in another tenant")}, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	admin := pg.OpenAdminDB(t)
	counts := func(conn *sql.Conn, id uuid.UUID) [2]int64 {
		t.Helper()
		var got [2]int64
		if err := conn.QueryRowContext(ctx, "SELECT count_announcement_deliveries($1), count_announcement_opens($1)", id).Scan(&got[0], &got[1]); err != nil {
			t.Fatalf("count deliveries and opens: %v", err)
		}
		return got
	}

	scoped := scopedConn(t, ctx, admin, f.tenant.ID, uuid.Nil)
	for _, table := range []string{"notifications", "announcement_reads"} {
		var visible int
		if err := scoped.QueryRowContext(ctx, "SELECT count(*) FROM "+table).Scan(&visible); err != nil {
			t.Fatalf("read %s as publira_admin: %v", table, err)
		}
		if visible != 0 {
			t.Fatalf("publira_admin reads %d rows of %s, want none: the count would not need to run as the owner", visible, table)
		}
	}
	if got := counts(scoped, announcementID); got != [2]int64{3, 1} {
		t.Fatalf("delivered, opened = %v, want [3 1]", got)
	}
	if got := counts(scoped, otherID); got != [2]int64{0, 0} {
		t.Fatalf("another tenant's announcement counts %v, want [0 0]", got)
	}
	if got := counts(scopedConn(t, ctx, admin, other.tenant.ID, uuid.Nil), announcementID); got != [2]int64{0, 0} {
		t.Fatalf("counted from another tenant: %v, want [0 0]", got)
	}
	unscoped, err := admin.Conn(ctx)
	if err != nil {
		t.Fatalf("open connection: %v", err)
	}
	defer unscoped.Close() //nolint:errcheck
	if got := counts(unscoped, announcementID); got != [2]int64{0, 0} {
		t.Fatalf("counted with no tenant set: %v, want [0 0]", got)
	}

	public := scopedConn(t, ctx, pg.OpenPublicDB(t), f.tenant.ID, uuid.Nil)
	for _, function := range []string{"count_announcement_deliveries", "count_announcement_opens"} {
		var n int64
		err := public.QueryRowContext(ctx, "SELECT "+function+"($1)", announcementID).Scan(&n)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != insufficientPrivilegeCode {
			t.Fatalf("%s as publira_public: error = %v, want SQLSTATE %s", function, err, insufficientPrivilegeCode)
		}
	}
}
