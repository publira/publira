package catalogslug_test

import (
	"errors"
	"testing"

	"github.com/publira/publira/server/internal/catalogslug"
)

func TestFromName(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "lowercases", input: "Fantasy", want: "fantasy"},
		{name: "trims surrounding space", input: "  Fantasy  ", want: "fantasy"},
		{name: "joins words with one hyphen", input: "Slice   of Life", want: "slice-of-life"},
		{name: "drops punctuation", input: "Sci-Fi & Fantasy!", want: "sci-fi-fantasy"},
		{name: "keeps digits", input: "Top 100", want: "top-100"},
		{name: "keeps non-latin letters", input: "恋愛", want: "恋愛"},
		{name: "folds full-width letters onto their ascii forms", input: "Ｆａｎｔａｓｙ", want: "fantasy"},
		{name: "folds half-width katakana onto the composed form", input: "ﾌｧﾝﾀｼﾞｰ", want: "ファンタジー"},
		{name: "drops leading and trailing separators", input: "--Fantasy--", want: "fantasy"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := catalogslug.FromName(tt.input)
			if err != nil {
				t.Fatalf("FromName(%q): %v", tt.input, err)
			}
			if got != tt.want {
				t.Fatalf("FromName(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestFromNameGivesTheSameSlugToNamesThatDifferOnlyInCaseOrSpacing(t *testing.T) {
	first, err := catalogslug.FromName("Slice of Life")
	if err != nil {
		t.Fatalf("FromName: %v", err)
	}
	second, err := catalogslug.FromName("  slice   OF  life ")
	if err != nil {
		t.Fatalf("FromName: %v", err)
	}
	if first != second {
		t.Fatalf("slugs = %q and %q, want the same slug", first, second)
	}
}

func TestFromNameRejectsANameWithNoLetterOrDigit(t *testing.T) {
	for _, input := range []string{"", "   ", "!!!", "---"} {
		if _, err := catalogslug.FromName(input); !errors.Is(err, catalogslug.ErrEmpty) {
			t.Fatalf("FromName(%q) error = %v, want ErrEmpty", input, err)
		}
	}
}
