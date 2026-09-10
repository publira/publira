package mailguard

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"

	"github.com/publira/publira/server/internal/ratelimit"
)

// The deployment settings, and the defaults a deployment that sets none of them
// gets.
//
// The mailbox's allowance is what one person asking for their own mail can
// reach and a script cannot live within: signing up, finding the address taken,
// asking for a reset and resending the link is four mails in a sitting, and
// nobody needs a fifth in the same hour. The origin's is wide enough for the
// office or the campus that shares one address with everyone behind it, and
// still far below what makes a mail server's quota worth attacking.
const (
	perAddressPerHourEnv = "PUBLIRA_MAIL_REQUEST_LIMIT_PER_ADDRESS_PER_HOUR"
	perAddressPerDayEnv  = "PUBLIRA_MAIL_REQUEST_LIMIT_PER_ADDRESS_PER_DAY"
	perSourcePerHourEnv  = "PUBLIRA_MAIL_REQUEST_LIMIT_PER_SOURCE_PER_HOUR"
	perSourcePerDayEnv   = "PUBLIRA_MAIL_REQUEST_LIMIT_PER_SOURCE_PER_DAY"

	defaultPerAddressPerHour = 5
	defaultPerAddressPerDay  = 20
	defaultPerSourcePerHour  = 30
	defaultPerSourcePerDay   = 150
)

// NewFromEnv reads the deployment's settings. A value that is not a whole
// number of at least one stops the server: a limit of zero refuses every form
// and a negative one is not a limit at all, and either is better caught at
// startup than by the first reader who cannot get their password reset.
func NewFromEnv(logger *slog.Logger) (*Guard, error) {
	perAddressPerHour, err := envLimit(perAddressPerHourEnv, defaultPerAddressPerHour)
	if err != nil {
		return nil, err
	}
	perAddressPerDay, err := envLimit(perAddressPerDayEnv, defaultPerAddressPerDay)
	if err != nil {
		return nil, err
	}
	perSourcePerHour, err := envLimit(perSourcePerHourEnv, defaultPerSourcePerHour)
	if err != nil {
		return nil, err
	}
	perSourcePerDay, err := envLimit(perSourcePerDayEnv, defaultPerSourcePerDay)
	if err != nil {
		return nil, err
	}
	return New(
		ratelimit.NewFromEnv(logger),
		Rules(perAddressPerHour, perAddressPerDay),
		Rules(perSourcePerHour, perSourcePerDay),
		logger,
	), nil
}

// NewDefault returns the guard a caller that reads no settings of its own gets.
// Handing the forms a guard that is not there would take the limit off them
// silently, so the answer to an unconfigured caller is the default policy over
// in-process counters rather than no policy at all.
func NewDefault() *Guard {
	return New(
		ratelimit.New(ratelimit.NewMemoryStore()),
		Rules(defaultPerAddressPerHour, defaultPerAddressPerDay),
		Rules(defaultPerSourcePerHour, defaultPerSourcePerDay),
		nil,
	)
}

func envLimit(name string, fallback int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer, got %q", name, raw)
	}
	if value < 1 {
		return 0, fmt.Errorf("%s must be at least 1, got %d", name, value)
	}
	return value, nil
}
