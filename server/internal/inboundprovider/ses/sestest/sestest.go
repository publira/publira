// Package sestest posts mail the way an SNS topic that Amazon SES publishes
// receipt notifications to does, and stands in for SNS and S3 where the
// provider reads them, for the inbound provider contract and the tests of the
// webhook.
package sestest

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha1" //nolint:gosec // SNS signs SignatureVersion 1 with SHA1withRSA.
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"hash"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/inboundprovider"
	"github.com/publira/publira/server/internal/inboundprovider/inboundprovidertest"
	"github.com/publira/publira/server/internal/inboundprovider/mime/mimetest"
	"github.com/publira/publira/server/internal/inboundprovider/ses"
)

const (
	// Region is the region of the fixture's topic and bucket.
	Region = "us-east-1"
	// TopicARN, Token, AccessKeyID, SecretAccessKey, and Bucket are the
	// credentials of the fixture's tenant.
	TopicARN        = "arn:aws:sns:" + Region + ":123456789012:publira-inbound"
	Token           = "contract-token"
	AccessKeyID     = "AKIAIOSFODNN7EXAMPLE"
	SecretAccessKey = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
	Bucket          = "publira-inbound-mail"
	// ObjectKeyPrefix is where the fixture's S3 action writes each mail.
	ObjectKeyPrefix = "inbound/"
	// SigningCertURL is where the fake SNS serves its signing certificate.
	SigningCertURL = "https://sns." + Region + ".amazonaws.com/SimpleNotificationService-0000000000000000000000000000000c.pem"
)

// Action is the receipt rule action a fixture's mail reaches the topic by.
type Action int

const (
	// ActionSNS publishes the mail in the notification, base64-encoded.
	ActionSNS Action = iota
	// ActionS3 writes the mail to the bucket and publishes where it is.
	ActionS3
)

// Message is the JSON document SNS posts to an HTTPS subscription.
type Message struct {
	Type             string  `json:"Type"`
	MessageID        string  `json:"MessageId"`
	Token            string  `json:"Token,omitempty"`
	TopicArn         string  `json:"TopicArn"`
	Subject          *string `json:"Subject,omitempty"`
	Message          string  `json:"Message"`
	Timestamp        string  `json:"Timestamp"`
	SignatureVersion string  `json:"SignatureVersion"`
	Signature        string  `json:"Signature"`
	SigningCertURL   string  `json:"SigningCertURL"`
	SubscribeURL     string  `json:"SubscribeURL,omitempty"`
	UnsubscribeURL   string  `json:"UnsubscribeURL,omitempty"`
}

// signer is the fake SNS's signing key and the certificate it serves.
type signer struct {
	key  *rsa.PrivateKey
	cert []byte
}

// newSigner answers one signer for every fixture, since a key takes a while to
// generate.
var newSigner = sync.OnceValues(func() (signer, error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return signer{}, err
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "sns.amazonaws.com"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return signer{}, err
	}
	return signer{key: key, cert: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})}, nil
})

// Fixture is the SES contract fixture, with a fake of SNS that serves its
// signing certificate and takes subscription confirmations, and a fake of S3
// that answers the mail the S3 action wrote.
type Fixture struct {
	action Action
	server *httptest.Server
	key    *rsa.PrivateKey
	cert   []byte

	mu        sync.Mutex
	objects   map[string][]byte
	confirmed []string
}

// NewFixture starts the fakes for as long as t lives. Its mail reaches the
// topic by action.
func NewFixture(t testing.TB, action Action) *Fixture {
	t.Helper()
	signer, err := newSigner()
	if err != nil {
		t.Fatalf("create signing certificate: %v", err)
	}
	f := &Fixture{
		action:  action,
		key:     signer.key,
		cert:    signer.cert,
		objects: map[string][]byte{},
	}
	f.server = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.server.Close)
	return f
}

// HTTPClient answers a client that reaches the fakes for every AWS host it is
// asked for, over plain HTTP.
func (f *Fixture) HTTPClient() *http.Client {
	target, _ := url.Parse(f.server.URL)
	return &http.Client{Transport: rewriteTransport{target: target, next: f.server.Client().Transport}}
}

// rewriteTransport sends every request to target, keeping the host it was
// addressed to in the Host header.
type rewriteTransport struct {
	target *url.URL
	next   http.RoundTripper
}

func (r rewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	clone.Host = req.URL.Host
	clone.URL.Scheme = r.target.Scheme
	clone.URL.Host = r.target.Host
	return r.next.RoundTrip(clone)
}

func (f *Fixture) serve(w http.ResponseWriter, r *http.Request) {
	host := r.Host
	switch {
	case host == "sns."+Region+".amazonaws.com" && r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, ".pem"):
		if r.URL.String() != strings.TrimPrefix(SigningCertURL, "https://sns."+Region+".amazonaws.com") {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(f.cert)
	case host == "sns."+Region+".amazonaws.com" && r.Method == http.MethodGet && r.URL.Query().Get("Action") == "ConfirmSubscription":
		f.mu.Lock()
		f.confirmed = append(f.confirmed, r.URL.Query().Get("Token"))
		f.mu.Unlock()
		w.Header().Set("Content-Type", "text/xml")
		_, _ = w.Write([]byte(`<ConfirmSubscriptionResponse xmlns="http://sns.amazonaws.com/doc/2010-03-31/"><ConfirmSubscriptionResult><SubscriptionArn>` + r.URL.Query().Get("TopicArn") + `:` + uuid.NewString() + `</SubscriptionArn></ConfirmSubscriptionResult></ConfirmSubscriptionResponse>`))
	case strings.HasSuffix(host, ".s3."+Region+".amazonaws.com") && r.Method == http.MethodGet:
		if !strings.Contains(r.Header.Get("Authorization"), "Credential="+AccessKeyID+"/") {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`<Error><Code>InvalidAccessKeyId</Code></Error>`))
			return
		}
		bucket := strings.TrimSuffix(host, ".s3."+Region+".amazonaws.com")
		f.mu.Lock()
		object, ok := f.objects[bucket+"/"+strings.TrimPrefix(r.URL.Path, "/")]
		f.mu.Unlock()
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`<Error><Code>NoSuchKey</Code></Error>`))
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(object)
	default:
		http.NotFound(w, r)
	}
}

// HoldObject makes the fake S3 answer raw under key in bucket.
func (f *Fixture) HoldObject(bucket, key string, raw []byte) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.objects[bucket+"/"+key] = raw
}

// Confirmed answers the token of every subscription confirmed with the fake
// SNS, in order.
func (f *Fixture) Confirmed() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.confirmed...)
}

func (f *Fixture) Provider() inboundprovider.Provider {
	return ses.New(ses.WithHTTPClient(f.HTTPClient()))
}

func (*Fixture) Credentials() inboundprovider.Credentials {
	return inboundprovider.Credentials{
		ses.FieldWebhookToken:    Token,
		ses.FieldTopicARN:        TopicARN,
		ses.FieldAccessKeyID:     AccessKeyID,
		ses.FieldSecretAccessKey: SecretAccessKey,
		ses.FieldBucket:          Bucket,
	}
}

func (*Fixture) OtherCredentials() inboundprovider.Credentials {
	return inboundprovider.Credentials{
		ses.FieldWebhookToken:    "another-token",
		ses.FieldTopicARN:        "arn:aws:sns:" + Region + ":210987654321:another-inbound",
		ses.FieldAccessKeyID:     AccessKeyID,
		ses.FieldSecretAccessKey: SecretAccessKey,
	}
}

// Received posts mail as another receipt of it, through the fixture's action.
func (f *Fixture) Received(t testing.TB, credentials inboundprovider.Credentials, mail inboundprovidertest.Mail) ([]byte, http.Header) {
	t.Helper()
	messageID := strings.ReplaceAll(uuid.NewString(), "-", "")
	raw := mimetest.Raw(mail)
	var notification []byte
	if f.action == ActionS3 {
		key := ObjectKeyPrefix + messageID
		f.HoldObject(Bucket, key, raw)
		notification = S3Notification(t, credentials[ses.FieldTopicARN], messageID, Bucket, key, mail.To)
	} else {
		notification = SNSNotification(t, credentials[ses.FieldTopicARN], messageID, raw, mail.To)
	}
	return f.Post(t, credentials[ses.FieldWebhookToken], f.Notification(t, credentials[ses.FieldTopicARN], notification))
}

// Unrelated posts the notification SES publishes to a topic it is given.
func (f *Fixture) Unrelated(t testing.TB, credentials inboundprovider.Credentials) ([]byte, http.Header, bool) {
	t.Helper()
	message := f.Notification(t, credentials[ses.FieldTopicARN], []byte(`{"notificationType":"AMAZON_SES_SETUP_NOTIFICATION","receipt":{},"mail":{}}`))
	payload, headers := f.Post(t, credentials[ses.FieldWebhookToken], message)
	return payload, headers, true
}

// Confirmation answers the signed message SNS posts when the topic named in
// credentials is subscribed to the webhook, and the token it confirms with.
func (f *Fixture) Confirmation(t testing.TB, topicARN string) (Message, string) {
	t.Helper()
	token := strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", "")
	message := Message{
		Type:             "SubscriptionConfirmation",
		MessageID:        uuid.NewString(),
		Token:            token,
		TopicArn:         topicARN,
		Message:          "You have chosen to subscribe to the topic " + topicARN + ".\nTo confirm the subscription, visit the SubscribeURL included in this message.",
		SubscribeURL:     "https://sns." + Region + ".amazonaws.com/?Action=ConfirmSubscription&TopicArn=" + url.QueryEscape(topicARN) + "&Token=" + token,
		Timestamp:        time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		SignatureVersion: "1",
		SigningCertURL:   SigningCertURL,
	}
	f.Sign(t, &message)
	return message, token
}

// Notification answers the signed message SNS posts to deliver notification,
// an SES receipt notification, from the topic topicARN.
func (f *Fixture) Notification(t testing.TB, topicARN string, notification []byte) Message {
	t.Helper()
	subject := "Amazon SES Email Receipt Notification"
	message := Message{
		Type:             "Notification",
		MessageID:        uuid.NewString(),
		TopicArn:         topicARN,
		Subject:          &subject,
		Message:          string(notification),
		Timestamp:        time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		SignatureVersion: "2",
		SigningCertURL:   SigningCertURL,
		UnsubscribeURL:   "https://sns." + Region + ".amazonaws.com/?Action=Unsubscribe&SubscriptionArn=" + url.QueryEscape(topicARN+":"+uuid.NewString()),
	}
	f.Sign(t, &message)
	return message
}

// Sign signs message as SNS does under its SignatureVersion, with the fake
// SNS's key whatever SigningCertURL it names.
func (f *Fixture) Sign(t testing.TB, message *Message) {
	t.Helper()
	var hashFunc crypto.Hash
	var digest hash.Hash
	switch message.SignatureVersion {
	case "1":
		hashFunc, digest = crypto.SHA1, sha1.New() //nolint:gosec // SignatureVersion 1 is SHA1withRSA.
	default:
		hashFunc, digest = crypto.SHA256, sha256.New()
	}
	digest.Write([]byte(StringToSign(*message)))
	signature, err := rsa.SignPKCS1v15(rand.Reader, f.key, hashFunc, digest.Sum(nil))
	if err != nil {
		t.Fatalf("sign SNS message: %v", err)
	}
	message.Signature = base64.StdEncoding.EncodeToString(signature)
}

// StringToSign answers what SNS signs of message.
func StringToSign(message Message) string {
	var b strings.Builder
	write := func(name, value string) {
		b.WriteString(name + "\n" + value + "\n")
	}
	write("Message", message.Message)
	write("MessageId", message.MessageID)
	if message.Type == "Notification" {
		if message.Subject != nil {
			write("Subject", *message.Subject)
		}
	} else {
		write("SubscribeURL", message.SubscribeURL)
	}
	write("Timestamp", message.Timestamp)
	if message.Type != "Notification" {
		write("Token", message.Token)
	}
	write("TopicArn", message.TopicArn)
	write("Type", message.Type)
	return b.String()
}

// Post answers the request SNS makes to deliver message to a subscription
// whose URL carries token as the password of its basic auth.
func (*Fixture) Post(t testing.TB, token string, message Message) ([]byte, http.Header) {
	t.Helper()
	payload, err := json.Marshal(message)
	if err != nil {
		t.Fatalf("marshal SNS message: %v", err)
	}
	headers := http.Header{}
	headers.Set("Content-Type", "text/plain; charset=UTF-8")
	headers.Set("User-Agent", "Amazon Simple Notification Service Agent")
	headers.Set("X-Amz-Sns-Message-Type", message.Type)
	headers.Set("X-Amz-Sns-Message-Id", message.MessageID)
	headers.Set("X-Amz-Sns-Topic-Arn", message.TopicArn)
	if token != "" {
		headers.Set("Authorization", mimetest.BasicAuth(token))
	}
	return payload, headers
}

// SNSNotification answers the receipt notification an SNS action publishes for
// raw, received as messageID for recipients, with the mail in it in base64.
func SNSNotification(t testing.TB, topicARN, messageID string, raw []byte, recipients ...string) []byte {
	t.Helper()
	content := base64.StdEncoding.EncodeToString(raw)
	return receiptNotification(t, messageID, recipients, map[string]any{
		"type":     "SNS",
		"topicArn": topicARN,
		"encoding": "BASE64",
	}, &content)
}

// S3Notification answers the receipt notification an S3 action publishes for
// the mail it wrote to key in bucket, received as messageID for recipients.
func S3Notification(t testing.TB, topicARN, messageID, bucket, key string, recipients ...string) []byte {
	t.Helper()
	return receiptNotification(t, messageID, recipients, map[string]any{
		"type":            "S3",
		"topicArn":        topicARN,
		"bucketName":      bucket,
		"objectKeyPrefix": strings.TrimSuffix(key, messageID),
		"objectKey":       key,
	}, nil)
}

func receiptNotification(t testing.TB, messageID string, recipients []string, action map[string]any, content *string) []byte {
	t.Helper()
	now := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	pass := map[string]string{"status": "PASS"}
	notification := map[string]any{
		"notificationType": ses.NotificationTypeReceived,
		"mail": map[string]any{
			"timestamp":        now,
			"source":           "bounce@mail.example.net",
			"messageId":        messageID,
			"destination":      recipients,
			"headersTruncated": false,
			"headers":          []any{},
			"commonHeaders":    map[string]any{},
		},
		"receipt": map[string]any{
			"timestamp":            now,
			"processingTimeMillis": 412,
			"recipients":           recipients,
			"spamVerdict":          pass,
			"virusVerdict":         pass,
			"spfVerdict":           pass,
			"dkimVerdict":          pass,
			"dmarcVerdict":         pass,
			"action":               action,
		},
	}
	if content != nil {
		notification["content"] = *content
	}
	data, err := json.Marshal(notification)
	if err != nil {
		t.Fatalf("marshal SES notification: %v", err)
	}
	return data
}
