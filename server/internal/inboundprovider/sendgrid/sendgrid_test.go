package sendgrid_test

import (
	"errors"
	"net/http"
	"os"
	"slices"
	"testing"

	"golang.org/x/text/encoding/japanese"

	"github.com/publira/publira/server/internal/inboundprovider"
	"github.com/publira/publira/server/internal/inboundprovider/sendgrid"
	"github.com/publira/publira/server/internal/inboundprovider/sendgrid/sendgridtest"
)

const token = "recorded-token"

var credentials = inboundprovider.Credentials{sendgrid.FieldWebhookToken: token}

// recorded answers a request Inbound Parse posted, as it was received, with
// the form boundary SendGrid used.
func recorded(t *testing.T, name string) ([]byte, http.Header) {
	t.Helper()
	payload, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	headers := http.Header{}
	headers.Set("Content-Type", "multipart/form-data; boundary=xYzZY")
	headers.Set("Authorization", sendgridtest.BasicAuth(token))
	headers.Set("User-Agent", "Sendlib/1.0 mx0047p1mdw1.sendgrid.net")
	return payload, headers
}

func parse(t *testing.T, payload []byte, headers http.Header) inboundprovider.Message {
	t.Helper()
	result, err := sendgrid.New().ParseWebhook(t.Context(), payload, headers, credentials)
	if err != nil {
		t.Fatalf("ParseWebhook: %v", err)
	}
	msg, ok := result.(inboundprovider.Message)
	if !ok {
		t.Fatalf("result = %T, want Message", result)
	}
	return msg
}

func TestParseWebhookReadsTheDefaultForm(t *testing.T) {
	payload, headers := recorded(t, "inbound_parse.multipart")
	msg := parse(t, payload, headers)

	if msg.From != "alex.reader@example.net" {
		t.Errorf("From = %q", msg.From)
	}
	if !slices.Equal(msg.Recipients, []string{"contact+7Hn3QzW9kPfa@reply.example.com"}) {
		t.Errorf("Recipients = %q", msg.Recipients)
	}
	if msg.Subject != "Re: About my purchase" {
		t.Errorf("Subject = %q", msg.Subject)
	}
	if msg.MessageID != "CAJ4k2m1+9xQ@mail.example.net" || msg.ID != msg.MessageID {
		t.Errorf("MessageID = %q, ID = %q", msg.MessageID, msg.ID)
	}
	want := []string{"0f3c2b8e-1d7a-4c55-9a3e-4b1f0d2c9e11@shop.example.com"}
	if !slices.Equal(msg.InReplyTo, want) || !slices.Equal(msg.References, want) {
		t.Errorf("InReplyTo = %q, References = %q", msg.InReplyTo, msg.References)
	}
	if got := inboundprovider.StripQuoted(msg.Text); got != "Thanks, the episode opens now.\n\nAlex" {
		t.Errorf("StripQuoted(Text) = %q", got)
	}
}

func TestParseWebhookReadsTheRawMIMEForm(t *testing.T) {
	payload, headers := recorded(t, "inbound_parse_raw.multipart")
	msg := parse(t, payload, headers)

	if msg.From != "alex.reader@example.net" {
		t.Errorf("From = %q", msg.From)
	}
	if !slices.Equal(msg.Recipients, []string{"contact+7Hn3QzW9kPfa@reply.example.com"}) {
		t.Errorf("Recipients = %q", msg.Recipients)
	}
	if msg.Subject != "Re: About my purchase" {
		t.Errorf("Subject = %q, want the encoded word decoded", msg.Subject)
	}
	if msg.MessageID != "DM6PR02MB4433A1B2C3D4E5F6@DM6PR02MB.example.outlook.com" {
		t.Errorf("MessageID = %q", msg.MessageID)
	}
	if !slices.Equal(msg.InReplyTo, []string{"0f3c2b8e-1d7a-4c55-9a3e-4b1f0d2c9e11@shop.example.com"}) {
		t.Errorf("InReplyTo = %q", msg.InReplyTo)
	}
	want := "I tried again and it still fails on my tablet. The error says the episode is not available in my region, which seems wrong."
	if got := inboundprovider.StripQuoted(msg.Text); got != want {
		t.Errorf("StripQuoted(Text) = %q, want %q", got, want)
	}
}

func TestParseWebhookRefusesARequestWithoutTheToken(t *testing.T) {
	payload, headers := recorded(t, "inbound_parse.multipart")
	for name, authorization := range map[string]string{
		"a wrong token":     sendgridtest.BasicAuth("another-token"),
		"no authorization":  "",
		"another scheme":    "Bearer " + token,
		"a token as a user": "Basic cmVjb3JkZWQtdG9rZW4=",
		"undecodable":       "Basic %%%",
	} {
		t.Run(name, func(t *testing.T) {
			headers := headers.Clone()
			headers.Set("Authorization", authorization)
			if _, err := sendgrid.New().ParseWebhook(t.Context(), payload, headers, credentials); !errors.Is(err, inboundprovider.ErrInvalidSignature) {
				t.Fatalf("ParseWebhook error = %v, want ErrInvalidSignature", err)
			}
		})
	}
}

func TestParseWebhookRefusesARequestThatIsNotAForm(t *testing.T) {
	headers := http.Header{}
	headers.Set("Content-Type", "application/json")
	headers.Set("Authorization", sendgridtest.BasicAuth(token))
	if _, err := sendgrid.New().ParseWebhook(t.Context(), []byte(`{}`), headers, credentials); !errors.Is(err, inboundprovider.ErrMalformedRequest) {
		t.Fatalf("ParseWebhook error = %v, want ErrMalformedRequest", err)
	}
}

// The handling of a non-UTF-8 body is what is under test, so the text is
// Japanese in the ISO-2022-JP encoding Japanese mail clients still send.
func TestParseWebhookDecodesTheCharsetSendGridNames(t *testing.T) {
	text, err := japanese.ISO2022JP.NewEncoder().String("ありがとうございます。")
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	payload, headers := sendgridtest.Form(t, token, map[string]string{
		"headers":  "From: reader@example.net\r\nTo: contact+7Hn3QzW9kPfa@reply.example.com\r\nSubject: =?ISO-2022-JP?B?GyRCJDUkaSRLGyhC?=\r\n",
		"from":     "reader@example.net",
		"to":       "contact+7Hn3QzW9kPfa@reply.example.com",
		"text":     text,
		"charsets": `{"text":"iso-2022-jp","to":"UTF-8","from":"UTF-8"}`,
	})
	msg := parse(t, payload, headers)
	if msg.Text != "ありがとうございます。" {
		t.Errorf("Text = %q", msg.Text)
	}
	if msg.Subject != "さらに" {
		t.Errorf("Subject = %q, want the encoded word decoded", msg.Subject)
	}
}

func TestParseWebhookFallsBackOnTheHTMLBody(t *testing.T) {
	payload, headers := sendgridtest.Form(t, token, map[string]string{
		"headers": "From: reader@example.net\r\nTo: contact+7Hn3QzW9kPfa@reply.example.com\r\n",
		"from":    "reader@example.net",
		"html":    "<p>It works now.</p><blockquote><p>Please try again.</p></blockquote>",
	})
	msg := parse(t, payload, headers)
	if got := inboundprovider.StripQuoted(msg.Text); got != "It works now." {
		t.Errorf("StripQuoted(Text) = %q (Text %q)", got, msg.Text)
	}
}

func TestParseWebhookRefusesAMailWithNoSender(t *testing.T) {
	payload, headers := sendgridtest.Form(t, token, map[string]string{
		"headers": "To: contact+7Hn3QzW9kPfa@reply.example.com\r\n",
		"text":    "Hello",
	})
	if _, err := sendgrid.New().ParseWebhook(t.Context(), payload, headers, credentials); !errors.Is(err, inboundprovider.ErrMalformedRequest) {
		t.Fatalf("ParseWebhook error = %v, want ErrMalformedRequest", err)
	}
}
