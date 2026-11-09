package testutil

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// valkeyImage is the image compose.yaml runs as the shared cache, so a test
// talks to the server the Dev Container does.
const valkeyImage = "valkey/valkey:9.1.3-alpine3.24"

var (
	sharedValkeyOnce sync.Once
	sharedValkeyURL  string
	sharedValkeyErr  error
)

// StartValkey starts or returns a shared Valkey container and answers its
// redis:// URL. Every test that takes it shares one keyspace, so each keeps to
// keys of its own. It skips when -short is set or Docker is unavailable.
func StartValkey(t *testing.T) string {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping Valkey integration test in short mode")
	}
	sharedValkeyOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		sharedValkeyURL, sharedValkeyErr = startValkey(ctx)
	})
	if sharedValkeyErr != nil {
		if isDockerUnavailable(sharedValkeyErr) {
			t.Skipf("skipping Valkey integration test: Docker unavailable: %v", sharedValkeyErr)
		}
		t.Fatalf("valkey testcontainer: %v", sharedValkeyErr)
	}
	return sharedValkeyURL
}

func startValkey(ctx context.Context) (string, error) {
	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        valkeyImage,
			ExposedPorts: []string{"6379/tcp"},
			WaitingFor:   wait.ForLog("Ready to accept connections").WithStartupTimeout(time.Minute),
		},
		Started: true,
	})
	if err != nil {
		return "", fmt.Errorf("start valkey container: %w", err)
	}
	host, err := container.Host(ctx)
	if err != nil {
		_ = testcontainers.TerminateContainer(container)
		return "", fmt.Errorf("valkey host: %w", err)
	}
	port, err := container.MappedPort(ctx, "6379/tcp")
	if err != nil {
		_ = testcontainers.TerminateContainer(container)
		return "", fmt.Errorf("valkey mapped port: %w", err)
	}
	return fmt.Sprintf("redis://%s:%s/0", host, port.Port()), nil
}
