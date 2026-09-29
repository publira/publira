// Package revalidate records the Next.js cache tags a write leaves stale and
// sends them to the internal revalidation route of every web app.
//
// A writer goes through [Requester]: the tags are written down as an outbox
// event first, so nothing after that point can lose the drop, and the immediate
// attempt on top of it never makes a caller wait on a web app. [Client] is the
// sender underneath, held by the outbox handler that retries what the immediate
// attempt could not finish.
//
// The destinations are private network addresses (PUBLIRA_WEB_*_INTERNAL_URL),
// never the public domain a browser uses and never the reverse proxy: this is
// server-to-server traffic, and routing it through the edge would make an
// internal cache invalidation depend on the tenant domain in Host. Each app
// keeps its own Redis key space under PNCH_CACHE_APP, so a tag goes to every
// app that has a URL, and an app without one is not a destination at all: a
// deployment that runs no Platform Console leaves its URL unset rather than
// owing every drop to a process that does not exist.
//
// Tags are sent as they are, with no tenant restriction. A tag already names
// what it invalidates, and the apps that hold it are shared by every tenant.
package revalidate

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/publira/publira/server/internal/tracing"
)

type Client struct {
	targets    []target
	token      string
	httpClient *http.Client
	logger     *slog.Logger
}

type target struct {
	name    string
	env     string
	baseURL string
}

type requestPayload struct {
	Tags []string `json:"tags"`
}

const (
	revalidatePath = "/api/v1/revalidate"

	webHostInternalURLEnv     = "PUBLIRA_WEB_HOST_INTERNAL_URL"
	webAdminInternalURLEnv    = "PUBLIRA_WEB_ADMIN_INTERNAL_URL"
	webPlatformInternalURLEnv = "PUBLIRA_WEB_PLATFORM_INTERNAL_URL"
)

// NewClient returns nil when token is empty, which turns revalidation off. With
// a token it sends to every web app whose PUBLIRA_WEB_*_INTERNAL_URL is set,
// and reports an error when none is or one does not parse, so the process
// refuses to start on a configuration that can only be a mistake.
func NewClient(token string, logger *slog.Logger) (*Client, error) {
	normalizedToken := strings.TrimSpace(token)
	if normalizedToken == "" {
		return nil, nil
	}
	targets, err := targetsFromEnvironment()
	if err != nil {
		return nil, err
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Client{
		targets: targets,
		token:   normalizedToken,
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
			// Carries the trace context of the request that triggered
			// the revalidation into the Next.js app.
			Transport: tracing.Transport(http.DefaultTransport),
		},
		logger: logger,
	}, nil
}

func (c *Client) RevalidateTags(ctx context.Context, tags []string) error {
	if c == nil {
		return nil
	}
	normalizedTags := normalizeTags(tags)
	if len(normalizedTags) == 0 {
		return nil
	}

	var (
		errs []error
		mu   sync.Mutex
		wg   sync.WaitGroup
	)
	for _, revalidationTarget := range c.targets {
		wg.Add(1)
		go func(revalidationTarget target) {
			defer wg.Done()
			endpoint, err := buildEndpoint(revalidationTarget.baseURL)
			if err == nil {
				err = c.sendRequest(
					ctx,
					endpoint,
					normalizedTags,
					revalidationTarget.name,
				)
			}
			if err != nil {
				mu.Lock()
				errs = append(errs, fmt.Errorf("%s: %w", revalidationTarget.name, err))
				mu.Unlock()
			}
		}(revalidationTarget)
	}
	wg.Wait()
	return errors.Join(errs...)
}

// Destinations names the web apps the client sends to, for the process to log
// at startup.
func (c *Client) Destinations() []string {
	if c == nil {
		return nil
	}
	names := make([]string, 0, len(c.targets))
	for _, revalidationTarget := range c.targets {
		names = append(names, revalidationTarget.name)
	}
	return names
}

func targetsFromEnvironment() ([]target, error) {
	candidates := []target{
		{name: "web-host", env: webHostInternalURLEnv},
		{name: "web-admin", env: webAdminInternalURLEnv},
		{name: "web-platform", env: webPlatformInternalURLEnv},
	}
	var targets []target
	for _, candidate := range candidates {
		candidate.baseURL = strings.TrimSpace(os.Getenv(candidate.env))
		if candidate.baseURL == "" {
			continue
		}
		if _, err := buildEndpoint(candidate.baseURL); err != nil {
			return nil, fmt.Errorf("%s: %w", candidate.env, err)
		}
		targets = append(targets, candidate)
	}
	if len(targets) == 0 {
		return nil, fmt.Errorf(
			"PUBLIRA_REVALIDATE_TOKEN is set but none of %s, %s, or %s is",
			webHostInternalURLEnv, webAdminInternalURLEnv, webPlatformInternalURLEnv,
		)
	}
	return targets, nil
}

func buildEndpoint(baseURL string) (string, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", fmt.Errorf("invalid revalidate base url %q: %w", baseURL, err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("invalid revalidate base url %q", baseURL)
	}
	parsed.Path = path.Join(parsed.Path, revalidatePath)
	parsed.RawPath = ""
	return parsed.String(), nil
}

func (c *Client) sendRequest(ctx context.Context, endpoint string, tags []string, targetName string) error {
	payload, err := json.Marshal(requestPayload{
		Tags: tags,
	})
	if err != nil {
		return fmt.Errorf("marshal revalidate payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create revalidate request: %w", err)
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-revalidate-token", c.token)

	res, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send revalidate request: %w", err)
	}
	defer res.Body.Close() //nolint:errcheck

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		return fmt.Errorf("revalidate endpoint returned status=%d body=%q", res.StatusCode, strings.TrimSpace(string(body)))
	}

	c.logger.InfoContext(
		ctx,
		"next revalidate requested",
		"target", targetName,
		"tags", tags,
		"endpoint", endpoint,
	)
	return nil
}

func normalizeTags(tags []string) []string {
	if len(tags) == 0 {
		return nil
	}
	uniq := make(map[string]struct{}, len(tags))
	normalized := make([]string, 0, len(tags))
	for _, raw := range tags {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			continue
		}
		if _, ok := uniq[trimmed]; ok {
			continue
		}
		uniq[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	return normalized
}
