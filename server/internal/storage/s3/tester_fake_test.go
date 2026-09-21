package s3

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/publira/publira/server/internal/orphanimages"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/storagesettings"
)

const fakeBucket = "publira-objects"

// fakeStore answers the four requests a connection test makes the way an
// S3-compatible endpoint would, with two misbehaviours a real store cannot be
// talked into: a read that answers other bytes, and a listing refused for the
// sweep's prefix while allowed for the probe's own.
type fakeStore struct {
	alteredBody        string
	refuseSweepListing bool
	mu                 sync.Mutex
	written            string
}

func (f *fakeStore) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	key := strings.TrimPrefix(r.URL.Path, "/"+fakeBucket+"/")
	switch {
	case r.Method == http.MethodPut:
		f.mu.Lock()
		f.written = key
		f.mu.Unlock()
		w.WriteHeader(http.StatusOK)
	case r.Method == http.MethodPost && query.Has("delete"):
		w.Header().Set("Content-Type", "application/xml")
		_, _ = fmt.Fprint(w, `<?xml version="1.0" encoding="UTF-8"?><DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></DeleteResult>`)
	case r.Method == http.MethodGet && query.Get("list-type") == "2":
		prefix := query.Get("prefix")
		if f.refuseSweepListing && prefix == orphanimages.DefaultPrefix {
			w.Header().Set("Content-Type", "application/xml")
			w.WriteHeader(http.StatusForbidden)
			_, _ = fmt.Fprint(w, `<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>`)
			return
		}
		f.mu.Lock()
		written := f.written
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/xml")
		_, _ = fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>%s</Name><Prefix>%s</Prefix><KeyCount>1</KeyCount><MaxKeys>1</MaxKeys><IsTruncated>false</IsTruncated><Contents><Key>%s</Key><Size>%d</Size></Contents></ListBucketResult>`,
			fakeBucket, prefix, written, len(probeBody))
	case r.Method == http.MethodGet:
		body := string(probeBody)
		if f.alteredBody != "" {
			body = f.alteredBody
		}
		w.Header().Set("Content-Type", "text/plain")
		_, _ = fmt.Fprint(w, body)
	default:
		w.WriteHeader(http.StatusNotImplemented)
	}
}

func testAgainst(t *testing.T, store *fakeStore) map[storagesettings.Operation]string {
	t.Helper()

	server := httptest.NewServer(store)
	t.Cleanup(server.Close)

	checks, err := NewConnectionTester().TestConnection(context.Background(), storagesettings.Settings{
		Bucket:         fakeBucket,
		Region:         "us-east-1",
		Endpoint:       server.URL,
		ForcePathStyle: true,
	}, storagesettings.Credentials{AccessKeyID: "AKIAEXAMPLE", SecretAccessKey: "secret"})
	if err != nil {
		t.Fatalf("TestConnection: %v", err)
	}
	reasons := make(map[storagesettings.Operation]string, len(checks))
	for _, check := range checks {
		reasons[check.Operation] = check.Reason
	}
	if len(reasons) != 4 {
		t.Fatalf("TestConnection() returned %d checks, want one per operation", len(reasons))
	}
	return reasons
}

func TestConnectionTesterPassesAStoreThatBehaves(t *testing.T) {
	t.Parallel()

	for operation, reason := range testAgainst(t, &fakeStore{}) {
		if reason != "" {
			t.Fatalf("operation %v was refused with %q", operation, reason)
		}
	}
}

// A proxy that answers 200 with a page of its own serves no image, however
// successful the request looked.
func TestConnectionTesterRefusesAReadThatAnswersOtherBytes(t *testing.T) {
	t.Parallel()

	reasons := testAgainst(t, &fakeStore{alteredBody: "<html>Sign in to continue</html>"})
	if got := reasons[storagesettings.OperationGetObject]; got != rpcerrors.ReasonStorageTestObjectAltered {
		t.Fatalf("the read was reported as %q, want %q", got, rpcerrors.ReasonStorageTestObjectAltered)
	}
}

// The orphan sweep lists its whole prefix, so a policy that allows only the
// probe's own listing leaves the sweep failing on every run.
func TestConnectionTesterRefusesAListingTheSweepCannotMake(t *testing.T) {
	t.Parallel()

	reasons := testAgainst(t, &fakeStore{refuseSweepListing: true})
	if got := reasons[storagesettings.OperationListObjects]; got != rpcerrors.ReasonStorageTestPermission {
		t.Fatalf("the listing was reported as %q, want %q", got, rpcerrors.ReasonStorageTestPermission)
	}
	if got := reasons[storagesettings.OperationDeleteObject]; got != "" {
		t.Fatalf("the delete was reported as %q, want it to still run and succeed", got)
	}
}
