// Package disposabledomains answers whether an email domain belongs to a
// service made for throwaway addresses.
//
// The list is read from the URL the platform policy names
// (platformpolicy.Policy.DisposableEmailDomainsURL, saved through
// PlatformPolicyService or publiractl policy set), in the format of the
// disposable-email-domains project's blocklist
// (https://github.com/disposable-email-domains/disposable-email-domains). No
// copy ships with the server, so a platform that names no URL, or one whose
// read has never succeeded, has no domain disposable.
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
	"strings"
	"sync"
	"time"

	"golang.org/x/net/idna"

	"github.com/publira/publira/server/internal/platformpolicy"
	"github.com/publira/publira/server/internal/ttlcache"
)

const (
	// refreshInterval is how long a list answers before it is read again, and
	// how long a failed read waits before the next one. With no copy shipped,
	// a read that fails at start leaves no list until the next one, so the
	// interval is kept to an hour; a list of a few hundred kilobytes read
	// hourly costs nothing worth trading that gap for.
	refreshInterval = time.Hour
	// fetchTimeout bounds one read of the list. Every lookup behind the read
	// waits for it, so it is bounded whatever client the List was given.
	fetchTimeout = 10 * time.Second
	// maxListBytes bounds what a list may weigh. The maintained lists run to a
	// few megabytes at the most, so a body past this is not one.
	maxListBytes = 16 << 20
)

type domainSet map[string]struct{}

// List answers whether a domain is disposable, from the list at the URL the
// platform policy names.
type List struct {
	policy       platformpolicy.Source
	httpClient   *http.Client
	logger       *slog.Logger
	fetchTimeout time.Duration

	// Now is the clock the refresh interval is measured on, replaceable by
	// tests before the first lookup.
	Now func() time.Time

	mu sync.Mutex
	// url is the URL list is read from, and list is nil until a lookup finds
	// the policy naming one.
	url  string
	list *ttlcache.Value[domainSet]
}

// New returns a List that reads the URL from policy on every lookup, so a
// saved change reaches it as soon as policy answers it. A nil httpClient reads
// with http.DefaultClient.
func New(policy platformpolicy.Source, httpClient *http.Client, logger *slog.Logger) *List {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &List{policy: policy, httpClient: httpClient, logger: logger, fetchTimeout: fetchTimeout, Now: time.Now}
}

// IsDisposable reports whether domain, or a domain it is a subdomain of, is on
// the list. A domain in Unicode is compared in its ASCII form, which is the
// form the list is written in. The error is the policy's: the list itself
// never fails a lookup, and answers from the last copy that loaded, or from
// no list until one has.
//
// The first call past each refresh interval reads the list, and the calls
// behind it wait for that read.
func (l *List) IsDisposable(ctx context.Context, domain string) (bool, error) {
	policy, err := l.policy.Policy(ctx)
	if err != nil {
		return false, err
	}
	if policy.DisposableEmailDomainsURL == "" {
		return false, nil
	}
	// A seeded value never fails to answer.
	set, _ := l.listAt(policy.DisposableEmailDomainsURL).Get(ctx)
	name := normalize(domain)
	for name != "" {
		if _, ok := set[name]; ok {
			return true, nil
		}
		_, parent, found := strings.Cut(name, ".")
		if !found {
			break
		}
		name = parent
	}
	return false, nil
}

// listAt answers the list read from listURL. A URL other than the last one
// starts over from no list and reads at once: what was read from the old URL
// is not the list the operator now names.
func (l *List) listAt(listURL string) *ttlcache.Value[domainSet] {
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.list != nil && l.url == listURL {
		return l.list
	}
	list := ttlcache.New(func(ctx context.Context) (domainSet, error) {
		// A reader who gives up on the sign-up must not leave the list unread
		// for another interval, so the read drops the caller's cancellation
		// and takes a deadline of its own instead.
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), l.fetchTimeout)
		defer cancel()
		return fetch(ctx, l.httpClient, listURL)
	}, refreshInterval, l.logger, "disposable email domain list")
	list.Now = l.Now
	// An empty list stands in until the first read succeeds, so a list that
	// is down from the start is asked once an interval like one that went
	// down later, rather than on every sign-up.
	list.Seed(domainSet{})
	l.url, l.list = listURL, list
	return list
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
