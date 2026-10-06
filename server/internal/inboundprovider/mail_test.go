package inboundprovider

import (
	"slices"
	"strings"
	"testing"
)

func TestParseMessageIDs(t *testing.T) {
	cases := map[string][]string{
		"<a@example.com>":                         {"a@example.com"},
		"<a@example.com>\r\n <b@example.com>":     {"a@example.com", "b@example.com"},
		"<a@example.com> (comment) <b@example.c>": {"a@example.com", "b@example.c"},
		"a@example.com b@example.com":             {"a@example.com", "b@example.com"},
		"<>":                                      nil,
		"":                                        nil,
		"<unterminated@example.com":               nil,
	}
	for value, want := range cases {
		if got := ParseMessageIDs(value); !slices.Equal(got, want) {
			t.Errorf("ParseMessageIDs(%q) = %q, want %q", value, got, want)
		}
	}
}

func TestParseAddressListKeepsTheItemsThatParse(t *testing.T) {
	got := ParseAddressList(`Example <a@example.com>, not an address, "B" <b@example.com>`)
	if !slices.Equal(got, []string{"a@example.com", "b@example.com"}) {
		t.Fatalf("ParseAddressList = %q", got)
	}
}

func TestAppendRecipientsLeavesOutDuplicatesInAnyCase(t *testing.T) {
	got := AppendRecipients([]string{"a@example.com"}, "A@EXAMPLE.COM", "", "b@example.com", "b@example.com")
	if !slices.Equal(got, []string{"a@example.com", "b@example.com"}) {
		t.Fatalf("AppendRecipients = %q", got)
	}
}

func TestReadMIMEPrefersThePlainTextPart(t *testing.T) {
	raw := strings.ReplaceAll(`From: Reader <reader@example.net>
To: contact@reply.example.com
Subject: Re: Hello
Message-ID: <m1@example.net>
Content-Type: multipart/alternative; boundary="b1"

--b1
Content-Type: text/html; charset=utf-8

<p>From the HTML part</p>
--b1
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: base64

RnJvbSB0aGUgcGxhaW4gcGFydA==
--b1--
`, "\n", "\r\n")
	header, text, err := ReadMIME([]byte(raw))
	if err != nil {
		t.Fatalf("ReadMIME: %v", err)
	}
	if text != "From the plain part" {
		t.Errorf("text = %q", text)
	}
	if header.Get("Subject") != "Re: Hello" {
		t.Errorf("Subject = %q", header.Get("Subject"))
	}
}

func TestReadMIMERendersAnHTMLOnlyMail(t *testing.T) {
	raw := "From: reader@example.net\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<p>It works=\r\n now.</p><blockquote>Please try again.</blockquote>\r\n"
	_, text, err := ReadMIME([]byte(raw))
	if err != nil {
		t.Fatalf("ReadMIME: %v", err)
	}
	if text != "It works now.\n\n> Please try again." {
		t.Fatalf("text = %q", text)
	}
}

func TestReadMIMESkipsAttachments(t *testing.T) {
	raw := strings.ReplaceAll(`From: reader@example.net
Content-Type: multipart/mixed; boundary="b1"

--b1
Content-Type: text/plain
Content-Disposition: attachment; filename="notes.txt"

Not the reply
--b1
Content-Type: text/plain

The reply
--b1--
`, "\n", "\r\n")
	_, text, err := ReadMIME([]byte(raw))
	if err != nil {
		t.Fatalf("ReadMIME: %v", err)
	}
	if text != "The reply" {
		t.Fatalf("text = %q", text)
	}
}

func TestHTMLToText(t *testing.T) {
	got := HTMLToText(`<html><head><style>p{}</style></head><body><div>First line<br>Second   line</div><p>Para&amp;graph</p><script>x()</script></body></html>`)
	if got != "First line\nSecond line\n\nPara&graph" {
		t.Fatalf("HTMLToText = %q", got)
	}
}
