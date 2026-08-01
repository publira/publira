package revalidate

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
)

type Client struct {
	token      string
	httpClient *http.Client
	logger     *slog.Logger
}

type requestPayload struct {
	TenantID string   `json:"tenantId"`
	Tags           []string `json:"tags"`
}

const (
	internalRevalidateBaseURL = "http://traefik"
	revalidatePath            = "/api/revalidate"
)

func NewClient(token string, logger *slog.Logger) *Client {
	normalizedToken := strings.TrimSpace(token)
	if normalizedToken == "" {
		return nil
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Client{
		token: normalizedToken,
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
		logger: logger,
	}
}

func (c *Client) RevalidateTags(ctx context.Context, tenantID, tenantDomain string, tags []string) error {
	if c == nil {
		return nil
	}
	normalizedTenantID := strings.TrimSpace(tenantID)
	if normalizedTenantID == "" {
		return fmt.Errorf("tenantId is required")
	}
	normalizedTenantDomain, err := normalizeTenantDomain(tenantDomain)
	if err != nil {
		return err
	}

	normalizedTags := filterAllowedTenantTags(
		normalizeTags(tags),
		normalizedTenantID,
	)
	if len(normalizedTags) == 0 {
		return nil
	}

	endpoint, err := buildEndpoint(internalRevalidateBaseURL, revalidatePath)
	if err != nil {
		return err
	}
	return c.sendRequest(ctx, endpoint, normalizedTenantID, normalizedTenantDomain, normalizedTags)
}

func buildEndpoint(baseURL, reqPath string) (string, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", fmt.Errorf("invalid revalidate base url %q: %w", baseURL, err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("invalid revalidate base url %q", baseURL)
	}
	parsed.Path = path.Join(parsed.Path, reqPath)
	parsed.RawPath = ""
	return parsed.String(), nil
}

func (c *Client) sendRequest(ctx context.Context, endpoint, tenantID, tenantDomain string, tags []string) error {
	payload, err := json.Marshal(requestPayload{
		TenantID: tenantID,
		Tags:           tags,
	})
	if err != nil {
		return fmt.Errorf("marshal revalidate payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create revalidate request: %w", err)
	}
	req.Host = tenantDomain
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-revalidate-token", c.token)
	req.Header.Set("x-forwarded-host", tenantDomain)

	res, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send revalidate request: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		return fmt.Errorf("revalidate endpoint returned status=%d body=%q", res.StatusCode, strings.TrimSpace(string(body)))
	}

	c.logger.Info(
		"next revalidate requested",
		"tenant_id", tenantID,
		"tenant_domain", tenantDomain,
		"tags", tags,
		"endpoint", endpoint,
	)
	return nil
}

func filterAllowedTenantTags(tags []string, tenantID string) []string {
	if len(tags) == 0 {
		return nil
	}
	prefix := fmt.Sprintf("tenant:%s:", tenantID)

	filtered := make([]string, 0, len(tags))
	for _, tag := range tags {
		if strings.HasPrefix(tag, prefix) {
			filtered = append(filtered, tag)
		}
	}
	return filtered
}

func normalizeTenantDomain(tenantDomain string) (string, error) {
	normalized := strings.TrimSpace(tenantDomain)
	if normalized == "" {
		return "", fmt.Errorf("tenant domain is required")
	}
	if strings.Contains(normalized, "://") {
		parsed, err := url.Parse(normalized)
		if err != nil {
			return "", fmt.Errorf("invalid tenant domain: %w", err)
		}
		normalized = strings.TrimSpace(parsed.Host)
	}
	normalized = strings.Trim(normalized, "/")
	if normalized == "" {
		return "", fmt.Errorf("tenant domain is required")
	}
	return normalized, nil
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
