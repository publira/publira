package adminapi

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect"
)

func TestNormalizeCatalogNameTrimsAndSlugs(t *testing.T) {
	normalized, err := normalizeCatalogName("  Slice of Life  ", "name")
	if err != nil {
		t.Fatalf("normalizeCatalogName: %v", err)
	}
	if normalized.name != "Slice of Life" {
		t.Fatalf("name = %q, want the trimmed name", normalized.name)
	}
	if normalized.slug != "slice-of-life" {
		t.Fatalf("slug = %q, want slice-of-life", normalized.slug)
	}
}

func TestNormalizeCatalogNameRejects(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{name: "an empty name", input: "   "},
		{name: "a name with nothing to slug", input: "!!!"},
		{name: "a name past the length bound", input: strings.Repeat("a", maxCatalogNameRunes+1)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := normalizeCatalogName(tt.input, "name")
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("normalizeCatalogName error code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
			}
		})
	}
}

func TestNormalizeCatalogNameCountsRunesNotBytes(t *testing.T) {
	// A name at the bound in code points is well past it in bytes once it is
	// written in a script that costs three bytes a character.
	if _, err := normalizeCatalogName(strings.Repeat("恋", maxCatalogNameRunes), "name"); err != nil {
		t.Fatalf("normalizeCatalogName: %v", err)
	}
}

func TestNormalizeTagNamesCountsNamesSharingASlugOnce(t *testing.T) {
	tags, err := normalizeTagNames([]string{"Time Travel", "  time   travel ", "School Life"})
	if err != nil {
		t.Fatalf("normalizeTagNames: %v", err)
	}
	slugs := make([]string, 0, len(tags))
	for _, tag := range tags {
		slugs = append(slugs, tag.slug)
	}
	if !slices.Equal(slugs, []string{"time-travel", "school-life"}) {
		t.Fatalf("slugs = %v, want the two spellings counted once", slugs)
	}
	if tags[0].name != "Time Travel" {
		t.Fatalf("name = %q, want the first spelling to be the one stored", tags[0].name)
	}
}

func TestNormalizeTagNamesRefusesMoreThanTheLimit(t *testing.T) {
	names := make([]string, 0, maxSeriesTags+1)
	for i := range maxSeriesTags + 1 {
		names = append(names, fmt.Sprintf("tag %d", i))
	}

	if _, err := normalizeTagNames(names); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("normalizeTagNames error code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}

	// Duplicates are counted once, so a list that only looks too long is
	// accepted rather than refused for something the editor cannot see.
	atLimit := append(names[:maxSeriesTags:maxSeriesTags], names[0])
	if _, err := normalizeTagNames(atLimit); err != nil {
		t.Fatalf("normalizeTagNames at the limit: %v", err)
	}
}
