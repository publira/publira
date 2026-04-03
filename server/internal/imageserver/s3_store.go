package imageserver

import (
	"context"
	"errors"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	awshttp "github.com/aws/aws-sdk-go-v2/aws/transport/http"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
)

type S3Store struct {
	client *s3.Client
	bucket string
}

func NewS3Store(client *s3.Client, bucket string) *S3Store {
	return &S3Store{client: client, bucket: bucket}
}

func (s *S3Store) GetObject(ctx context.Context, key string) (ObjectResult, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		var noSuchKey *s3types.NoSuchKey
		if errors.As(err, &noSuchKey) {
			return ObjectResult{}, ErrObjectNotFound
		}
		var respErr *awshttp.ResponseError
		if errors.As(err, &respErr) && respErr.HTTPStatusCode() == 404 {
			return ObjectResult{}, ErrObjectNotFound
		}
		return ObjectResult{}, fmt.Errorf("get object from s3: %w", err)
	}

	contentType := ""
	if out.ContentType != nil {
		contentType = aws.ToString(out.ContentType)
	}

	contentLength := int64(0)
	if out.ContentLength != nil {
		contentLength = aws.ToInt64(out.ContentLength)
	}

	return ObjectResult{
		Body:          out.Body,
		ContentType:   contentType,
		ContentLength: contentLength,
	}, nil
}
