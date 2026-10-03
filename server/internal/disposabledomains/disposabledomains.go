// Package disposabledomains answers whether an email domain belongs to a
// service made for throwaway addresses.
//
// The list is read from the URL in PUBLIRA_DISPOSABLE_EMAIL_DOMAINS_URL, in the
// format of the disposable-email-domains project's blocklist
// (https://github.com/disposable-email-domains/disposable-email-domains). No
// copy ships with the server, so a process without the URL, or one whose read
// has never succeeded, names no domain disposable.
package disposabledomains

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"golang.org/x/net/idna"

	"github.com/publira/publira/server/internal/ttlcache"
)

const (
	// refreshInterval is how long a list answers before it is read again, and
	// how long a failed read waits before the next one. With no copy shipped,
	// a read that fails at start leaves no list until the next one, so the
	// interval is kept to an hour; a list of a few hundred kilobytes read
	// hourly costs nothing worth trading that gap for.
	refreshInterval = time.Hour
	fetchTimeout    = 10 * time.Second
	// maxListBytes bounds what a list may weigh. The maintained lists run to a
	// few megabytes at the most, so a body past this is not one.
	maxListBytes = 16 << 20
)

type domainSet map[string]struct{}

// Config builds a [List]. The zero value names no domain disposable.
type Config struct {
	// URL names the list: one domain per line, blank lines and lines starting
	// with # ignored.
	URL        string
	HTTPClient *http.Client
	Logger     *slog.Logger
}

// ConfigFromEnv reads PUBLIRA_DISPOSABLE_EMAIL_DOMAINS_URL. Unset, there is no
// list.
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
		// A reader who gives up on the sign-up must not leave the list unread
		// for another interval; the client's timeout bounds the read.
		return fetch(context.WithoutCancel(ctx), httpClient, cfg.URL)
	}, refreshInterval, cfg.Logger, "disposable email domain list")
	// An empty list stands in until the first read succeeds, so a remote that
	// is down from the start is asked once an interval like one that went
	// down later, rather than on every sign-up.
	remote.Seed(domainSet{})
	return &List{remote: remote}
}

// IsDisposable reports whether domain, or a domain it is a subdomain of, is on
// the list. A domain in Unicode is compared in its ASCII form, which is the
// form the list is written in.
//
// The first call past each refresh interval reads the list, and the calls
// behind it wait for that read.
func (l *List) IsDisposable(ctx context.Context, domain string) bool {
	if l.remote == nil {
		return false
	}
	// A seeded value never fails to answer.
	set, _ := l.remote.Get(ctx)
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
