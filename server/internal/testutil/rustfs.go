package testutil

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

const (
	defaultRustFSImage     = "rustfs/rustfs:1.0.0-rc.2"
	defaultRustFSAccessKey = "publira"
	defaultRustFSSecretKey = "publirapass"
	defaultRustFSBucket    = "publira-test"
	defaultRustFSRegion    = "us-east-1"
)

type RustFSEnv struct {
	Container testcontainers.Container
	Endpoint  string
	Bucket    string
	AccessKey string
	SecretKey string
	Region    string
}

var (
	sharedRustFSMu  sync.Mutex
	sharedRustFSEnv *RustFSEnv
	sharedRustFSErr error
)

// StartRustFS starts or returns a shared RustFS container for integration tests.
// Skips when -short is set or Docker is unavailable.
func StartRustFS(t *testing.T) *RustFSEnv {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping RustFS integration test in short mode")
	}

	sharedRustFSMu.Lock()
	defer sharedRustFSMu.Unlock()

	if sharedRustFSEnv != nil || sharedRustFSErr != nil {
		if sharedRustFSErr != nil {
			if isDockerUnavailable(sharedRustFSErr) {
				t.Skipf("skipping RustFS integration test: Docker unavailable: %v", sharedRustFSErr)
			}
			t.Fatalf("rustfs testcontainer: %v", sharedRustFSErr)
		}
		return sharedRustFSEnv
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	env, err := startRustFS(ctx)
	if err != nil {
		sharedRustFSErr = err
		if isDockerUnavailable(err) {
			t.Skipf("skipping RustFS integration test: Docker unavailable: %v", err)
		}
		t.Fatalf("rustfs testcontainer: %v", err)
	}
	sharedRustFSEnv = env
	return sharedRustFSEnv
}

func startRustFS(ctx context.Context) (*RustFSEnv, error) {
	req := testcontainers.ContainerRequest{
		Image:        defaultRustFSImage,
		ExposedPorts: []string{"9000/tcp"},
		Env: map[string]string{
			"RUSTFS_ACCESS_KEY": defaultRustFSAccessKey,
			"RUSTFS_SECRET_KEY": defaultRustFSSecretKey,
		},
		WaitingFor: wait.ForHTTP("/health").WithPort("9000/tcp").WithStartupTimeout(1 * time.Minute),
	}

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	})
	if err != nil {
		return nil, fmt.Errorf("start rustfs container: %w", err)
	}

	host, err := container.Host(ctx)
	if err != nil {
		_ = testcontainers.TerminateContainer(container)
		return nil, fmt.Errorf("rustfs host: %w", err)
	}

	port, err := container.MappedPort(ctx, "9000/tcp")
	if err != nil {
		_ = testcontainers.TerminateContainer(container)
		return nil, fmt.Errorf("rustfs mapped port: %w", err)
	}

	endpoint := fmt.Sprintf("http://%s:%s", host, port.Port())

	// storage/s3 resolves credentials through the SDK's default chain, so the
	// container's keys have to reach it as process environment. The shared
	// container outlives any single test, which rules out t.Setenv (it
	// restores at test end and forbids parallel tests).
	_ = os.Setenv("AWS_ACCESS_KEY_ID", defaultRustFSAccessKey)
	_ = os.Setenv("AWS_SECRET_ACCESS_KEY", defaultRustFSSecretKey)
	_ = os.Setenv("AWS_REGION", defaultRustFSRegion)

	return &RustFSEnv{
		Container: container,
		Endpoint:  endpoint,
		Bucket:    defaultRustFSBucket,
		AccessKey: defaultRustFSAccessKey,
		SecretKey: defaultRustFSSecretKey,
		Region:    defaultRustFSRegion,
	}, nil
}

// CreateBucket creates the test bucket in the RustFS container. It is
// idempotent: if the bucket already exists the call succeeds silently.
func (e *RustFSEnv) CreateBucket(t *testing.T) {
	t.Helper()

	ctx := context.Background()

	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(e.Region),
	)
	if err != nil {
		t.Fatalf("rustfs: load aws config: %v", err)
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.UsePathStyle = true
		o.BaseEndpoint = aws.String(e.Endpoint)
	})

	_, err = client.CreateBucket(ctx, &s3.CreateBucketInput{
		Bucket: aws.String(e.Bucket),
	})
	if err != nil {
		var alreadyExists *s3types.BucketAlreadyExists
		var alreadyOwned *s3types.BucketAlreadyOwnedByYou
		if errors.As(err, &alreadyExists) || errors.As(err, &alreadyOwned) {
			return
		}
		t.Fatalf("rustfs: create bucket %q: %v", e.Bucket, err)
	}
}
