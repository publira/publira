// Package disposabledomains answers whether an email domain belongs to a
// service made for throwaway addresses.
//
// The answer comes from a snapshot of the disposable-email-domains project's
// blocklist (https://github.com/disposable-email-domains/disposable-email-domains),
// embedded in the binary under the CC0 dedication in LICENSE.txt beside it, so
// an install that reaches nothing outside answers all the same. A remote copy
// in the same format, named by PUBLIRA_DISPOSABLE_EMAIL_DOMAINS_URL, replaces
// it once it loads. `task server:update-disposable-domains` replaces the
// snapshot itself.
package disposabledomains

import (
	"bufio"
	"bytes"
	"context"
	_ "embed"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/idna"

	"github.com/publira/publira/server/internal/ttlcache"
)

const (
	// refreshInterval is how long a list answers before the remote copy is read
	// again, and how long a failed read waits before the next one. The upstream
	// list changes about once a day, so a few hours behind it is current
	// enough, and a remote that is down is asked four times a day.
	refreshInterval = 6 * time.Hour
	fetchTimeout    = 10 * time.Second
	// maxListBytes bounds what a remote copy may weigh. The maintained lists
	// run to a few megabytes at the most, so a body past this is not one.
	maxListBytes = 16 << 20
)

//go:embed disposable_email_blocklist.conf
var snapshot []byte

// embedded is the snapshot parsed on first use, so a process that never asks
// pays nothing for it.
var embedded = sync.OnceValue(func() domainSet {
	set, err := parse(bytes.NewReader(snapshot))
	if err != nil {
		// The snapshot is part of the binary, and a test parses it.
		panic(fmt.Sprintf("disposabledomains: embedded snapshot: %v", err))
	}
	return set
})

type domainSet map[string]struct{}

// Config builds a [List]. The zero value answers from the embedded snapshot.
type Config struct {
	// URL names a remote copy of the list to refresh from: one domain per
	// line, blank lines and lines starting with # ignored.
	URL        string
	HTTPClient *http.Client
	Logger     *slog.Logger
}

// ConfigFromEnv reads PUBLIRA_DISPOSABLE_EMAIL_DOMAINS_URL. Unset, the list is
// the embedded snapshot alone.
func ConfigFromEnv() (Config, error) {
	const name = "PUBLIRA_DISPOSABLE_EMAIL_DOMAINS_URL"
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return Config{}, nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return Config{}, fmt.Errorf("%s must be an absolute http or https URL", name)
	}
	return Config{URL: raw}, nil
}

// List answers whether a domain is disposable.
type List struct {
	// remote is nil when no URL is configured.
	remote *ttlcache.Value[domainSet]
}

func New(cfg Config) *List {
	if cfg.URL == "" {
		return &List{}
	}
	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: fetchTimeout}
	}
	remote := ttlcache.New(func(ctx context.Context) (domainSet, error) {
		// A reader who gives up on the sign-up must not leave the stale list
		// in place for another interval; the client's timeout bounds the read.
		return fetch(context.WithoutCancel(ctx), httpClient, cfg.URL)
	}, refreshInterval, cfg.Logger, "disposable email domain list")
	// Until the remote copy loads, and for as long as it never does, the
	// snapshot is the last good copy.
	remote.Seed(embedded())
	return &List{remote: remote}
}

// IsDisposable reports whether domain, or a domain it is a subdomain of, is on
// the list. A domain in Unicode is compared in its ASCII form, which is the
// form the list is written in.
//
// With a remote copy configured, the first call past each refresh interval
// reads it, and the calls behind it wait for that read.
func (l *List) IsDisposable(ctx context.Context, domain string) bool {
	set := embedded()
	if l.remote != nil {
		// A seeded value never fails to answer.
		set, _ = l.remote.Get(ctx)
	}
	name := normalize(domain)
	for name != "" {
		if _, ok := set[name]; ok {
			return true
		}
		_, parent, found := strings.Cut(name, ".")
		if !found {
			break
		}
		name = parent
	}
	return false
}

func normalize(domain string) string {
	domain = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(domain)), ".")
	if ascii, err := idna.Lookup.ToASCII(domain); err == nil {
		return ascii
	}
	return domain
}

func fetch(ctx context.Context, httpClient *http.Client, listURL string) (domainSet, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, listURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close() //nolint:errcheck
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxListBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxListBytes {
		return nil, fmt.Errorf("the list is larger than %d bytes", maxListBytes)
	}
	return parse(bytes.NewReader(body))
}

// parse reads a list one domain per line. A line that is not a domain of at
// least two labels refuses the whole list, so an error page served with a 200,
// or an entry naming a whole top-level domain, never replaces a good copy.
func parse(r io.Reader) (domainSet, error) {
	set := domainSet{}
	scanner := bufio.NewScanner(r)
	for line := 1; scanner.Scan(); line++ {
		entry := strings.TrimSpace(scanner.Text())
		if entry == "" || strings.HasPrefix(entry, "#") {
			continue
		}
		entry = strings.TrimSuffix(strings.ToLower(entry), ".")
		if !isDomain(entry) {
			return nil, fmt.Errorf("line %d is not a domain: %q", line, entry)
		}
		set[entry] = struct{}{}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if len(set) == 0 {
		return nil, errors.New("the list names no domain")
	}
	return set, nil
}

// isDomain accepts an ASCII host name of two labels or more, each made of
// letters, digits, and hyphens and neither starting nor ending with a hyphen.
func isDomain(name string) bool {
	if len(name) > 253 {
		return false
	}
	labels := strings.Split(name, ".")
	if len(labels) < 2 {
		return false
	}
	for _, label := range labels {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, c := range []byte(label) {
			if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '-' {
				return false
			}
		}
	}
	return true
}
