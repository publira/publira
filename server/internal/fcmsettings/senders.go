package fcmsettings

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/push"
	"github.com/publira/publira/server/internal/ttlcache"
)

// CacheTTL is how long a process sends with the credentials it read before
// reading the tenant's row again, and so how long a replacement or a removal
// takes to reach every worker.
const CacheTTL = 10 * time.Second

// Sender is one Firebase project's client.
type Sender interface {
	Send(ctx context.Context, message push.Message) error
}

// NewClient builds a Sender from one tenant's credentials.
type NewClient func(ctx context.Context, cfg push.Config) (Sender, error)

// NewPushClient is the NewClient that talks to Firebase.
func NewPushClient(ctx context.Context, cfg push.Config) (Sender, error) {
	return push.New(ctx, cfg)
}

// CredentialsQuerier is what the senders read a tenant's row with.
type CredentialsQuerier interface {
	GetTenantFcmConfig(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantFcmConfig, error)
}

// Senders sends each tenant's push with that tenant's own credentials, keeping
// one client per tenant and rebuilding it only when the stored row changes.
type Senders struct {
	queries   CredentialsQuerier
	mgr       SecretManager
	newClient NewClient
	ttl       time.Duration
	logger    *slog.Logger

	mu      sync.Mutex
	tenants map[uuid.UUID]*tenantSender
}

// tenantSender is one tenant's client and the row it was built from, touched
// only under its cache's lock.
type tenantSender struct {
	cache  *ttlcache.Value[Sender]
	sealed string
	client Sender
}

// NewSenders returns Senders over queries that rereads a tenant's row once ttl
// has passed since it was last read.
func NewSenders(queries CredentialsQuerier, mgr SecretManager, newClient NewClient, ttl time.Duration, logger *slog.Logger) *Senders {
	return &Senders{
		queries:   queries,
		mgr:       mgr,
		newClient: newClient,
		ttl:       ttl,
		logger:    logger,
		tenants:   make(map[uuid.UUID]*tenantSender),
	}
}

// Send delivers one message with tenantID's credentials, reporting
// [ErrNotConfigured] when the tenant has none stored.
func (s *Senders) Send(ctx context.Context, tenantID uuid.UUID, message push.Message) error {
	client, err := s.tenant(tenantID).cache.Get(ctx)
	if err != nil {
		return err
	}
	if client == nil {
		return ErrNotConfigured
	}
	return client.Send(ctx, message)
}

func (s *Senders) tenant(tenantID uuid.UUID) *tenantSender {
	s.mu.Lock()
	defer s.mu.Unlock()

	if t, ok := s.tenants[tenantID]; ok {
		return t
	}
	logger := s.logger
	if logger == nil {
		logger = slog.Default()
	}
	t := &tenantSender{}
	t.cache = ttlcache.New(func(ctx context.Context) (Sender, error) {
		row, err := s.queries.GetTenantFcmConfig(ctx, tenantID)
		if errors.Is(err, sql.ErrNoRows) {
			t.sealed, t.client = "", nil
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		// The sealed key and the project move together on every save, so an
		// unchanged ciphertext is an unchanged credential and needs no decrypt.
		if t.client != nil && row.ServiceAccountJsonEncrypted == t.sealed {
			return t.client, nil
		}
		credentials, err := open(row, s.mgr)
		if err != nil {
			return nil, err
		}
		client, err := s.newClient(context.WithoutCancel(ctx), push.Config{
			ProjectID:       credentials.ProjectID,
			CredentialsJSON: []byte(credentials.ServiceAccountJSON),
		})
		if err != nil {
			return nil, err
		}
		t.sealed, t.client = row.ServiceAccountJsonEncrypted, client
		return client, nil
	}, s.ttl, logger.With("tenant_id", tenantID.String()), "fcm credentials")
	s.tenants[tenantID] = t
	return t
}
