package main

import (
	"log/slog"
	"os"
	"strings"

	"github.com/publira/publira/server/internal/revalidate"
)

// newRevalidateClient builds the one client a process sends Next.js cache tags
// with, and logs which web apps it sends them to. A deployment without a token
// gets a nil client, which makes every drop a no-op; a token with no usable
// destination is an error the process refuses to start on.
func newRevalidateClient(logger *slog.Logger) (*revalidate.Client, error) {
	client, err := revalidate.NewClient(strings.TrimSpace(os.Getenv("PUBLIRA_REVALIDATE_TOKEN")), logger)
	if err != nil {
		return nil, err
	}
	if client == nil {
		logger.Info("next revalidate is disabled", "reason", "PUBLIRA_REVALIDATE_TOKEN is empty")
		return nil, nil
	}
	logger.Info("next revalidate is enabled", "destinations", client.Destinations())
	return client, nil
}
