package s3

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/publira/publira/server/internal/storage"
)

const (
	defaultUploadTimeout = 15 * time.Second
	// defaultReclaimTimeout bounds one listing page or one delete batch of the
	// orphan sweep. Neither carries a payload, so they are round trips rather
	// than transfers, but they run against a bucket that may hold every
	// tenant's images and deserve more room than a single upload.
	defaultReclaimTimeout = 30 * time.Second
	// maxDeleteBatchSize is the ceiling S3 puts on one DeleteObjects request.
	maxDeleteBatchSize = 1000
)

type apiClient interface {
	PutObject(context.Context, *s3.PutObjectInput, ...func(*s3.Options)) (*s3.PutObjectOutput, error)
	ListObjectsV2(context.Context, *s3.ListObjectsV2Input, ...func(*s3.Options)) (*s3.ListObjectsV2Output, error)
	DeleteObjects(context.Context, *s3.DeleteObjectsInput, ...func(*s3.Options)) (*s3.DeleteObjectsOutput, error)
}

type Config struct {
	Bucket         string
	Region         string
	Endpoint       string
	PublicBaseURL  string
	ForcePathStyle bool
}

type Storage struct {
	client         apiClient
	bucket         string
	publicBaseURL  string
	uploadTimeout  time.Duration
	reclaimTimeout time.Duration
}

func New(ctx context.Context, cfg Config) (*Storage, error) {
	loadOptions := make([]func(*awsconfig.LoadOptions) error, 0, 1)
	if strings.TrimSpace(cfg.Region) != "" {
		loadOptions = append(loadOptions, awsconfig.WithRegion(cfg.Region))
	}
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx, loadOptions...)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}
	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.UsePathStyle = cfg.ForcePathStyle
		if strings.TrimSpace(cfg.Endpoint) != "" {
			o.BaseEndpoint = aws.String(strings.TrimSpace(cfg.Endpoint))
		}
	})
	return &Storage{
		client:         client,
		bucket:         cfg.Bucket,
		publicBaseURL:  strings.TrimRight(strings.TrimSpace(cfg.PublicBaseURL), "/"),
		uploadTimeout:  defaultUploadTimeout,
		reclaimTimeout: defaultReclaimTimeout,
	}, nil
}

func (s *Storage) Upload(ctx context.Context, req storage.UploadRequest) (storage.UploadResult, error) {
	key := strings.TrimLeft(req.ObjectKey, "/")
	if key == "" {
		return storage.UploadResult{}, fmt.Errorf("object key is required")
	}
	uploadCtx, cancel := context.WithTimeout(ctx, s.uploadTimeout)
	defer cancel()

	_, err := s.client.PutObject(uploadCtx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(req.Data),
		ContentType: aws.String(req.ContentType),
	})
	if err != nil {
		return storage.UploadResult{}, fmt.Errorf("put object to s3: %w", err)
	}
	url := fmt.Sprintf("s3://%s/%s", s.bucket, key)
	if s.publicBaseURL != "" {
		url = s.publicBaseURL + "/" + key
	}
	return storage.UploadResult{
		Provider:  "s3",
		ObjectKey: key,
		URL:       url,
		SizeBytes: int64(len(req.Data)),
	}, nil
}

// List returns one page of the objects stored under req.Prefix. The cursor is
// S3's own continuation token, so a page boundary means the same thing to the
// caller as it does to the bucket and a resumed listing never repeats or skips
// a key.
func (s *Storage) List(ctx context.Context, req storage.ListRequest) (storage.ListResult, error) {
	listCtx, cancel := context.WithTimeout(ctx, s.reclaimTimeout)
	defer cancel()

	input := &s3.ListObjectsV2Input{Bucket: aws.String(s.bucket)}
	if prefix := strings.TrimLeft(req.Prefix, "/"); prefix != "" {
		input.Prefix = aws.String(prefix)
	}
	if req.Cursor != "" {
		input.ContinuationToken = aws.String(req.Cursor)
	}
	if req.Limit > 0 {
		input.MaxKeys = aws.Int32(req.Limit)
	}

	page, err := s.client.ListObjectsV2(listCtx, input)
	if err != nil {
		return storage.ListResult{}, fmt.Errorf("list objects in s3: %w", err)
	}

	result := storage.ListResult{Objects: make([]storage.Object, 0, len(page.Contents))}
	for _, object := range page.Contents {
		result.Objects = append(result.Objects, storage.Object{
			ObjectKey:    aws.ToString(object.Key),
			LastModified: aws.ToTime(object.LastModified),
			SizeBytes:    aws.ToInt64(object.Size),
		})
	}
	// IsTruncated is what says another page exists; a bucket may hand back a
	// continuation token on the last page as well.
	if aws.ToBool(page.IsTruncated) {
		result.NextCursor = aws.ToString(page.NextContinuationToken)
	}
	return result, nil
}

// Delete removes every object in objectKeys, in batches of maxDeleteBatchSize.
// A key that is already gone is not an error — the caller's whole job is
// removing what nothing points at, and a concurrent run reaching the same key
// first is the expected way that happens.
func (s *Storage) Delete(ctx context.Context, objectKeys []string) error {
	for start := 0; start < len(objectKeys); start += maxDeleteBatchSize {
		end := min(start+maxDeleteBatchSize, len(objectKeys))
		if err := s.deleteBatch(ctx, objectKeys[start:end]); err != nil {
			return err
		}
	}
	return nil
}

func (s *Storage) deleteBatch(ctx context.Context, objectKeys []string) error {
	deleteCtx, cancel := context.WithTimeout(ctx, s.reclaimTimeout)
	defer cancel()

	identifiers := make([]s3types.ObjectIdentifier, 0, len(objectKeys))
	for _, key := range objectKeys {
		identifiers = append(identifiers, s3types.ObjectIdentifier{Key: aws.String(key)})
	}

	out, err := s.client.DeleteObjects(deleteCtx, &s3.DeleteObjectsInput{
		Bucket: aws.String(s.bucket),
		Delete: &s3types.Delete{Objects: identifiers, Quiet: aws.Bool(true)},
	})
	if err != nil {
		return fmt.Errorf("delete objects in s3: %w", err)
	}
	// A batch delete reports per-key failures in the response body rather than
	// as a request error, so the ones it refused have to be read back out.
	if len(out.Errors) > 0 {
		first := out.Errors[0]
		return fmt.Errorf("delete objects in s3: %d of %d keys failed, first %q: %s",
			len(out.Errors), len(objectKeys), aws.ToString(first.Key), aws.ToString(first.Message))
	}
	return nil
}
