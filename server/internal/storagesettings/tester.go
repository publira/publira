package storagesettings

import "context"

// Operation is one of the things Publira does to the bucket. The four together
// are everything it does: an upload writes, the image server reads, and the
// orphan sweep lists and deletes.
type Operation int

const (
	OperationPutObject Operation = iota + 1
	OperationGetObject
	OperationListObjects
	OperationDeleteObject
)

// Check is what one operation answered. Reason is empty when it worked and
// otherwise a stable rpcerrors STORAGE_TEST_* code, never the provider's own
// message: that message can quote the request it was given, credential and
// all.
type Check struct {
	Operation Operation
	Reason    string
}

// Succeeded reports a check the store did what was asked of it.
func (c Check) Succeeded() bool {
	return c.Reason == ""
}

// Tester exercises a configuration against the store it addresses. The checks
// come back in the order they were performed, and an operation the following
// ones depend on ends the run, so a caller reads the list rather than assuming
// four entries.
//
// It returns an error only when nothing could be attempted at all — a client
// that cannot be built from these settings. A store that refused every
// operation is a full list of failed checks and no error, because which of
// them it refused is the answer the operator needs.
type Tester interface {
	TestConnection(ctx context.Context, settings Settings, credentials Credentials) ([]Check, error)
}

// Failed answers the first check that did not succeed, which is the one a
// failure is recorded and reported as.
func Failed(checks []Check) (Check, bool) {
	for _, check := range checks {
		if !check.Succeeded() {
			return check, true
		}
	}
	return Check{}, false
}
