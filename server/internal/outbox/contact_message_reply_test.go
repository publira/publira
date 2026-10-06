package outbox_test

import (
	"strings"
	"testing"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
)

func TestNewContactMessageReplyMessageIDIsOnTheTenantsHost(t *testing.T) {
	for _, test := range []struct {
		domain string
		host   string
	}{
		{domain: "aoto.example.test", host: "aoto.example.test"},
		{domain: "https://aoto.example.test/", host: "aoto.example.test"},
		{domain: "localhost:3000", host: "localhost"},
	} {
		t.Run(test.domain, func(t *testing.T) {
			first, err := outbox.NewContactMessageReplyMessageID(dbmodels.Tenant{Domain: test.domain})
			if err != nil {
				t.Fatalf("NewContactMessageReplyMessageID: %v", err)
			}
			second, err := outbox.NewContactMessageReplyMessageID(dbmodels.Tenant{Domain: test.domain})
			if err != nil {
				t.Fatalf("NewContactMessageReplyMessageID: %v", err)
			}
			if !strings.HasSuffix(first, "@"+test.host) || strings.Count(first, "@") != 1 {
				t.Errorf("message id = %q, want one on %q", first, test.host)
			}
			if first == second {
				t.Errorf("two answers share the message id %q", first)
			}
		})
	}

	if _, err := outbox.NewContactMessageReplyMessageID(dbmodels.Tenant{Domain: " "}); err == nil {
		t.Error("a tenant with no domain was given a message id")
	}
}
