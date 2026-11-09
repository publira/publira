// Package tenantstatus names the states a tenant is in, and the answer every
// surface that serves a tenant gives one that is suspended.
//
// A tenant an operator asked to delete stays suspended until the worker has
// erased it, and is told apart by tenants.deletion_requested_at rather than by
// a status of its own: every surface that refuses a suspended tenant refuses
// it with no check of its own, the previous release's included.
//
// Suspension is checked where a request is resolved to its tenant — the public
// and admin APIs' tenant-scoped interceptors, their GetTenantByDomain, and the
// image routes — rather than in the queries that read the row: the Platform
// Console and publiractl look a suspended tenant up through those same queries
// to keep managing it.
package tenantstatus

import (
	"errors"

	"connectrpc.com/connect/v2"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// The values tenants.status takes.
const (
	Active    = "active"
	Suspended = "suspended"
)

// Deleting is the status the platform answers for a suspended tenant marked
// for deletion. No row stores it.
const Deleting = "deleting"

// Of is the status the platform answers for tenant.
func Of(tenant dbmodels.Tenant) string {
	if IsDeleting(tenant) {
		return Deleting
	}
	return tenant.Status
}

// IsDeleting reports whether an operator asked for tenant to be deleted.
func IsDeleting(tenant dbmodels.Tenant) bool {
	return tenant.DeletionRequestedAt.Valid
}

// ErrSuspended is the cause of every refusal a suspended tenant gets.
var ErrSuspended = errors.New("tenant is suspended")

// IsSuspended reports whether tenant is to be refused.
func IsSuspended(tenant dbmodels.Tenant) bool {
	return tenant.Status == Suspended
}

// Refusal is what an RPC answers a request for a suspended tenant with:
// failed_precondition with the ErrorInfo reason TENANT_SUSPENDED. A domain no
// tenant serves stays not_found, so a caller can tell the two apart, and
// neither permission_denied nor unavailable is used: the web apps read the
// first as a missing resource and would remember the tenant as absent, and a
// client may retry the second on its own.
func Refusal() *connect.Error {
	return rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, ErrSuspended, rpcerrors.ReasonTenantSuspended)
}
