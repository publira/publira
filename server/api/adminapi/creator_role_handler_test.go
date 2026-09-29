package adminapi

import (
	"strings"
	"testing"

	"connectrpc.com/connect"
)

func TestNormalizeCreatorRoleNameTrims(t *testing.T) {
	name, err := normalizeCreatorRoleName("  Original Author  ")
	if err != nil {
		t.Fatalf("normalizeCreatorRoleName: %v", err)
	}
	if name != "Original Author" {
		t.Fatalf("name = %q, want the trimmed name", name)
	}
}

func TestNormalizeCreatorRoleNameRejects(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{name: "an empty name", input: "   "},
		{name: "a name past the length bound", input: strings.Repeat("a", maxCreatorRoleNameRunes+1)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := normalizeCreatorRoleName(tt.input)
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("normalizeCreatorRoleName error code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
			}
		})
	}
}

// A role name is not slugged, so unlike a genre it may be written in
// punctuation alone; what it may not be is longer in code points than the bound,
// however many bytes those cost.
func TestNormalizeCreatorRoleNameCountsRunesNotBytes(t *testing.T) {
	if _, err := normalizeCreatorRoleName(strings.Repeat("原", maxCreatorRoleNameRunes)); err != nil {
		t.Fatalf("normalizeCreatorRoleName: %v", err)
	}
	if _, err := normalizeCreatorRoleName(strings.Repeat("原", maxCreatorRoleNameRunes+1)); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("normalizeCreatorRoleName error code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
}
