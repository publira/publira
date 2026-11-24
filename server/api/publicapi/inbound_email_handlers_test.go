package publicapi

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestInboundReplyBody(t *testing.T) {
	cases := []struct {
		name      string
		text      string
		want      string
		truncated bool
	}{
		{name: "a reply above a quotation", text: "It opens now.\r\n\r\n> We have restored your purchase.", want: "It opens now."},
		// Still the reader writing back, so the whole text is kept rather than
		// nothing.
		{name: "nothing but a quotation", text: "> We have restored your purchase.\r\n", want: "> We have restored your purchase."},
		{name: "a NUL", text: "ok\x00", want: "ok"},
		{name: "invalid UTF-8", text: "ok\xff", want: "ok�"},
		{name: "nothing", text: " \n ", want: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			body, truncated := inboundReplyBody(tc.text)
			if body != tc.want || truncated != tc.truncated {
				t.Fatalf("inboundReplyBody(%q) = (%q, %v), want (%q, %v)", tc.text, body, truncated, tc.want, tc.truncated)
			}
		})
	}

	body, truncated := inboundReplyBody(strings.Repeat("a", maxContactBodyRunes+10))
	if !truncated || utf8.RuneCountInString(body) != maxContactBodyRunes {
		t.Fatalf("a long reply = %d characters, truncated %v", utf8.RuneCountInString(body), truncated)
	}
}

// A provider that posts the parsed text can hand over far more than a raw
// mail's text part holds. What lies past the bound is not read, so a line of
// the reader's own there does not keep the quotation above it.
func TestInboundReplyBodyReadsABoundedText(t *testing.T) {
	quote := strings.Repeat("> We have restored your purchase.\n", maxInboundEmailTextBytes/32)
	body, truncated := inboundReplyBody("It opens now.\n\n" + quote + "Thanks.")
	if body != "It opens now." || truncated {
		t.Fatalf("inboundReplyBody = (%q, %v), want (%q, false)", body, truncated, "It opens now.")
	}
}
