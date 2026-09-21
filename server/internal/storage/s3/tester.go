package s3

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awshttp "github.com/aws/aws-sdk-go-v2/aws/transport/http"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"

	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/storagesettings"
)

const (
	// connectionTestTimeout bounds one operation of the test. An operator is
	// waiting on the answer, so a store that never replies has to give up
	// sooner than an upload behind a request would.
	connectionTestTimeout = 10 * time.Second
	// probeKeyPrefix puts the probe where the orphan sweep reclaims it, so a
	// probe a refused or timed-out delete leaves behind is gone a day later
	// rather than kept forever. No row ever names it, and the segment cannot
	// be a tenant's public ID, whose Base58 alphabet has no "_" or "-".
	probeKeyPrefix = "tenants/_connection-test/"
)

var probeBody = []byte("publira storage connection test\n")

// ConnectionTester exercises a configuration against the store it addresses,
// as [storagesettings.Tester].
type ConnectionTester struct {
	timeout time.Duration
}

func NewConnectionTester() *ConnectionTester {
	return &ConnectionTester{timeout: connectionTestTimeout}
}

// TestConnection writes a probe object, reads it back, finds it in a listing,
// and takes it away again — the four operations Publira performs on a bucket,
// in the order that lets each one answer for itself.
func (t *ConnectionTester) TestConnection(
	ctx context.Context,
	settings storagesettings.Settings,
	credentials storagesettings.Credentials,
) ([]storagesettings.Check, error) {
	client, err := newClient(ctx, Config{
		Bucket:          settings.Bucket,
		Region:          settings.Region,
		Endpoint:        settings.Endpoint,
		PublicBaseURL:   settings.PublicBaseURL,
		AccessKeyID:     credentials.AccessKeyID,
		SecretAccessKey: credentials.SecretAccessKey,
		ForcePathStyle:  settings.ForcePathStyle,
	})
	if err != nil {
		return nil, err
	}
	key, err := probeKey()
	if err != nil {
		return nil, err
	}

	checks := make([]storagesettings.Check, 0, 4)
	putErr := t.putProbe(ctx, client, settings.Bucket, key)
	checks = append(checks, check(storagesettings.OperationPutObject, putErr))
	// Nothing below has an object to work on when the write was refused, and
	// there is nothing left behind to clean up either.
	if putErr != nil {
		return checks, nil
	}

	checks = append(checks, check(storagesettings.OperationGetObject, t.getProbe(ctx, client, settings.Bucket, key)))
	checks = append(checks, check(storagesettings.OperationListObjects, t.listProbe(ctx, client, settings.Bucket, key)))
	// The delete is attempted whatever the two before it answered: the probe
	// is Publira's own object, and leaving it in an operator's bucket is not
	// something a failed read excuses.
	checks = append(checks, check(storagesettings.OperationDeleteObject, t.deleteProbe(ctx, client, settings.Bucket, key)))
	return checks, nil
}

func (t *ConnectionTester) putProbe(ctx context.Context, client *s3.Client, bucket, key string) error {
	opCtx, cancel := context.WithTimeout(ctx, t.timeout)
	defer cancel()

	_, err := client.PutObject(opCtx, &s3.PutObjectInput{
		Bucket:      aws.String(bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(probeBody),
		ContentType: aws.String("text/plain"),
	})
	return err
}

func (t *ConnectionTester) getProbe(ctx context.Context, client *s3.Client, bucket, key string) error {
	opCtx, cancel := context.WithTimeout(ctx, t.timeout)
	defer cancel()

	out, err := client.GetObject(opCtx, &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return err
	}
	defer out.Body.Close() //nolint:errcheck
	// The body is read to the end rather than dropped: a store that answers
	// the request and then fails to deliver the bytes serves no image either.
	if _, err := io.Copy(io.Discard, out.Body); err != nil {
		return err
	}
	return nil
}

func (t *ConnectionTester) listProbe(ctx context.Context, client *s3.Client, bucket, key string) error {
	opCtx, cancel := context.WithTimeout(ctx, t.timeout)
	defer cancel()

	page, err := client.ListObjectsV2(opCtx, &s3.ListObjectsV2Input{
		Bucket:  aws.String(bucket),
		Prefix:  aws.String(key),
		MaxKeys: aws.Int32(1),
	})
	if err != nil {
		return err
	}
	for _, object := range page.Contents {
		if aws.ToString(object.Key) == key {
			return nil
		}
	}
	// The listing worked and does not hold the object that was just written.
	// The orphan sweep decides what to delete from exactly this listing, so a
	// bucket that answers this way is one it cannot be pointed at.
	return errProbeUnlisted
}

func (t *ConnectionTester) deleteProbe(ctx context.Context, client *s3.Client, bucket, key string) error {
	opCtx, cancel := context.WithTimeout(ctx, t.timeout)
	defer cancel()

	out, err := client.DeleteObjects(opCtx, &s3.DeleteObjectsInput{
		Bucket: aws.String(bucket),
		Delete: &s3types.Delete{Objects: []s3types.ObjectIdentifier{{Key: aws.String(key)}}, Quiet: aws.Bool(true)},
	})
	if err != nil {
		return err
	}
	// A batch delete reports a refused key in the response body rather than as
	// a request error.
	if len(out.Errors) > 0 {
		return deleteRefusedError{code: aws.ToString(out.Errors[0].Code)}
	}
	return nil
}

// errProbeUnlisted is what a listing that does not hold the object just
// written reports.
var errProbeUnlisted = errors.New("the object just written is not in the listing")

// deleteRefusedError carries the code a batch delete refused one key with, so
// the same classification applies to it as to a failed request.
type deleteRefusedError struct {
	code string
}

func (e deleteRefusedError) Error() string {
	return fmt.Sprintf("delete refused: %s", e.code)
}

func check(operation storagesettings.Operation, err error) storagesettings.Check {
	return storagesettings.Check{Operation: operation, Reason: TestFailureReason(err)}
}

// TestFailureReason classifies a connection test failure into a stable API
// reason. The provider's own message never travels with it: it quotes the
// request it was given, down to the key and the credential that signed it.
func TestFailureReason(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, errProbeUnlisted) {
		return rpcerrors.ReasonStorageTestObjectMissing
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return rpcerrors.ReasonStorageTestTimeout
	}

	var refused deleteRefusedError
	if errors.As(err, &refused) {
		return reasonForAPICode(refused.code)
	}
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		if reason := reasonForAPICode(apiErr.ErrorCode()); reason != rpcerrors.ReasonStorageTestUnknown {
			return reason
		}
	}
	var responseErr *awshttp.ResponseError
	if errors.As(err, &responseErr) {
		switch responseErr.HTTPStatusCode() {
		case 401, 403:
			return rpcerrors.ReasonStorageTestPermission
		case 404:
			return rpcerrors.ReasonStorageTestBucketNotFound
		}
	}

	var dnsErr *net.DNSError
	var netErr net.Error
	if errors.As(err, &dnsErr) || errors.As(err, &netErr) {
		return rpcerrors.ReasonStorageTestConnection
	}
	// A credential the SDK could not resolve fails before any request goes
	// out, and it carries no API code to match on.
	if strings.Contains(strings.ToLower(err.Error()), "credential") {
		return rpcerrors.ReasonStorageTestCredentials
	}
	return rpcerrors.ReasonStorageTestUnknown
}

func reasonForAPICode(code string) string {
	switch code {
	case "InvalidAccessKeyId", "SignatureDoesNotMatch", "InvalidSecurity", "ExpiredToken", "InvalidToken", "UnrecognizedClientException":
		return rpcerrors.ReasonStorageTestCredentials
	case "AccessDenied", "AllAccessDisabled", "InvalidObjectState":
		return rpcerrors.ReasonStorageTestPermission
	case "NoSuchBucket":
		return rpcerrors.ReasonStorageTestBucketNotFound
	case "NoSuchKey":
		return rpcerrors.ReasonStorageTestObjectMissing
	default:
		return rpcerrors.ReasonStorageTestUnknown
	}
}

func probeKey() (string, error) {
	suffix := make([]byte, 16)
	if _, err := rand.Read(suffix); err != nil {
		return "", fmt.Errorf("name connection test object: %w", err)
	}
	return probeKeyPrefix + hex.EncodeToString(suffix) + ".txt", nil
}
