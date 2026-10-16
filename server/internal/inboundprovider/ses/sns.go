package ses

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha1" //nolint:gosec // SNS signs SignatureVersion 1 with SHA1withRSA.
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"hash"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/publira/publira/server/internal/inboundprovider"
)

// The SNS message types an HTTPS subscription is posted.
const (
	typeNotification             = "Notification"
	typeSubscriptionConfirmation = "SubscriptionConfirmation"
	typeUnsubscribeConfirmation  = "UnsubscribeConfirmation"
)

const (
	// maxCertificateBytes bounds a signing certificate.
	maxCertificateBytes = 64 << 10
	// maxCachedCertificates bounds the certificates kept between requests.
	// SNS signs with one certificate per region at a time, so a handful
	// covers every tenant until SNS rotates them.
	maxCachedCertificates = 32
)

// snsHostPattern is the host SNS serves its signing certificates and its
// subscription confirmations from, in one of its regions.
var snsHostPattern = regexp.MustCompile(`^sns\.[a-z0-9-]+\.amazonaws\.com$`)

// snsMessage is the JSON document SNS posts to an HTTPS subscription.
type snsMessage struct {
	Type      string `json:"Type"`
	MessageID string `json:"MessageId"`
	Token     string `json:"Token"`
	TopicArn  string `json:"TopicArn"`
	// Subject is signed only when the message carries one.
	Subject          *string `json:"Subject"`
	Message          string  `json:"Message"`
	Timestamp        string  `json:"Timestamp"`
	SignatureVersion string  `json:"SignatureVersion"`
	Signature        string  `json:"Signature"`
	SigningCertURL   string  `json:"SigningCertURL"`
	SubscribeURL     string  `json:"SubscribeURL"`
}

// stringToSign answers what SNS signs of m: the name and the value of each of
// its fields in a fixed order, each followed by a line feed.
func (m snsMessage) stringToSign() string {
	type field struct{ name, value string }
	var fields []field
	if m.Type == typeNotification {
		fields = []field{{"Message", m.Message}, {"MessageId", m.MessageID}}
		if m.Subject != nil {
			fields = append(fields, field{"Subject", *m.Subject})
		}
		fields = append(fields, field{"Timestamp", m.Timestamp}, field{"TopicArn", m.TopicArn}, field{"Type", m.Type})
	} else {
		fields = []field{
			{"Message", m.Message},
			{"MessageId", m.MessageID},
			{"SubscribeURL", m.SubscribeURL},
			{"Timestamp", m.Timestamp},
			{"Token", m.Token},
			{"TopicArn", m.TopicArn},
			{"Type", m.Type},
		}
	}
	var b strings.Builder
	for _, f := range fields {
		b.WriteString(f.name)
		b.WriteByte('\n')
		b.WriteString(f.value)
		b.WriteByte('\n')
	}
	return b.String()
}

// signingCertificate is a certificate SNS signs messages with.
type signingCertificate struct {
	key *rsa.PublicKey
}

// verify checks m's signature with the certificate it names, which is fetched
// over HTTPS from an SNS host and nowhere else. The TLS handshake with that
// host is what proves the certificate is AWS's.
//
// A captured message replayed stores nothing twice: the mail's SES message id
// is its delivery key.
func (p *Provider) verify(ctx context.Context, m snsMessage) error {
	var hashFunc crypto.Hash
	var digest hash.Hash
	switch m.SignatureVersion {
	case "1":
		hashFunc, digest = crypto.SHA1, sha1.New() //nolint:gosec // SignatureVersion 1 is SHA1withRSA.
	case "2":
		hashFunc, digest = crypto.SHA256, sha256.New()
	default:
		return inboundprovider.ErrInvalidSignature
	}
	certURL, ok := snsURL(m.SigningCertURL)
	if !ok || !strings.HasSuffix(certURL.Path, ".pem") {
		return inboundprovider.ErrInvalidSignature
	}
	signature, err := base64.StdEncoding.DecodeString(m.Signature)
	if err != nil {
		return inboundprovider.ErrInvalidSignature
	}
	certificate, err := p.certificate(ctx, certURL)
	if err != nil {
		return err
	}
	digest.Write([]byte(m.stringToSign()))
	if rsa.VerifyPKCS1v15(certificate.key, hashFunc, digest.Sum(nil), signature) != nil {
		return inboundprovider.ErrInvalidSignature
	}
	return nil
}

// certificate answers the signing certificate at certURL, fetching it the
// first time it is named.
func (p *Provider) certificate(ctx context.Context, certURL *url.URL) (*signingCertificate, error) {
	key := certURL.String()
	p.mu.Lock()
	cached, ok := p.certificates[key]
	p.mu.Unlock()
	if ok {
		return cached, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, key, nil)
	if err != nil {
		return nil, fmt.Errorf("build signing certificate request: %w", err)
	}
	res, err := p.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: fetch the signing certificate: %w", inboundprovider.ErrProviderUnavailable, err)
	}
	defer res.Body.Close() //nolint:errcheck
	body, err := io.ReadAll(io.LimitReader(res.Body, maxCertificateBytes))
	if err != nil {
		return nil, fmt.Errorf("%w: read the signing certificate: %w", inboundprovider.ErrProviderUnavailable, err)
	}
	switch {
	case res.StatusCode >= http.StatusInternalServerError:
		return nil, fmt.Errorf("%w: SNS answered %d for the signing certificate", inboundprovider.ErrProviderUnavailable, res.StatusCode)
	case res.StatusCode != http.StatusOK:
		return nil, inboundprovider.ErrInvalidSignature
	}
	block, _ := pem.Decode(body)
	if block == nil || block.Type != "CERTIFICATE" {
		return nil, inboundprovider.ErrInvalidSignature
	}
	parsed, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, inboundprovider.ErrInvalidSignature
	}
	publicKey, ok := parsed.PublicKey.(*rsa.PublicKey)
	if !ok {
		return nil, inboundprovider.ErrInvalidSignature
	}
	certificate := &signingCertificate{key: publicKey}

	p.mu.Lock()
	if len(p.certificates) >= maxCachedCertificates {
		clear(p.certificates)
	}
	p.certificates[key] = certificate
	p.mu.Unlock()
	return certificate, nil
}

// snsURL answers raw as a URL when it is an HTTPS URL on an SNS host.
func snsURL(raw string) (*url.URL, bool) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Port() != "" {
		return nil, false
	}
	if !snsHostPattern.MatchString(parsed.Hostname()) {
		return nil, false
	}
	return parsed, true
}
