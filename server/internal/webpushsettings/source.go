package webpushsettings

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/publira/publira/server/internal/push"
	"github.com/publira/publira/server/internal/ttlcache"
)

// CacheTTL is how long a process serves what it read before reading the row
// again, and so how long a saved subject takes to reach every instance.
const CacheTTL = 10 * time.Second

// PublicKeyQuerier is what the storefront reads the published key with.
type PublicKeyQuerier interface {
	GetPublishedWebPushPublicKey(ctx context.Context) (string, error)
}

// PublicKeys answers the VAPID public key the storefront publishes.
type PublicKeys struct {
	cache *ttlcache.Value[string]
}

// NewPublicKeys returns a PublicKeys over queries that rereads the row once
// ttl has passed.
func NewPublicKeys(queries PublicKeyQuerier, ttl time.Duration, logger *slog.Logger) *PublicKeys {
	return &PublicKeys{cache: ttlcache.New(func(ctx context.Context) (string, error) {
		key, err := queries.GetPublishedWebPushPublicKey(ctx)
		if isNoRows(err) {
			return "", nil
		}
		return key, err
	}, ttl, logger, "web push public key")}
}

// PublicKey answers the key browsers subscribe with, or "" while Web Push is
// not configured.
func (p *PublicKeys) PublicKey(ctx context.Context) (string, error) {
	return p.cache.Get(ctx)
}

// NewClient builds the client a delivery is signed and sent with.
type NewClient func(cfg push.WebPushConfig) (*push.WebPushClient, error)

// NewPushClient is the NewClient that dials only public addresses.
func NewPushClient(cfg push.WebPushConfig) (*push.WebPushClient, error) {
	return push.NewWebPushClient(cfg)
}

// Senders delivers Web Push signed with the stored credentials, rebuilding its
// client only when what it reads back differs from what it signed with last.
type Senders struct {
	cache *ttlcache.Value[*push.WebPushClient]

	// last is what client was built from, touched only under the cache's lock.
	last   Credentials
	client *push.WebPushClient
}

// NewSenders returns a Senders over queries that rereads the row once ttl has
// passed.
func NewSenders(queries CredentialsQuerier, mgr SecretManager, newClient NewClient, ttl time.Duration, logger *slog.Logger) *Senders {
	s := &Senders{}
	s.cache = ttlcache.New(func(ctx context.Context) (*push.WebPushClient, error) {
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
		client, err := newClient(push.WebPushConfig{
			VAPIDPublicKey:  credentials.PublicKey,
			VAPIDPrivateKey: credentials.PrivateKey,
			Subscriber:      credentials.Subject,
		})
		if err != nil {
			return nil, err
		}
		s.last, s.client = credentials, client
		return client, nil
	}, ttl, logger, "web push credentials")
	return s
}

// Send delivers one message, reporting [ErrNotConfigured] while no subject is
// saved.
func (s *Senders) Send(ctx context.Context, subscription push.WebPushSubscription, message push.WebPushMessage) error {
	client, err := s.cache.Get(ctx)
	if err != nil {
		return err
	}
	if client == nil {
		return ErrNotConfigured
	}
	return client.Send(ctx, subscription, message)
}
