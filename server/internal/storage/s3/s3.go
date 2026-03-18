package s3

import (
	"bytes"
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/publira/publira/server/internal/storage"
)

type Config struct {
	Bucket         string
	Region         string
	Endpoint       string
	PublicBaseURL  string
	ForcePathStyle bool
}

type Storage struct {
	client        *s3.Client
	bucket        string
	publicBaseURL string
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
		client:        client,
		bucket:        cfg.Bucket,
		publicBaseURL: strings.TrimRight(strings.TrimSpace(cfg.PublicBaseURL), "/"),
	}, nil
}

func (s *Storage) Upload(ctx context.Context, req storage.UploadRequest) (storage.UploadResult, error) {
	key := strings.TrimLeft(req.ObjectKey, "/")
	if key == "" {
		return storage.UploadResult{}, fmt.Errorf("object key is required")
	}
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
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
