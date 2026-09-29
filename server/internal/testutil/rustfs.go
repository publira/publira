package testutil

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	smithyhttp "github.com/aws/smithy-go/transport/http"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

const (
	defaultRustFSImage     = "rustfs/rustfs:1.0.0-rc.2"
	defaultRustFSAccessKey = "publira"
	defaultRustFSSecretKey = "publirapass"
	defaultRustFSBucket    = "publira-test"
	defaultRustFSRegion    = "us-east-1"

	// RustFS answers /health before its S3 API stops returning 503, so the
	// container is handed out only after a write has gone through.
	rustFSWritableTimeout  = 1 * time.Minute
	rustFSWritableInterval = 500 * time.Millisecond
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

	env := &RustFSEnv{
		Container: container,
		Endpoint:  endpoint,
		Bucket:    defaultRustFSBucket,
		AccessKey: defaultRustFSAccessKey,
		SecretKey: defaultRustFSSecretKey,
		Region:    defaultRustFSRegion,
	}

	client, err := env.client(ctx)
	if err != nil {
		_ = testcontainers.TerminateContainer(container)
		return nil, err
	}
	writableCtx, cancel := context.WithTimeout(ctx, rustFSWritableTimeout)
	defer cancel()
	if err := awaitWritable(writableCtx, client, env.Bucket, rustFSWritableInterval); err != nil {
		_ = testcontainers.TerminateContainer(container)
		return nil, err
	}

	return env, nil
}

// awaitWritable creates bucket until the store stops answering 503, and
// reports the last 503 once ctx is done.
func awaitWritable(ctx context.Context, client *s3.Client, bucket string, interval time.Duration) error {
	var unavailable error
	for {
		err := createBucket(ctx, client, bucket)
		if err == nil {
			return nil
		}
		if ctx.Err() != nil && unavailable != nil {
			return fmt.Errorf("rustfs: S3 API still unavailable when the wait ended (%w): %w", ctx.Err(), unavailable)
		}
		var respErr *smithyhttp.ResponseError
		if !errors.As(err, &respErr) || respErr.HTTPStatusCode() != http.StatusServiceUnavailable {
			return fmt.Errorf("rustfs: create bucket %q: %w", bucket, err)
		}
		unavailable = err
		select {
		case <-ctx.Done():
			return fmt.Errorf("rustfs: S3 API still unavailable when the wait ended (%w): %w", ctx.Err(), unavailable)
		case <-time.After(interval):
		}
	}
}

// createBucket creates bucket, treating one that already exists as created.
func createBucket(ctx context.Context, client *s3.Client, bucket string) error {
	_, err := client.CreateBucket(ctx, &s3.CreateBucketInput{
		Bucket: aws.String(bucket),
	})
	var alreadyExists *s3types.BucketAlreadyExists
	var alreadyOwned *s3types.BucketAlreadyOwnedByYou
	if errors.As(err, &alreadyExists) || errors.As(err, &alreadyOwned) {
		return nil
	}
	return err
}

func (e *RustFSEnv) client(ctx context.Context) (*s3.Client, error) {
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(e.Region),
	)
	if err != nil {
		return nil, fmt.Errorf("rustfs: load aws config: %w", err)
	}
	return newS3Client(awsCfg, e.Endpoint), nil
}

// newS3Client makes a single attempt per call: awaitWritable owns the retries.
func newS3Client(awsCfg aws.Config, endpoint string) *s3.Client {
	return s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.UsePathStyle = true
		o.BaseEndpoint = aws.String(endpoint)
		o.RetryMaxAttempts = 1
	})
}

// CreateBucket creates the test bucket in the RustFS container. It is
// idempotent: if the bucket already exists the call succeeds silently.
func (e *RustFSEnv) CreateBucket(t *testing.T) {
	t.Helper()
	e.CreateNamedBucket(t, e.Bucket)
}

// CreateNamedBucket creates a bucket beside the test bucket, for a test that
// moves the platform from one bucket to another.
func (e *RustFSEnv) CreateNamedBucket(t *testing.T, bucket string) {
	t.Helper()

	ctx := context.Background()

	client, err := e.client(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := createBucket(ctx, client, bucket); err != nil {
		t.Fatalf("rustfs: create bucket %q: %v", bucket, err)
	}
}

// DeploymentEnv returns the ambient credential a process signs its requests to
// this object store with. Which store that is comes from the platform's
// settings, which SavePlatformStorage writes.
func (e *RustFSEnv) DeploymentEnv() map[string]string {
	return map[string]string{
		"AWS_ACCESS_KEY_ID":     e.AccessKey,
		"AWS_SECRET_ACCESS_KEY": e.SecretKey,
	}
}

// SavePlatformStorage saves bucket on this object store as the platform's,
// signed with the ambient credential, the way an operator would save it from
// the Platform Console. db must be a pool that may write the row.
func (e *RustFSEnv) SavePlatformStorage(t *testing.T, db *sql.DB, bucket string) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(), `
		INSERT INTO platform_storage_config (singleton, bucket, region, endpoint, force_path_style)
		VALUES (TRUE, $1, $2, $3, TRUE)
		ON CONFLICT (singleton) DO UPDATE
		SET bucket = EXCLUDED.bucket,
			region = EXCLUDED.region,
			endpoint = EXCLUDED.endpoint,
			force_path_style = EXCLUDED.force_path_style,
			access_key_id = NULL,
			secret_access_key_encrypted = NULL,
			revision = platform_storage_config.revision + 1,
			updated_at = NOW()
	`, bucket, e.Region, e.Endpoint); err != nil {
		t.Fatalf("rustfs: save platform storage: %v", err)
	}
}
