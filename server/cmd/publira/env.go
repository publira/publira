package main

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// dbURLFromEnv reads the connection one role's pool opens with, falling back
// to that role's development URL. PUBLIRA_DB_URL is deliberately not a link in
// the chain: it is the migration tooling's connection, the superuser locally,
// so falling back to it would hand a process more privilege than its role
// wherever the variable is left unset, which is exactly the mistake production
// must not make. An unset variable lands on the role's development password
// and fails to authenticate instead.
func dbURLFromEnv(name, fallback string) string {
	if url := strings.TrimSpace(os.Getenv(name)); url != "" {
		return url
	}
	return fallback
}

func addrFromEnv(name, fallback string) string {
	if addr := strings.TrimSpace(os.Getenv(name)); addr != "" {
		return addr
	}
	return fallback
}

func envDuration(name string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d < 0 {
		return fallback
	}
	return d
}

func envInt(name string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return fallback
	}
	return n
}

// envSeconds reads a whole number of seconds, which is the unit the three
// interval variables have carried since they configured processes of their own.
func envSeconds(name string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return fallback
	}
	return time.Duration(n) * time.Second
}

func envInt32(name string, fallback int32) int32 {
	n := envInt(name, int(fallback))
	return int32(n)
}
