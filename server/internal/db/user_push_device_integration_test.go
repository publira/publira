package dbtest

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// Walking the pages from an empty cursor reaches every device of every notified
// member once, in recipient and token order, and nothing of a member who was
// not notified or of another tenant.
func TestListPushDevicesForNotificationPagesInRecipientOrder(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "PUSHPAGE0001", "push-page.example.com", "Push Page Tenant")
	other := pg.SeedTenant(t, "PUSHPAGE0002", "push-page-other.example.com", "Other Tenant")
	queries := dbmodels.New(pg.DB)

	first := pg.SeedEndUser(t, tenant.ID, "PUSHUSER0001", "first@push-page.example.com", "First")
	second := pg.SeedEndUser(t, tenant.ID, "PUSHUSER0002", "second@push-page.example.com", "Second")
	unnotified := pg.SeedEndUser(t, tenant.ID, "PUSHUSER0003", "unnotified@push-page.example.com", "Unnotified")
	elsewhere := pg.SeedEndUser(t, other.ID, "PUSHUSER0004", "elsewhere@push-page-other.example.com", "Elsewhere")

	const subjectKey = "episode:EPISODE0001"
	notificationOf := map[uuid.UUID]uuid.UUID{}
	for _, user := range []testutil.TenantUser{first, second, elsewhere} {
		id := uuid.Must(uuid.NewV7())
		if err := queries.CreateNotification(ctx, dbmodels.CreateNotificationParams{
			ID:               id,
			TenantID:         user.TenantID,
			UserID:           user.ID,
			NotificationType: "episode_published",
			SubjectKey:       subjectKey,
			Payload:          json.RawMessage(`{"episode_id":"EPISODE0001"}`),
		}); err != nil {
			t.Fatalf("CreateNotification: %v", err)
		}
		notificationOf[user.ID] = id
	}

	for _, device := range []struct {
		user  testutil.TenantUser
		token string
	}{
		{first, "device-e"},
		{first, "device-b"},
		{second, "device-d"},
		{second, "device-a"},
		{second, "device-c"},
		{unnotified, "device-0"},
		{elsewhere, "device-00"},
	} {
		if _, err := queries.UpsertUserPushDevice(ctx, dbmodels.UpsertUserPushDeviceParams{
			TenantID: device.user.TenantID,
			UserID:   device.user.ID,
			Token:    device.token,
			Platform: "android",
		}); err != nil {
			t.Fatalf("UpsertUserPushDevice %s: %v", device.token, err)
		}
	}

	var got []string
	var pageSizes []int
	afterUser, afterToken := uuid.Nil, ""
	for range 5 {
		rows, err := queries.ListPushDevicesForNotification(ctx, dbmodels.ListPushDevicesForNotificationParams{
			TenantID:         tenant.ID,
			NotificationType: "episode_published",
			SubjectKey:       subjectKey,
			AfterUserID:      afterUser,
			AfterToken:       afterToken,
			PageSize:         2,
		})
		if err != nil {
			t.Fatalf("ListPushDevicesForNotification: %v", err)
		}
		if len(rows) == 0 {
			break
		}
		for _, row := range rows {
			if row.NotificationID != notificationOf[row.UserID] {
				t.Fatalf("device %s mirrors %s, want its owner's notification %s", row.Token, row.NotificationID, notificationOf[row.UserID])
			}
			got = append(got, row.Token)
		}
		pageSizes = append(pageSizes, len(rows))
		afterUser, afterToken = rows[len(rows)-1].UserID, rows[len(rows)-1].Token
	}

	firstTokens, secondTokens := []string{"device-b", "device-e"}, []string{"device-a", "device-c", "device-d"}
	want := slices.Concat(firstTokens, secondTokens)
	if slices.Compare(second.ID[:], first.ID[:]) < 0 {
		want = slices.Concat(secondTokens, firstTokens)
	}
	if !slices.Equal(got, want) {
		t.Fatalf("devices = %v, want %v", got, want)
	}
	if !slices.Equal(pageSizes, []int{2, 2, 1}) {
		t.Fatalf("page sizes = %v, want [2 2 1]", pageSizes)
	}
}

// A page is read along the notification's recipients rather than along every
// device the tenant has.
func TestListPushDevicesForNotificationWalksTheRecipientIndex(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tx, err := pg.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SET LOCAL enable_seqscan = off"); err != nil {
		t.Fatalf("disable seqscan: %v", err)
	}

	rows, err := tx.QueryContext(ctx, "EXPLAIN "+dbmodels.ListPushDevicesForNotification,
		uuid.New(), "episode_published", "episode:EPISODE0001", uuid.New(), "device-a", 50)
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatalf("scan explain: %v", err)
		}
		plan.WriteString(line)
		plan.WriteByte('\n')
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("explain rows: %v", err)
	}
	if err := rows.Close(); err != nil {
		t.Fatalf("close explain: %v", err)
	}
	if !strings.Contains(plan.String(), "idx_notifications_tenant_subject_user") {
		t.Fatalf("plan did not use idx_notifications_tenant_subject_user:\n%s", plan.String())
	}
}
