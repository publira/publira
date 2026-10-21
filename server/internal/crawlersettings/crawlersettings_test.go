package crawlersettings

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"testing"
)

func TestNormalizeOrdersUserAgentsAsKnownListsThem(t *testing.T) {
	got, err := Normalize(Settings{UserAgents: []string{"Googlebot-Image", "GPTBot", "Googlebot-Image", "ClaudeBot"}})
	if err != nil {
		t.Fatalf("Normalize: %v", err)
	}
	if want := []string{"GPTBot", "ClaudeBot", "Googlebot-Image"}; !slices.Equal(got.UserAgents, want) {
		t.Fatalf("user agents = %q, want %q", got.UserAgents, want)
	}
}

func TestNormalizeRefusesAUserAgentOutsideTheKnownList(t *testing.T) {
	for _, userAgent := range []string{"Googlebot", "gptbot", " GPTBot", "*", ""} {
		_, err := Normalize(Settings{UserAgents: []string{"GPTBot", userAgent}})
		var entryErr *EntryError
		if !errors.As(err, &entryErr) || !errors.Is(err, ErrUnknownUserAgent) {
			t.Fatalf("%q: err = %v, want ErrUnknownUserAgent", userAgent, err)
		}
		if field := entryErr.Field(); field != "settings.excluded_user_agents[1]" {
			t.Fatalf("%q: field = %q, want settings.excluded_user_agents[1]", userAgent, field)
		}
	}
}

func TestNormalizeTrimsSortsAndDeduplicatesPaths(t *testing.T) {
	got, err := Normalize(Settings{Paths: []string{" /series/SERIESA00001/ ", "/drafts", "/drafts/", "/", "//", "/sitemapping", "/en/sitemap.xml"}})
	if err != nil {
		t.Fatalf("Normalize: %v", err)
	}
	want := []string{"/", "/drafts", "/en/sitemap.xml", "/series/SERIESA00001", "/sitemapping"}
	if !slices.Equal(got.Paths, want) {
		t.Fatalf("paths = %q, want %q", got.Paths, want)
	}
}

func TestNormalizeRefusesAnInvalidPath(t *testing.T) {
	for _, tc := range []struct {
		path string
		want error
	}{
		{"drafts", ErrInvalidPath},
		{"", ErrInvalidPath},
		{"/my drafts", ErrInvalidPath},
		{"/drafts\tx", ErrInvalidPath},
		{"/drafts　x", ErrInvalidPath},
		{"/drafts\x00", ErrInvalidPath},
		{"/drafts/*", ErrInvalidPath},
		{"/drafts$", ErrInvalidPath},
		{"/search?q=x", ErrInvalidPath},
		{"/drafts#top", ErrInvalidPath},
		{"/" + strings.Repeat("a", MaxPathLength), ErrPathTooLong},
		{"/robots.txt", ErrReservedPath},
		{"/sitemap.xml", ErrReservedPath},
		{"/sitemap", ErrReservedPath},
		{"/sitemap/", ErrReservedPath},
		{"/sitemap/series-1.xml", ErrReservedPath},
	} {
		_, err := Normalize(Settings{Paths: []string{"/drafts", tc.path}})
		var entryErr *EntryError
		if !errors.As(err, &entryErr) || !errors.Is(err, tc.want) {
			t.Fatalf("%q: err = %v, want %v", tc.path, err, tc.want)
		}
		if field := entryErr.Field(); field != "settings.excluded_paths[1]" {
			t.Fatalf("%q: field = %q, want settings.excluded_paths[1]", tc.path, field)
		}
	}
}

func TestNormalizeAcceptsAPathAtTheLengthLimit(t *testing.T) {
	path := "/" + strings.Repeat("a", MaxPathLength-1)
	got, err := Normalize(Settings{Paths: []string{path}})
	if err != nil || !slices.Equal(got.Paths, []string{path}) {
		t.Fatalf("Normalize = %v, %v, want the path kept", got, err)
	}
}

func TestNormalizeRefusesTooManyPaths(t *testing.T) {
	paths := make([]string, 0, MaxPaths+1)
	for i := range MaxPaths + 1 {
		paths = append(paths, fmt.Sprintf("/drafts/%d", i))
	}
	if _, err := Normalize(Settings{Paths: paths[:MaxPaths]}); err != nil {
		t.Fatalf("%d paths: %v", MaxPaths, err)
	}
	_, err := Normalize(Settings{Paths: paths})
	var entryErr *EntryError
	if !errors.As(err, &entryErr) || !errors.Is(err, ErrTooManyPaths) {
		t.Fatalf("err = %v, want ErrTooManyPaths", err)
	}
	if field := entryErr.Field(); field != "settings.excluded_paths" {
		t.Fatalf("field = %q, want settings.excluded_paths", field)
	}
}

// productTokenPattern is the product-token production of RFC 9309.
var productTokenPattern = regexp.MustCompile(`^[A-Za-z_-]+$`)

func TestKnownNamesEveryTokenOnceWithAPurpose(t *testing.T) {
	seen := map[string]bool{}
	var previous Purpose
	for _, crawler := range Known() {
		if crawler.Purpose < previous {
			t.Fatalf("%s comes after a crawler of a later purpose, want the list grouped by purpose", crawler.UserAgent)
		}
		previous = crawler.Purpose
		if seen[crawler.UserAgent] {
			t.Fatalf("%s is listed twice", crawler.UserAgent)
		}
		seen[crawler.UserAgent] = true
		if crawler.Operator == "" || crawler.Purpose < PurposeAITraining || crawler.Purpose > PurposeImageSearch {
			t.Fatalf("%s = %+v, want an operator and a purpose", crawler.UserAgent, crawler)
		}
		// A token is written into a User-agent line as it is, so it holds
		// only what RFC 9309 allows in a product token.
		if !productTokenPattern.MatchString(crawler.UserAgent) {
			t.Fatalf("%q is not a product token", crawler.UserAgent)
		}
	}
	for _, purpose := range []Purpose{PurposeAITraining, PurposeAIAssistant, PurposeImageSearch} {
		if !slices.ContainsFunc(Known(), func(c Crawler) bool { return c.Purpose == purpose }) {
			t.Fatalf("no crawler has purpose %d", purpose)
		}
	}
}
