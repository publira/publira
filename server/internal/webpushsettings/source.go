package webpushsettings

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/publira/publira/server/internal/push"
)

// CacheTTL is how long a process serves what it read before reading the row
// again, and so how long a saved subject takes to reach every instance.
const CacheTTL = 10 * time.Second

// cached reads a value and keeps it for a TTL. A failed reread serves the last
// value and waits another TTL, so an outage costs one query per TTL.
type cached[T any] struct {
	load   func(ctx context.Context) (T, error)
	ttl    time.Duration
	now    func() time.Time
	logger *slog.Logger
	what   string

	mu         sync.Mutex
	value      T
	hasValue   bool
	nextReadAt time.Time
}

func (c *cached[T]) get(ctx context.Context) (T, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := c.now()
	if c.hasValue && now.Before(c.nextReadAt) {
		return c.value, nil
	}
	value, err := c.load(ctx)
	if err != nil {
		if c.hasValue {
			c.nextReadAt = now.Add(c.ttl)
			c.logger.WarnContext(ctx, "serving the last "+c.what+" read", "error", err)
			return c.value, nil
		}
		var zero T
		return zero, err
	}
	c.value, c.hasValue, c.nextReadAt = value, true, now.Add(c.ttl)
	return value, nil
}

// PublicKeyQuerier is what the storefront reads the published key with.
type PublicKeyQuerier interface {
	GetPublishedWebPushPublicKey(ctx context.Context) (string, error)
}

// PublicKeys answers the VAPID public key the storefront publishes.
type PublicKeys struct {
	cache cached[string]
}

// NewPublicKeys returns a PublicKeys over queries that rereads the row once
// ttl has passed.
func NewPublicKeys(queries PublicKeyQuerier, ttl time.Duration, logger *slog.Logger) *PublicKeys {
	if logger == nil {
		logger = slog.Default()
	}
	return &PublicKeys{cache: cached[string]{
		load: func(ctx context.Context) (string, error) {
			key, err := queries.GetPublishedWebPushPublicKey(ctx)
			if isNoRows(err) {
				return "", nil
			}
			return key, err
		},
		ttl:    ttl,
		now:    time.Now,
		logger: logger,
		what:   "web push public key",
	}}
}

// PublicKey answers the key browsers subscribe with, or "" while Web Push is
// not configured.
func (p *PublicKeys) PublicKey(ctx context.Context) (string, error) {
	return p.cache.get(ctx)
}

// Senders delivers Web Push signed with the stored credentials, rebuilding its
// client only when what it reads back differs from what it signed with last.
type Senders struct {
	cache cached[*push.WebPushClient]

	// last is what client was built from, touched only under the cache's lock.
	last   Credentials
	client *push.WebPushClient
}

// NewSenders returns a Senders over queries that rereads the row once ttl has
// passed.
func NewSenders(queries CredentialsQuerier, mgr SecretManager, ttl time.Duration, logger *slog.Logger) *Senders {
	if logger == nil {
		logger = slog.Default()
	}
	s := &Senders{}
	s.cache = cached[*push.WebPushClient]{
		load: func(ctx context.Context) (*push.WebPushClient, error) {
			credentials, err := LoadCredentials(ctx, queries, mgr)
			if errors.Is(err, ErrNotConfigured) {
				s.last, s.client = Credentials{}, nil
				return nil, nil
			}
			if err != nil {
				return nil, err
			}
			if s.client != nil && credentials == s.last {
				return s.client, nil
			}
			client, err := push.NewWebPushClient(push.WebPushConfig{
				VAPIDPublicKey:  credentials.PublicKey,
				VAPIDPrivateKey: credentials.PrivateKey,
				Subscriber:      credentials.Subject,
			})
			if err != nil {
				return nil, err
			}
			s.last, s.client = credentials, client
			return client, nil
		},
		ttl:    ttl,
		now:    time.Now,
		logger: logger,
		what:   "web push credentials",
	}
	return s
}

// Send delivers one message, reporting [ErrNotConfigured] while no subject is
// saved.
func (s *Senders) Send(ctx context.Context, subscription push.WebPushSubscription, message push.WebPushMessage) error {
	client, err := s.cache.get(ctx)
	if err != nil {
		return err
	}
	if client == nil {
		return ErrNotConfigured
	}
	return client.Send(ctx, subscription, message)
}
