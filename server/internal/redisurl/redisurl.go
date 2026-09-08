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
	"os"
	"strings"
)

// Env names the variable every process reads.
const Env = "PUBLIRA_REDIS_URL"

// FromEnv returns the configured URL, or an empty string when this deployment
// has no Redis for the caller to use.
func FromEnv() string {
	raw := os.Getenv(Env)
	if !Enabled(raw) {
		return ""
	}
	return strings.TrimSpace(raw)
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
