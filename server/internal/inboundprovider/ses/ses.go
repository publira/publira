// Package ses is Amazon SES's receiving: a receipt rule hands each mail to an
// action that publishes a receipt notification to an SNS topic, and the topic
// delivers it to the webhook through an HTTPS subscription. With the rule's
// SNS action the notification carries the mail itself; with its S3 action the
// mail is written to a bucket, and is then read from there with the tenant's
// AWS access key.
//
// The SNS signature proves only that AWS SNS sent the request, and any AWS
// account can subscribe a topic of its own to the webhook. A request is
// therefore taken as the tenant's only when it also carries the tenant's
// webhook token as the password of the subscription URL's basic auth
// (`https://inbound:<token>@<storefront>/api/v1/webhook/email/ses`), and names
// the topic the tenant stored.
package ses

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awscredentials "github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/publira/publira/server/internal/inboundprovider"
)

const (
	// ID is the provider id stored in a tenant's inbound email settings.
	ID = "ses"

	// FieldWebhookToken is the password of the basic auth in the URL the
	// topic's subscription delivers to, and FieldTopicARN the ARN of the topic
	// the receipt rule publishes to. Both are required: together they tie a
	// delivery to the tenant.
	FieldWebhookToken = "webhook_token"
	FieldTopicARN     = "topic_arn"

	// FieldAccessKeyID and FieldSecretAccessKey are the AWS access key a mail
	// the S3 action wrote is read with. FieldRegion is the region of the
	// bucket, when it is not the topic's, and FieldBucket, when stored, is the
	// one bucket a mail is read from. None of them is needed for a rule whose
	// action is SNS.
	FieldAccessKeyID     = "access_key_id"
	FieldSecretAccessKey = "secret_access_key"
	FieldRegion          = "region"
	FieldBucket          = "bucket"

	// NotificationTypeReceived is the notification type of a received mail.
	NotificationTypeReceived = "Received"

	// maxMailBytes bounds the mail read from S3, which is the largest mail SES
	// receives.
	maxMailBytes = 40 << 20
)

// Provider is Amazon SES's receiving.
type Provider struct {
	httpClient *http.Client

	mu           sync.Mutex
	certificates map[string]*signingCertificate
}

// Option configures a [Provider].
type Option func(*Provider)

// WithHTTPClient has the provider make every request with client: the signing
// certificate, the subscription's confirmation, and the S3 object.
func WithHTTPClient(client *http.Client) Option {
	return func(p *Provider) {
		p.httpClient = client
	}
}

// New answers the SES provider.
func New(options ...Option) *Provider {
	p := &Provider{
		// Long enough to read a mail of maxMailBytes from S3.
		httpClient:   &http.Client{Timeout: 30 * time.Second},
		certificates: map[string]*signingCertificate{},
	}
	for _, option := range options {
		option(p)
	}
	return p
}

func (*Provider) Declaration() inboundprovider.Declaration {
	return inboundprovider.Declaration{
		ID:          ID,
		DisplayName: "Amazon SES",
		Fields: []inboundprovider.Field{
			{Name: FieldWebhookToken, Secret: true, Required: true},
			{Name: FieldTopicARN, Required: true},
			{Name: FieldAccessKeyID},
			{Name: FieldSecretAccessKey, Secret: true},
			{Name: FieldRegion},
			{Name: FieldBucket},
		},
	}
}

// notification is the part of an SES receipt notification the provider reads.
type notification struct {
	NotificationType string `json:"notificationType"`
	Mail             struct {
		MessageID string `json:"messageId"`
	} `json:"mail"`
	Receipt struct {
		Recipients []string `json:"recipients"`
		Action     struct {
			Type       string `json:"type"`
			Encoding   string `json:"encoding"`
			BucketName string `json:"bucketName"`
			ObjectKey  string `json:"objectKey"`
		} `json:"action"`
	} `json:"receipt"`
	Content *string `json:"content"`
}

// ParseWebhook verifies the token and the topic before anything else, so a
// request that is not the tenant's never has the provider fetch a
// certificate, and then the SNS signature.
//
// A subscription's confirmation is confirmed and answered as [Ignored]. A
// received mail is read from the notification or from S3, and its envelope
// recipients come ahead of the ones its To and Cc headers name.
func (p *Provider) ParseWebhook(ctx context.Context, payload []byte, headers http.Header, credentials inboundprovider.Credentials) (inboundprovider.Result, error) {
	if !inboundprovider.BasicAuthorized(headers.Get("Authorization"), credentials[FieldWebhookToken]) {
		return nil, inboundprovider.ErrInvalidSignature
	}
	topicARN := strings.TrimSpace(credentials[FieldTopicARN])
	if topicARN == "" {
		return nil, inboundprovider.ErrInvalidSignature
	}
	var message snsMessage
	if err := json.Unmarshal(payload, &message); err != nil {
		return nil, fmt.Errorf("%w: decode SNS message: %w", inboundprovider.ErrMalformedRequest, err)
	}
	// A subscription with raw message delivery on posts the notification
	// without the SNS message around it, which names no topic and is signed
	// by nothing.
	if message.TopicArn != topicARN {
		return nil, inboundprovider.ErrInvalidSignature
	}
	switch message.Type {
	case typeNotification, typeSubscriptionConfirmation, typeUnsubscribeConfirmation:
	default:
		return inboundprovider.Ignored{ID: message.MessageID, Type: message.Type}, nil
	}
	if err := p.verify(ctx, message); err != nil {
		return nil, err
	}

	switch message.Type {
	case typeSubscriptionConfirmation:
		if err := p.confirm(ctx, message.SubscribeURL); err != nil {
			return nil, err
		}
		return inboundprovider.Ignored{ID: message.MessageID, Type: message.Type}, nil
	case typeUnsubscribeConfirmation:
		return inboundprovider.Ignored{ID: message.MessageID, Type: message.Type}, nil
	}

	var received notification
	if err := json.Unmarshal([]byte(message.Message), &received); err != nil {
		return nil, fmt.Errorf("%w: decode SES notification: %w", inboundprovider.ErrMalformedRequest, err)
	}
	// SES posts AMAZON_SES_SETUP_NOTIFICATION to a topic a rule is given.
	if received.NotificationType != NotificationTypeReceived {
		return inboundprovider.Ignored{ID: message.MessageID, Type: received.NotificationType}, nil
	}
	raw, err := p.mail(ctx, received, credentials, topicARN)
	if err != nil {
		return nil, err
	}
	header, text, err := inboundprovider.ReadMIME(raw)
	if err != nil {
		return nil, fmt.Errorf("%w: read the mail: %w", inboundprovider.ErrMalformedRequest, err)
	}
	// SES names each mail it receives by its message id, which SNS repeats
	// whenever it delivers the notification again.
	key := received.Mail.MessageID
	if key == "" {
		key = message.MessageID
	}
	msg := inboundprovider.Message{
		ID:          key,
		Text:        text,
		DeliveryKey: key,
	}
	msg.Recipients = inboundprovider.AppendRecipients(msg.Recipients, received.Receipt.Recipients...)
	inboundprovider.ApplyHeader(&msg, header)
	if msg.From == "" {
		return nil, fmt.Errorf("%w: the mail names no sender", inboundprovider.ErrMalformedRequest)
	}
	return msg, nil
}

// mail answers the raw mail a received notification carries or names.
func (p *Provider) mail(ctx context.Context, received notification, credentials inboundprovider.Credentials, topicARN string) ([]byte, error) {
	action := received.Receipt.Action
	switch {
	case received.Content != nil:
		if strings.EqualFold(action.Encoding, "BASE64") {
			raw, err := base64.StdEncoding.DecodeString(*received.Content)
			if err != nil {
				return nil, fmt.Errorf("%w: decode the mail: %w", inboundprovider.ErrMalformedRequest, err)
			}
			return raw, nil
		}
		return []byte(*received.Content), nil
	case action.BucketName != "" && action.ObjectKey != "":
		return p.readObject(ctx, credentials, topicARN, action.BucketName, action.ObjectKey)
	default:
		return nil, fmt.Errorf("%w: a %s action carries no mail", inboundprovider.ErrMalformedRequest, action.Type)
	}
}

// readObject reads the mail the S3 action wrote. Anything that keeps it from
// being read is unavailable rather than malformed: the notification is
// genuine, and the mail is still in the bucket for SNS's next delivery once
// the tenant's key or S3 is back.
func (p *Provider) readObject(ctx context.Context, credentials inboundprovider.Credentials, topicARN, bucket, key string) ([]byte, error) {
	if stored := strings.TrimSpace(credentials[FieldBucket]); stored != "" && stored != bucket {
		return nil, fmt.Errorf("%w: the mail is in bucket %s, not in %s", inboundprovider.ErrProviderUnavailable, bucket, stored)
	}
	accessKeyID := strings.TrimSpace(credentials[FieldAccessKeyID])
	secretAccessKey := strings.TrimSpace(credentials[FieldSecretAccessKey])
	if accessKeyID == "" || secretAccessKey == "" {
		return nil, fmt.Errorf("%w: no AWS access key is stored", inboundprovider.ErrProviderUnavailable)
	}
	region := strings.TrimSpace(credentials[FieldRegion])
	if region == "" {
		region = arnRegion(topicARN)
	}
	// The client is built from the tenant's key alone, never from the
	// process's own credential chain, which would read any bucket the
	// install's role can.
	client := s3.New(s3.Options{
		Region:      region,
		Credentials: aws.NewCredentialsCache(awscredentials.NewStaticCredentialsProvider(accessKeyID, secretAccessKey, "")),
		HTTPClient:  p.httpClient,
	})
	object, err := client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("%w: read s3://%s/%s: %w", inboundprovider.ErrProviderUnavailable, bucket, key, err)
	}
	defer object.Body.Close() //nolint:errcheck
	var raw bytes.Buffer
	if _, err := io.Copy(&raw, io.LimitReader(object.Body, maxMailBytes+1)); err != nil {
		return nil, fmt.Errorf("%w: read s3://%s/%s: %w", inboundprovider.ErrProviderUnavailable, bucket, key, err)
	}
	if raw.Len() > maxMailBytes {
		return nil, fmt.Errorf("%w: the mail is larger than %d bytes", inboundprovider.ErrMalformedRequest, maxMailBytes)
	}
	return raw.Bytes(), nil
}

// confirm confirms a subscription by fetching the URL its confirmation names.
func (p *Provider) confirm(ctx context.Context, subscribeURL string) error {
	target, ok := snsURL(subscribeURL)
	if !ok {
		return fmt.Errorf("%w: the subscribe URL is not on SNS", inboundprovider.ErrMalformedRequest)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return fmt.Errorf("build subscription confirmation request: %w", err)
	}
	res, err := p.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("%w: confirm the subscription: %w", inboundprovider.ErrProviderUnavailable, err)
	}
	defer res.Body.Close() //nolint:errcheck
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 64<<10))
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: SNS answered %d to the subscription confirmation", inboundprovider.ErrProviderUnavailable, res.StatusCode)
	}
	return nil
}

// arnRegion answers the region an ARN names, such as us-east-1 in
// arn:aws:sns:us-east-1:123456789012:publira-inbound.
func arnRegion(arn string) string {
	parts := strings.SplitN(arn, ":", 6)
	if len(parts) < 6 {
		return ""
	}
	return parts[3]
}
