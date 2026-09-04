package publicapi

import (
	"strings"
	"testing"

	"connectrpc.com/connect"
)

// The rest of CommentService is asserted against a real database in
// comment_db_integration_test.go: the tenant's comment mode, the episode body
// access rule, and who may read a comment in each state are all decided by
// stored rows, and canned sqlmock replies would only restate the answers the
// test itself supplied.

func TestValidateCommentBody(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		want     string
		wantCode connect.Code
	}{
		{
			name: "trims the surrounding whitespace it stores",
			body: "  A comment.\n",
			want: "A comment.",
		},
		{
			name: "keeps a body of exactly the limit",
			body: strings.Repeat("a", maxCommentBodyRunes),
			want: strings.Repeat("a", maxCommentBodyRunes),
		},
		{
			// The limit counts code points, so a body of multi-byte characters is
			// as long as one of ASCII rather than a third of it.
			name: "measures multi-byte characters as one each",
			body: strings.Repeat("あ", maxCommentBodyRunes),
			want: strings.Repeat("あ", maxCommentBodyRunes),
		},
		{
			// Whitespace is removed before the length is measured, so padding
			// cannot push an acceptable body over the limit.
			name: "trims before measuring",
			body: "  " + strings.Repeat("a", maxCommentBodyRunes) + "  ",
			want: strings.Repeat("a", maxCommentBodyRunes),
		},
		{
			name:     "rejects an empty body",
			body:     "",
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name:     "rejects a body of nothing but whitespace",
			body:     " \t\n　",
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name:     "rejects a body over the limit",
			body:     strings.Repeat("a", maxCommentBodyRunes+1),
			wantCode: connect.CodeInvalidArgument,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := validateCommentBody(test.body)
			if test.wantCode != 0 {
				if connect.CodeOf(err) != test.wantCode {
					t.Fatalf("validateCommentBody(%q) error = %v, want %v", test.body, err, test.wantCode)
				}
				return
			}
			if err != nil {
				t.Fatalf("validateCommentBody(%q): %v", test.body, err)
			}
			if got != test.want {
				t.Fatalf("validateCommentBody(%q) = %q, want %q", test.body, got, test.want)
			}
		})
	}
}
