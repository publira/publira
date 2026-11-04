package tenantwebhooks

import (
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestASignedDeliveryVerifiesAndATamperedOneDoesNot(t *testing.T) {
	secret, err := NewSecret()
	if err != nil {
		t.Fatalf("NewSecret: %v", err)
	}
	body := []byte(`{"id":"evt_1","type":"purchase.completed"}`)
	sentAt := time.Unix(1_800_000_000, 0)
	header := Sign(secret, sentAt, body)
	if !strings.HasPrefix(header, "t=1800000000,v1=") {
		t.Fatalf("signature header = %q, want t= and v1=", header)
	}
	if err := Verify(secret, header, body, sentAt.Add(time.Minute), 5*time.Minute); err != nil {
		t.Fatalf("Verify of a fresh delivery: %v", err)
	}
	for name, tc := range map[string]struct {
		secret, header string
		body           []byte
		now            time.Time
	}{
		"another body":     {secret, header, []byte(`{"id":"evt_2"}`), sentAt},
		"another secret":   {secret + "x", header, body, sentAt},
		"a replay":         {secret, header, body, sentAt.Add(time.Hour)},
		"another time":     {secret, strings.Replace(header, "t=1800000000", "t=1800000001", 1), body, sentAt},
		"no signature":     {secret, "t=1800000000", body, sentAt},
		"a garbled header": {secret, "garbage", body, sentAt},
	} {
		if err := Verify(tc.secret, tc.header, tc.body, tc.now, 5*time.Minute); err == nil {
			t.Errorf("Verify accepted %s", name)
		}
	}
}

func TestValidateURLTakesAnHTTPSURLWithAHost(t *testing.T) {
	if got, err := ValidateURL("  https://crm.example.com/hooks/publira?source=1 "); err != nil || got != "https://crm.example.com/hooks/publira?source=1" {
		t.Fatalf("ValidateURL = %q, %v, want the URL trimmed", got, err)
	}
	for _, raw := range []string{
		"",
		"http://crm.example.com/",
		"https:///path",
		"https://user:secret@crm.example.com/",
		"https://crm.example.com/#fragment",
		"mailto:hooks@example.com",
		"https://crm.example.com/" + strings.Repeat("a", 2048),
	} {
		if _, err := ValidateURL(raw); err == nil {
			t.Errorf("ValidateURL accepted %q", raw)
		}
	}
}

func TestPublicAddressRefusesWhatTheOperatorsNetworkHolds(t *testing.T) {
	for raw, want := range map[string]bool{
		"93.184.216.34":        true,
		"2606:2800:220:1::1":   true,
		"127.0.0.1":            false,
		"::1":                  false,
		"10.0.0.8":             false,
		"172.16.4.1":           false,
		"192.168.1.10":         false,
		"169.254.169.254":      false,
		"100.64.0.1":           false,
		"0.0.0.0":              false,
		"fd00::1":              false,
		"fe80::1":              false,
		"::ffff:127.0.0.1":     false,
		"64:ff9b::7f00:1":      false,
		"224.0.0.1":            false,
		"::ffff:93.184.216.34": true,
	} {
		if got := PublicAddress(netip.MustParseAddr(raw)); got != want {
			t.Errorf("PublicAddress(%s) = %v, want %v", raw, got, want)
		}
	}
}

func TestEventIDNamesTheChangeAndNoInternalID(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	purchaseID := uuid.Must(uuid.NewV7())
	key := EventPurchaseCompleted + ":" + purchaseID.String()
	id := EventID(tenantID, key)
	if id != EventID(tenantID, key) {
		t.Fatal("one change has two event ids")
	}
	if id == EventID(uuid.Must(uuid.NewV7()), key) || id == EventID(tenantID, key+"x") {
		t.Fatal("two changes share an event id")
	}
	if !strings.HasPrefix(id, "evt_") || strings.Contains(id, purchaseID.String()) {
		t.Fatalf("event id %q is not an evt_ id of its own", id)
	}
}
