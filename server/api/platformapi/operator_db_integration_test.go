package platformapi

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auth"
	publirasplatformv1 "github.com/publira/publira/server/internal/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/gen/publira/platform/v1/publirasplatformv1connect"
)

func TestDBCreateOperatorPersistsAndLists(t *testing.T) {
	ts, pg, superAdmin := newDBIntegrationSuperAdminServer(t)
	client := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)

	createResp, err := client.CreateOperator(context.Background(), newDBAuthedRequest(superAdmin, publirasplatformv1.CreateOperatorRequest{
		Name:  "New Operator",
		Email: "New.Operator@Example.com",
		Role:  auth.RolePlatformOperator,
	}))
	if err != nil {
		t.Fatalf("CreateOperator: %v", err)
	}
	created := createResp.Msg.Operator
	if created.PublicId == "" {
		t.Fatal("created operator public_id is empty")
	}
	// The handler lower-cases the address before it is stored, so the normalized
	// form has to be what actually landed in platform_users.
	if created.Email != "new.operator@example.com" {
		t.Fatalf("created email = %q, want new.operator@example.com", created.Email)
	}
	if stored := platformUserByPublicID(t, pg, created.PublicId); stored.Email != "new.operator@example.com" {
		t.Fatalf("stored email = %q, want new.operator@example.com", stored.Email)
	}
	if created.Role != auth.RolePlatformOperator {
		t.Fatalf("created role = %q, want %s", created.Role, auth.RolePlatformOperator)
	}
	if created.Status != userStatusActive {
		t.Fatalf("created status = %q, want %s", created.Status, userStatusActive)
	}

	listResp, err := client.ListOperators(context.Background(), newDBAuthedRequest(superAdmin, publirasplatformv1.ListOperatorsRequest{}))
	if err != nil {
		t.Fatalf("ListOperators: %v", err)
	}
	// Counted before the map collapses duplicates, so a repeated row is caught.
	if len(listResp.Msg.Operators) != 2 {
		t.Fatalf("listed operators = %d, want the seeded super admin and the new operator", len(listResp.Msg.Operators))
	}
	roles := make(map[string]string, len(listResp.Msg.Operators))
	for _, operator := range listResp.Msg.Operators {
		roles[operator.PublicId] = operator.Role
	}
	if len(roles) != 2 {
		t.Fatalf("listed operators cover %d distinct public IDs, want 2", len(roles))
	}
	if roles[superAdmin.PublicID] != auth.RolePlatformSuperAdmin {
		t.Fatalf("super admin role = %q, want %s", roles[superAdmin.PublicID], auth.RolePlatformSuperAdmin)
	}
	if roles[created.PublicId] != auth.RolePlatformOperator {
		t.Fatalf("new operator role = %q, want %s", roles[created.PublicId], auth.RolePlatformOperator)
	}

	getResp, err := client.GetOperator(context.Background(), newDBAuthedRequest(superAdmin, publirasplatformv1.GetOperatorRequest{
		PublicId: created.PublicId,
	}))
	if err != nil {
		t.Fatalf("GetOperator: %v", err)
	}
	if getResp.Msg.Operator.PublicId != created.PublicId {
		t.Fatalf("GetOperator public_id = %q, want %q", getResp.Msg.Operator.PublicId, created.PublicId)
	}
	if getResp.Msg.Operator.Email != created.Email {
		t.Fatalf("GetOperator email = %q, want %q", getResp.Msg.Operator.Email, created.Email)
	}

	// One role row per operator: the creation must not leave extras behind.
	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_user_roles"); got != 2 {
		t.Fatalf("platform_user_roles rows = %d, want 2", got)
	}
}

func TestDBCreateOperatorRejectsExistingOperatorEmail(t *testing.T) {
	ts, pg, superAdmin := newDBIntegrationSuperAdminServer(t)
	client := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)

	// Addresses are normalized before the lookup, so a differently cased address
	// has to collide with the stored one rather than create a second account.
	for _, email := range []string{superAdmin.Email, strings.ToUpper(superAdmin.Email)} {
		_, err := client.CreateOperator(context.Background(), newDBAuthedRequest(superAdmin, publirasplatformv1.CreateOperatorRequest{
			Name:  "Duplicate",
			Email: email,
			Role:  auth.RolePlatformOperator,
		}))
		if connect.CodeOf(err) != connect.CodeAlreadyExists {
			t.Fatalf("CreateOperator %q code = %v, want already_exists (err=%v)", email, connect.CodeOf(err), err)
		}
	}

	// The failed attempts are rolled back, so the existing operator keeps its role
	// and no second platform user is created.
	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_users"); got != 1 {
		t.Fatalf("platform_users rows = %d, want 1", got)
	}
	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_user_roles WHERE role = $1", auth.RolePlatformSuperAdmin); got != 1 {
		t.Fatalf("super admin role rows = %d, want 1", got)
	}
}

// A platform user that exists without a role (an end of some earlier flow) is
// promoted in place rather than duplicated.
func TestDBCreateOperatorPromotesRolelessPlatformUser(t *testing.T) {
	ts, pg, superAdmin := newDBIntegrationSuperAdminServer(t)
	existing := seedPlatformUserWithoutRole(t, pg, "PLATNOROLE01", "roleless@example.com", "Roleless User")
	client := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)

	createResp, err := client.CreateOperator(context.Background(), newDBAuthedRequest(superAdmin, publirasplatformv1.CreateOperatorRequest{
		Name:  "Promoted Operator",
		Email: existing.Email,
		Role:  auth.RolePlatformAuditor,
	}))
	if err != nil {
		t.Fatalf("CreateOperator: %v", err)
	}
	if createResp.Msg.Operator.PublicId != existing.PublicID {
		t.Fatalf("public_id = %q, want the existing user %q", createResp.Msg.Operator.PublicId, existing.PublicID)
	}
	if createResp.Msg.Operator.Role != auth.RolePlatformAuditor {
		t.Fatalf("role = %q, want %s", createResp.Msg.Operator.Role, auth.RolePlatformAuditor)
	}
	// The name comes from the existing row; only the role is added.
	if createResp.Msg.Operator.Name != existing.Name {
		t.Fatalf("name = %q, want the existing %q", createResp.Msg.Operator.Name, existing.Name)
	}
	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_users"); got != 2 {
		t.Fatalf("platform_users rows = %d, want the seeded super admin plus the promoted user", got)
	}
}

func TestDBCreateOperatorRequiresSuperAdmin(t *testing.T) {
	ts, operator := newDBIntegrationTestServer(t)
	client := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)

	_, err := client.CreateOperator(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.CreateOperatorRequest{
		Name:  "New Operator",
		Email: "new-operator@example.com",
		Role:  auth.RolePlatformOperator,
	}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("CreateOperator code = %v, want permission_denied (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBUpdateOperatorRoleReplacesTheExistingRole(t *testing.T) {
	ts, pg, superAdmin := newDBIntegrationSuperAdminServer(t)
	target := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	client := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)

	updateResp, err := client.UpdateOperatorRole(context.Background(), newDBAuthedRequest(superAdmin, publirasplatformv1.UpdateOperatorRoleRequest{
		PublicId: target.PublicID,
		Role:     auth.RolePlatformAuditor,
	}))
	if err != nil {
		t.Fatalf("UpdateOperatorRole: %v", err)
	}
	if updateResp.Msg.Operator.Role != auth.RolePlatformAuditor {
		t.Fatalf("role = %q, want %s", updateResp.Msg.Operator.Role, auth.RolePlatformAuditor)
	}

	// Roles are replaced, not accumulated; the old row has to be gone.
	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_user_roles WHERE platform_user_id = $1", target.ID); got != 1 {
		t.Fatalf("role rows for the target = %d, want exactly the new role", got)
	}
	if got := countRows(t, pg,
		"SELECT COUNT(*) FROM platform_user_roles WHERE platform_user_id = $1 AND role = $2",
		target.ID, auth.RolePlatformAuditor,
	); got != 1 {
		t.Fatalf("auditor role rows = %d, want 1", got)
	}
}

func TestDBUpdateOperatorRoleRejectsSelfDemotion(t *testing.T) {
	ts, pg, superAdmin := newDBIntegrationSuperAdminServer(t)
	client := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)

	_, err := client.UpdateOperatorRole(context.Background(), newDBAuthedRequest(superAdmin, publirasplatformv1.UpdateOperatorRoleRequest{
		PublicId: superAdmin.PublicID,
		Role:     auth.RolePlatformOperator,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("UpdateOperatorRole code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}

	// The refusal comes before the role rows are rewritten, so the only super
	// admin must still hold the role.
	if got := countRows(t, pg,
		"SELECT COUNT(*) FROM platform_user_roles WHERE platform_user_id = $1 AND role = $2",
		superAdmin.ID, auth.RolePlatformSuperAdmin,
	); got != 1 {
		t.Fatalf("super admin role rows = %d, want the role kept", got)
	}
}

func TestDBOperatorStatusTransitions(t *testing.T) {
	ts, pg, superAdmin := newDBIntegrationSuperAdminServer(t)
	target := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	client := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)

	suspendResp, err := client.SuspendOperator(context.Background(), newDBAuthedRequest(superAdmin, publirasplatformv1.SuspendOperatorRequest{
		PublicId: target.PublicID,
	}))
	if err != nil {
		t.Fatalf("SuspendOperator: %v", err)
	}
	if suspendResp.Msg.Operator.Status != userStatusSuspended {
		t.Fatalf("status = %q, want %s", suspendResp.Msg.Operator.Status, userStatusSuspended)
	}

	_, err = client.SuspendOperator(context.Background(), newDBAuthedRequest(superAdmin, publirasplatformv1.SuspendOperatorRequest{
		PublicId: target.PublicID,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("second SuspendOperator code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}

	unsuspendResp, err := client.UnsuspendOperator(context.Background(), newDBAuthedRequest(superAdmin, publirasplatformv1.UnsuspendOperatorRequest{
		PublicId: target.PublicID,
	}))
	if err != nil {
		t.Fatalf("UnsuspendOperator: %v", err)
	}
	if unsuspendResp.Msg.Operator.Status != userStatusActive {
		t.Fatalf("status = %q, want %s", unsuspendResp.Msg.Operator.Status, userStatusActive)
	}

	_, err = client.UnsuspendOperator(context.Background(), newDBAuthedRequest(superAdmin, publirasplatformv1.UnsuspendOperatorRequest{
		PublicId: target.PublicID,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("second UnsuspendOperator code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}

	deactivateResp, err := client.DeactivateOperator(context.Background(), newDBAuthedRequest(superAdmin, publirasplatformv1.DeactivateOperatorRequest{
		PublicId: target.PublicID,
	}))
	if err != nil {
		t.Fatalf("DeactivateOperator: %v", err)
	}
	if deactivateResp.Msg.Operator.Status != userStatusInactive {
		t.Fatalf("status = %q, want %s", deactivateResp.Msg.Operator.Status, userStatusInactive)
	}

	_, err = client.DeactivateOperator(context.Background(), newDBAuthedRequest(superAdmin, publirasplatformv1.DeactivateOperatorRequest{
		PublicId: target.PublicID,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("second DeactivateOperator code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}

	// A deactivated operator keeps its row (and its audit trail); only the status
	// moves.
	stored := platformUserByPublicID(t, pg, target.PublicID)
	if stored.Status != userStatusInactive {
		t.Fatalf("stored status = %q, want %s", stored.Status, userStatusInactive)
	}
}

func TestDBOperatorStatusChangesRejectSelf(t *testing.T) {
	ts, pg, superAdmin := newDBIntegrationSuperAdminServer(t)
	client := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)

	if _, err := client.SuspendOperator(context.Background(), newDBAuthedRequest(superAdmin, publirasplatformv1.SuspendOperatorRequest{
		PublicId: superAdmin.PublicID,
	})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("SuspendOperator on self code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
	if _, err := client.DeactivateOperator(context.Background(), newDBAuthedRequest(superAdmin, publirasplatformv1.DeactivateOperatorRequest{
		PublicId: superAdmin.PublicID,
	})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("DeactivateOperator on self code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}

	stored := platformUserByPublicID(t, pg, superAdmin.PublicID)
	if stored.Status != userStatusActive {
		t.Fatalf("status = %q, want the refused changes to leave %s", stored.Status, userStatusActive)
	}
	if stored.CredentialsVersion != superAdmin.CredentialsVersion {
		t.Fatalf("credentials_version = %d, want it untouched at %d", stored.CredentialsVersion, superAdmin.CredentialsVersion)
	}
}

func TestDBOperatorNotFoundReturnsNotFound(t *testing.T) {
	ts, _, superAdmin := newDBIntegrationSuperAdminServer(t)
	client := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)

	_, err := client.GetOperator(context.Background(), newDBAuthedRequest(superAdmin, publirasplatformv1.GetOperatorRequest{
		PublicId: "MISSINGUSER1",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetOperator code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	_, err = client.SuspendOperator(context.Background(), newDBAuthedRequest(superAdmin, publirasplatformv1.SuspendOperatorRequest{
		PublicId: "MISSINGUSER1",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("SuspendOperator code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}
