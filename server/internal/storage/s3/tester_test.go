package s3

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"testing"

	awshttp "github.com/aws/aws-sdk-go-v2/aws/transport/http"
	"github.com/aws/smithy-go"
	smithyhttp "github.com/aws/smithy-go/transport/http"

	"github.com/publira/publira/server/internal/orphanimages"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// A probe whose delete was refused is reclaimed by the orphan sweep, which
// walks nothing outside its own prefix.
func TestProbeKeysAreWhereTheOrphanSweepReclaimsThem(t *testing.T) {
	t.Parallel()

	key, err := probeKey()
	if err != nil {
		t.Fatalf("probeKey: %v", err)
	}
	if !strings.HasPrefix(key, orphanimages.DefaultPrefix) {
		t.Fatalf("probe key %q is outside %q, which the orphan sweep walks", key, orphanimages.DefaultPrefix)
	}
}

// forbiddenResponseError is the shape a store's 403 with no error code in its
// body arrives in.
func forbiddenResponseError() error {
	return &awshttp.ResponseError{
		ResponseError: &smithyhttp.ResponseError{
			Response: &smithyhttp.Response{Response: &http.Response{StatusCode: http.StatusForbidden}},
			Err:      errors.New("forbidden"),
		},
	}
}

func TestTestFailureReasonClassifiesWhatAStoreRefusedWith(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name string
		err  error
		want string
	}{
		{name: "nothing refused", err: nil, want: ""},
		{
			name: "an unknown access key",
			err:  fmt.Errorf("operation error S3: PutObject: %w", &smithy.GenericAPIError{Code: "InvalidAccessKeyId"}),
			want: rpcerrors.ReasonStorageTestCredentials,
		},
		{
			name: "a signature the store did not accept",
			err:  &smithy.GenericAPIError{Code: "SignatureDoesNotMatch"},
			want: rpcerrors.ReasonStorageTestCredentials,
		},
		{
			name: "a denied operation",
			err:  &smithy.GenericAPIError{Code: "AccessDenied"},
			want: rpcerrors.ReasonStorageTestPermission,
		},
		{
			name: "a bucket that is not there",
			err:  &smithy.GenericAPIError{Code: "NoSuchBucket"},
			want: rpcerrors.ReasonStorageTestBucketNotFound,
		},
		{
			name: "a key refused by a batch delete",
			err:  deleteRefusedError{code: "AccessDenied"},
			want: rpcerrors.ReasonStorageTestPermission,
		},
		{
			name: "an object the listing does not hold",
			err:  errProbeUnlisted,
			want: rpcerrors.ReasonStorageTestObjectMissing,
		},
		{
			name: "a status with no code behind it",
			err:  forbiddenResponseError(),
			want: rpcerrors.ReasonStorageTestPermission,
		},
		{
			name: "a host that does not resolve",
			err:  fmt.Errorf("dial: %w", &net.DNSError{Err: "no such host", Name: "s3.example.invalid"}),
			want: rpcerrors.ReasonStorageTestConnection,
		},
		{
			name: "a request that ran out of time",
			err:  fmt.Errorf("operation error S3: PutObject: %w", context.DeadlineExceeded),
			want: rpcerrors.ReasonStorageTestTimeout,
		},
		{
			name: "a credential the SDK could not resolve",
			err:  errors.New("failed to refresh cached credentials, no EC2 IMDS role found"),
			want: rpcerrors.ReasonStorageTestCredentials,
		},
		{
			name: "anything else",
			err:  errors.New("something the store has not said before"),
			want: rpcerrors.ReasonStorageTestUnknown,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			if got := TestFailureReason(tc.err); got != tc.want {
				t.Fatalf("TestFailureReason() = %q, want %q", got, tc.want)
			}
		})
	}
}
