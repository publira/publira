// Package redisurl answers where Redis is, and whether this deployment has one
// for the caller at all.
//
// Every process that can use Redis reads the same variable, and every one of
// them has to keep working without it: the stack a contributor starts locally,
// a test run, and a deployment that has not provisioned Redis yet all leave it
// unset. The sentinels below say the same thing explicitly, so an operator can
// turn Redis off without emptying a variable a Compose file supplies.
package redisurl

import (
	"fmt"
	"net/url"
	"os"
	"strings"
)

// Env names the variable every process reads.
const Env = "PUBLIRA_REDIS_URL"

// FromEnv returns the configured URL, or an empty string when this deployment
// has no Redis for the caller to use. A URL [Check] refuses is an error rather
// than a URL, so no caller can connect with it.
func FromEnv() (string, error) {
	raw := os.Getenv(Env)
	if !Enabled(raw) {
		return "", nil
	}
	raw = strings.TrimSpace(raw)
	if err := Check(raw); err != nil {
		return "", err
	}
	return raw, nil
}

// Enabled reports whether raw names a Redis to connect to.
func Enabled(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "disabled", "off", "false":
		return false
	default:
		return true
	}
}

// Check refuses a redis:// URL that carries a password: that scheme connects
// without TLS, so the client would send the password in cleartext on every
// connect. A URL that fails to parse is left to the Redis client to report.
func Check(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || !strings.EqualFold(u.Scheme, "redis") || u.User == nil {
		return nil
	}
	if password, ok := u.User.Password(); ok && password != "" {
		return fmt.Errorf("%s carries a password over redis://, which is sent in cleartext; use rediss:// instead", Env)
	}
	return nil
}
