package ses_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/inboundprovider"
	"github.com/publira/publira/server/internal/inboundprovider/inboundprovidertest"
	"github.com/publira/publira/server/internal/inboundprovider/ses"
	"github.com/publira/publira/server/internal/inboundprovider/ses/sestest"
)

// recorded answers the SNS message in testdata/name, signed by the fixture's
// SNS.
func recorded(t *testing.T, f *sestest.Fixture, name string) sestest.Message {
	t.Helper()
	data, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	var message sestest.Message
	if err := json.Unmarshal(data, &message); err != nil {
		t.Fatalf("decode %s: %v", name, err)
	}
	message.SigningCertURL = sestest.SigningCertURL
	f.Sign(t, &message)
	return message
}

func recordedMail(t *testing.T) []byte {
	t.Helper()
	raw, err := os.ReadFile("testdata/received.eml")
	if err != nil {
		t.Fatalf("read received.eml: %v", err)
	}
	return raw
}

func parse(t *testing.T, f *sestest.Fixture, payload []byte, headers http.Header) (inboundprovider.Result, error) {
	t.Helper()
	return f.Provider().ParseWebhook(t.Context(), payload, headers, f.Credentials())
}

func parseMessage(t *testing.T, f *sestest.Fixture, message sestest.Message) inboundprovider.Message {
	t.Helper()
	payload, headers := f.Post(t, sestest.Token, message)
	result, err := parse(t, f, payload, headers)
	if err != nil {
		t.Fatalf("ParseWebhook: %v", err)
	}
	msg, ok := result.(inboundprovider.Message)
	if !ok {
		t.Fatalf("result = %T, want Message", result)
	}
	return msg
}

func checkRecordedMail(t *testing.T, msg inboundprovider.Message) {
	t.Helper()
	if msg.From != "alex.reader@example.net" {
		t.Errorf("From = %q", msg.From)
	}
	if !slices.Equal(msg.Recipients, []string{"contact+7Hn3QzW9kPfa@reply.example.com"}) {
		t.Errorf("Recipients = %q", msg.Recipients)
	}
	if msg.Subject != "Re: About my purchase" {
		t.Errorf("Subject = %q", msg.Subject)
	}
	if msg.MessageID != "CAJ4k2m1+9xQ@mail.example.net" {
		t.Errorf("MessageID = %q", msg.MessageID)
	}
	if msg.DeliveryKey != "o3d4k5l6m7n8p9q0r1s2t3u4v5w6x7y8z9a0b1c2" || msg.ID != msg.DeliveryKey {
		t.Errorf("DeliveryKey = %q, ID = %q, want the SES message id", msg.DeliveryKey, msg.ID)
	}
	want := []string{"0f3c2b8e-1d7a-4c55-9a3e-4b1f0d2c9e11@shop.example.com"}
	if !slices.Equal(msg.InReplyTo, want) || !slices.Equal(msg.References, want) {
		t.Errorf("InReplyTo = %q, References = %q", msg.InReplyTo, msg.References)
	}
	if got := inboundprovider.StripQuoted(msg.Text); got != "Thanks, the episode opens now.\n\nAlex" {
		t.Errorf("StripQuoted(Text) = %q", got)
	}
}

func TestParseWebhookConfirmsTheSubscriptionOfTheTenantsTopic(t *testing.T) {
	t.Run("a confirmation with the token and the topic is confirmed", func(t *testing.T) {
		f := sestest.NewFixture(t, sestest.ActionSNS)
		message := recorded(t, f, "subscription_confirmation.json")
		payload, headers := f.Post(t, sestest.Token, message)
		result, err := parse(t, f, payload, headers)
		if err != nil {
			t.Fatalf("ParseWebhook: %v", err)
		}
		if ignored, ok := result.(inboundprovider.Ignored); !ok || ignored.Type != "SubscriptionConfirmation" {
			t.Fatalf("result = %#v, want the confirmation ignored", result)
		}
		if got := f.Confirmed(); !slices.Equal(got, []string{message.Token}) {
			t.Errorf("confirmed %q, want the confirmation's token", got)
		}
	})

	refused := []struct {
		name    string
		token   string
		message func(*sestest.Fixture) sestest.Message
	}{
		{
			name:  "with another token",
			token: "another-token",
			message: func(f *sestest.Fixture) sestest.Message {
				message, _ := f.Confirmation(t, sestest.TopicARN)
				return message
			},
		},
		{
			name: "with no token",
			message: func(f *sestest.Fixture) sestest.Message {
				message, _ := f.Confirmation(t, sestest.TopicARN)
				return message
			},
		},
		{
			name:  "of another topic",
			token: sestest.Token,
			message: func(f *sestest.Fixture) sestest.Message {
				message, _ := f.Confirmation(t, "arn:aws:sns:us-east-1:210987654321:another-inbound")
				return message
			},
		},
		{
			name:  "with a signature that does not verify",
			token: sestest.Token,
			message: func(f *sestest.Fixture) sestest.Message {
				message, _ := f.Confirmation(t, sestest.TopicARN)
				message.SubscribeURL += "&Extra=1"
				return message
			},
		},
	}
	for _, tc := range refused {
		t.Run("a confirmation "+tc.name+" is neither confirmed nor accepted", func(t *testing.T) {
			f := sestest.NewFixture(t, sestest.ActionSNS)
			payload, headers := f.Post(t, tc.token, tc.message(f))
			if _, err := parse(t, f, payload, headers); !errors.Is(err, inboundprovider.ErrInvalidSignature) {
				t.Fatalf("ParseWebhook error = %v, want ErrInvalidSignature", err)
			}
			if got := f.Confirmed(); len(got) != 0 {
				t.Errorf("confirmed %q, want nothing", got)
			}
		})
	}

	t.Run("an unsubscribe confirmation is ignored and not confirmed", func(t *testing.T) {
		f := sestest.NewFixture(t, sestest.ActionSNS)
		message, _ := f.Confirmation(t, sestest.TopicARN)
		message.Type = "UnsubscribeConfirmation"
		f.Sign(t, &message)
		payload, headers := f.Post(t, sestest.Token, message)
		result, err := parse(t, f, payload, headers)
		if err != nil {
			t.Fatalf("ParseWebhook: %v", err)
		}
		if _, ok := result.(inboundprovider.Ignored); !ok {
			t.Fatalf("result = %T, want Ignored", result)
		}
		if got := f.Confirmed(); len(got) != 0 {
			t.Errorf("confirmed %q, want nothing", got)
		}
	})
}

func TestParseWebhookReadsAMailTheSNSActionPublished(t *testing.T) {
	f := sestest.NewFixture(t, sestest.ActionSNS)
	checkRecordedMail(t, parseMessage(t, f, recorded(t, f, "received_sns_action.json")))

	t.Run("in UTF-8", func(t *testing.T) {
		notification := sestest.SNSNotification(t, sestest.TopicARN, "o3d4k5l6m7n8p9q0r1s2t3u4v5w6x7y8z9a0b1c2", recordedMail(t), "contact+7Hn3QzW9kPfa@reply.example.com")
		var fields map[string]any
		if err := json.Unmarshal(notification, &fields); err != nil {
			t.Fatal(err)
		}
		fields["content"] = string(recordedMail(t))
		fields["receipt"].(map[string]any)["action"].(map[string]any)["encoding"] = "UTF8"
		notification, _ = json.Marshal(fields)
		checkRecordedMail(t, parseMessage(t, f, f.Notification(t, sestest.TopicARN, notification)))
	})
}

func TestParseWebhookReadsAMailTheS3ActionWrote(t *testing.T) {
	f := sestest.NewFixture(t, sestest.ActionS3)
	f.HoldObject(sestest.Bucket, "inbound/o3d4k5l6m7n8p9q0r1s2t3u4v5w6x7y8z9a0b1c2", recordedMail(t))
	checkRecordedMail(t, parseMessage(t, f, recorded(t, f, "received_s3_action.json")))
}

func TestParseWebhookPutsTheEnvelopeRecipientsFirst(t *testing.T) {
	f := sestest.NewFixture(t, sestest.ActionSNS)
	raw := []byte("From: alex.reader@example.net\r\nTo: support@comics.example.com\r\nSubject: Re: About my purchase\r\n\r\nThanks.\r\n")
	notification := sestest.SNSNotification(t, sestest.TopicARN, "forwarded", raw, "contact+7Hn3QzW9kPfa@reply.example.com")
	msg := parseMessage(t, f, f.Notification(t, sestest.TopicARN, notification))
	want := []string{"contact+7Hn3QzW9kPfa@reply.example.com", "support@comics.example.com"}
	if !slices.Equal(msg.Recipients, want) {
		t.Errorf("Recipients = %q, want %q", msg.Recipients, want)
	}
}

func TestParseWebhookAcceptsBothSignatureVersions(t *testing.T) {
	for _, version := range []string{"1", "2"} {
		t.Run("SignatureVersion "+version, func(t *testing.T) {
			f := sestest.NewFixture(t, sestest.ActionSNS)
			message := recorded(t, f, "received_sns_action.json")
			message.SignatureVersion = version
			f.Sign(t, &message)
			parseMessage(t, f, message)
		})
	}
}

func TestParseWebhookRefusesWhatIsNotTheTenantsTopic(t *testing.T) {
	cases := []struct {
		name   string
		edit   func(*testing.T, *sestest.Fixture, *sestest.Message)
		token  string
		reason string
	}{
		{
			name:  "a notification from another topic",
			token: sestest.Token,
			edit: func(t *testing.T, f *sestest.Fixture, m *sestest.Message) {
				m.TopicArn = "arn:aws:sns:us-east-1:210987654321:another-inbound"
				f.Sign(t, m)
			},
		},
		{
			name:  "a notification with another token",
			token: "another-token",
			edit:  func(*testing.T, *sestest.Fixture, *sestest.Message) {},
		},
		{
			name:  "a notification whose message was changed after it was signed",
			token: sestest.Token,
			edit: func(_ *testing.T, _ *sestest.Fixture, m *sestest.Message) {
				m.Message = strings.Replace(m.Message, `"PASS"`, `"FAIL"`, 1)
			},
		},
		{
			name:  "a notification whose subject was dropped after it was signed",
			token: sestest.Token,
			edit: func(_ *testing.T, _ *sestest.Fixture, m *sestest.Message) {
				m.Subject = nil
			},
		},
		{
			name:  "a notification signed with a version SNS does not use",
			token: sestest.Token,
			edit: func(t *testing.T, f *sestest.Fixture, m *sestest.Message) {
				m.SignatureVersion = "3"
				f.Sign(t, m)
			},
		},
		{
			name:  "a notification whose signature is not base64",
			token: sestest.Token,
			edit: func(_ *testing.T, _ *sestest.Fixture, m *sestest.Message) {
				m.Signature = "not base64!"
			},
		},
	}
	for _, certURL := range []string{
		"http://sns.us-east-1.amazonaws.com/SimpleNotificationService-0000000000000000000000000000000c.pem",
		"https://sns.us-east-1.amazonaws.com.example.net/SimpleNotificationService-0000000000000000000000000000000c.pem",
		"https://example.net/SimpleNotificationService-0000000000000000000000000000000c.pem",
		"https://s3.amazonaws.com/sns.us-east-1.amazonaws.com/SimpleNotificationService.pem",
		"https://sns.us-east-1.amazonaws.com:8443/SimpleNotificationService-0000000000000000000000000000000c.pem",
		"https://user@sns.us-east-1.amazonaws.com/SimpleNotificationService-0000000000000000000000000000000c.pem",
		"https://sns.us-east-1.amazonaws.com/?Action=GetCertificate",
	} {
		cases = append(cases, struct {
			name   string
			edit   func(*testing.T, *sestest.Fixture, *sestest.Message)
			token  string
			reason string
		}{
			name:  "a notification whose certificate is at " + certURL,
			token: sestest.Token,
			edit: func(t *testing.T, f *sestest.Fixture, m *sestest.Message) {
				m.SigningCertURL = certURL
				f.Sign(t, m)
			},
		})
	}
	for _, tc := range cases {
		t.Run(tc.name+" is refused", func(t *testing.T) {
			f := sestest.NewFixture(t, sestest.ActionSNS)
			message := recorded(t, f, "received_sns_action.json")
			tc.edit(t, f, &message)
			payload, headers := f.Post(t, tc.token, message)
			if _, err := parse(t, f, payload, headers); !errors.Is(err, inboundprovider.ErrInvalidSignature) {
				t.Fatalf("ParseWebhook error = %v, want ErrInvalidSignature", err)
			}
		})
	}

	t.Run("a notification posted with raw message delivery is refused", func(t *testing.T) {
		f := sestest.NewFixture(t, sestest.ActionSNS)
		payload, headers := f.Post(t, sestest.Token, recorded(t, f, "received_sns_action.json"))
		var message sestest.Message
		if err := json.Unmarshal(payload, &message); err != nil {
			t.Fatal(err)
		}
		if _, err := parse(t, f, []byte(message.Message), headers); !errors.Is(err, inboundprovider.ErrInvalidSignature) {
			t.Fatalf("ParseWebhook error = %v, want ErrInvalidSignature", err)
		}
	})

	t.Run("a notification is refused while no topic is stored", func(t *testing.T) {
		f := sestest.NewFixture(t, sestest.ActionSNS)
		payload, headers := f.Post(t, sestest.Token, recorded(t, f, "received_sns_action.json"))
		credentials := f.Credentials()
		delete(credentials, ses.FieldTopicARN)
		if _, err := f.Provider().ParseWebhook(t.Context(), payload, headers, credentials); !errors.Is(err, inboundprovider.ErrInvalidSignature) {
			t.Fatalf("ParseWebhook error = %v, want ErrInvalidSignature", err)
		}
	})
}

func TestParseWebhookAnswersAMailItCannotReadFromS3AsUnavailable(t *testing.T) {
	mail := inboundprovidertest.Mail{From: "reader@example.net", To: "contact+ABCDEFGHJKLM@reply.example.com", Subject: "Re: Hello", Text: "Thanks."}
	cases := []struct {
		name string
		edit func(inboundprovider.Credentials)
		hold bool
	}{
		{name: "an object the bucket does not hold"},
		{name: "no access key stored", hold: true, edit: func(c inboundprovider.Credentials) {
			delete(c, ses.FieldAccessKeyID)
			delete(c, ses.FieldSecretAccessKey)
		}},
		{name: "an access key S3 refuses", hold: true, edit: func(c inboundprovider.Credentials) {
			c[ses.FieldAccessKeyID] = "AKIAI44QH8DHBEXAMPLE"
		}},
		{name: "another bucket than the one stored", hold: true, edit: func(c inboundprovider.Credentials) {
			c[ses.FieldBucket] = "another-bucket"
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := sestest.NewFixture(t, sestest.ActionS3)
			key := sestest.ObjectKeyPrefix + "unreadable"
			if tc.hold {
				f.HoldObject(sestest.Bucket, key, []byte("From: reader@example.net\r\n\r\nThanks.\r\n"))
			}
			notification := sestest.S3Notification(t, sestest.TopicARN, "unreadable", sestest.Bucket, key, mail.To)
			payload, headers := f.Post(t, sestest.Token, f.Notification(t, sestest.TopicARN, notification))
			credentials := f.Credentials()
			if tc.edit != nil {
				tc.edit(credentials)
			}
			if _, err := f.Provider().ParseWebhook(t.Context(), payload, headers, credentials); !errors.Is(err, inboundprovider.ErrProviderUnavailable) {
				t.Fatalf("ParseWebhook error = %v, want ErrProviderUnavailable", err)
			}
		})
	}

	t.Run("the region defaults to the topic's", func(t *testing.T) {
		f := sestest.NewFixture(t, sestest.ActionS3)
		payload, headers := f.Received(t, f.Credentials(), mail)
		credentials := f.Credentials()
		credentials[ses.FieldRegion] = "eu-west-1"
		if _, err := f.Provider().ParseWebhook(t.Context(), payload, headers, credentials); !errors.Is(err, inboundprovider.ErrProviderUnavailable) {
			t.Fatalf("ParseWebhook error with another region = %v, want ErrProviderUnavailable", err)
		}
		delete(credentials, ses.FieldRegion)
		if _, err := f.Provider().ParseWebhook(t.Context(), payload, headers, credentials); err != nil {
			t.Fatalf("ParseWebhook with no region: %v", err)
		}
	})
}

func TestParseWebhookIgnoresWhatIsNotAReceivedMail(t *testing.T) {
	f := sestest.NewFixture(t, sestest.ActionSNS)
	for _, notification := range []string{
		`{"notificationType":"AMAZON_SES_SETUP_NOTIFICATION","receipt":{},"mail":{}}`,
		`{"notificationType":"Bounce","bounce":{},"mail":{}}`,
	} {
		payload, headers := f.Post(t, sestest.Token, f.Notification(t, sestest.TopicARN, []byte(notification)))
		result, err := parse(t, f, payload, headers)
		if err != nil {
			t.Fatalf("ParseWebhook: %v", err)
		}
		if _, ok := result.(inboundprovider.Ignored); !ok {
			t.Fatalf("result = %T, want Ignored", result)
		}
	}
}

func TestParseWebhookRefusesANotificationThatCarriesNoMail(t *testing.T) {
	f := sestest.NewFixture(t, sestest.ActionSNS)
	cases := map[string]string{
		"a Lambda action":      `{"notificationType":"Received","mail":{"messageId":"m"},"receipt":{"recipients":["contact+ABCDEFGHJKLM@reply.example.com"],"action":{"type":"Lambda","functionArn":"arn:aws:lambda:us-east-1:123456789012:function:f"}}}`,
		"content not base64":   `{"notificationType":"Received","mail":{"messageId":"m"},"receipt":{"action":{"type":"SNS","encoding":"BASE64"}},"content":"not base64!"}`,
		"content with no From": `{"notificationType":"Received","mail":{"messageId":"m"},"receipt":{"action":{"type":"SNS","encoding":"UTF8"}},"content":"To: a@example.com\r\n\r\nHello\r\n"}`,
		"a message not JSON":   `Received`,
	}
	for name, notification := range cases {
		t.Run(name, func(t *testing.T) {
			payload, headers := f.Post(t, sestest.Token, f.Notification(t, sestest.TopicARN, []byte(notification)))
			if _, err := parse(t, f, payload, headers); !errors.Is(err, inboundprovider.ErrMalformedRequest) {
				t.Fatalf("ParseWebhook error = %v, want ErrMalformedRequest", err)
			}
		})
	}
}
