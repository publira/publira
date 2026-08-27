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
	baseURL string
}

type requestPayload struct {
	Tags []string `json:"tags"`
}

const (
	revalidatePath = "/api/revalidate"

	webHostInternalURLEnv     = "PUBLIRA_WEB_HOST_INTERNAL_URL"
	webAdminInternalURLEnv    = "PUBLIRA_WEB_ADMIN_INTERNAL_URL"
	webPlatformInternalURLEnv = "PUBLIRA_WEB_PLATFORM_INTERNAL_URL"
)

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

func targetsFromEnvironment() ([]target, error) {
	targets := []target{
		{name: "web-host", baseURL: strings.TrimSpace(os.Getenv(webHostInternalURLEnv))},
		{name: "web-admin", baseURL: strings.TrimSpace(os.Getenv(webAdminInternalURLEnv))},
		{name: "web-platform", baseURL: strings.TrimSpace(os.Getenv(webPlatformInternalURLEnv))},
	}
	for _, revalidationTarget := range targets {
		if revalidationTarget.baseURL == "" {
			return nil, fmt.Errorf("%s is required when PUBLIRA_REVALIDATE_TOKEN is configured", targetEnv(revalidationTarget.name))
		}
		if _, err := buildEndpoint(revalidationTarget.baseURL); err != nil {
			return nil, fmt.Errorf("%s: %w", targetEnv(revalidationTarget.name), err)
		}
	}
	return targets, nil
}

func targetEnv(name string) string {
	switch name {
	case "web-host":
		return webHostInternalURLEnv
	case "web-admin":
		return webAdminInternalURLEnv
	default:
		return webPlatformInternalURLEnv
	}
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
