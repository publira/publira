package tenantmembers

import (
	"errors"
	"testing"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/fielderr"
)

func TestValidateNamesTheRefusedField(t *testing.T) {
	for _, tc := range []struct {
		name  string
		err   error
		field string
		is    error
	}{
		{name: "add with a malformed email", err: AddParams{Email: "nobody", Role: auth.RoleTenantAdmin}.Validate(), field: FieldEmail, is: ErrInvalidEmail},
		{name: "add with an unknown role", err: AddParams{UserPublicID: "USER1", Role: "owner"}.Validate(), field: FieldRole, is: ErrInvalidRole},
		{name: "update-role with no user", err: UpdateRoleParams{Role: auth.RoleTenantAdmin}.Validate(), field: FieldUserPublicID, is: ErrUserPublicIDRequired},
		{name: "update-role with an unknown role", err: UpdateRoleParams{UserPublicID: "USER1", Role: "owner"}.Validate(), field: FieldRole, is: ErrInvalidRole},
		{name: "remove with no user", err: RemoveParams{UserPublicID: "  "}.Validate(), field: FieldUserPublicID, is: ErrUserPublicIDRequired},
		{name: "invite with no email", err: InviteParams{}.Validate(), field: FieldEmail, is: ErrEmailRequired},
		{name: "account with no name", err: AccountParams{Email: "a@example.com", Password: "secret", Role: auth.RoleTenantAdmin}.Validate(), field: FieldName, is: ErrNameRequired},
		{name: "account with no password", err: AccountParams{Email: "a@example.com", Name: "A", Role: auth.RoleTenantAdmin}.Validate(), field: FieldPassword, is: ErrPasswordRequired},
		{name: "account with a malformed email", err: AccountParams{Email: "nobody", Name: "A", Password: "secret", Role: auth.RoleTenantAdmin}.Validate(), field: FieldEmail, is: ErrInvalidEmail},
		{name: "a malformed invitation ID", err: func() error { _, err := ParseInvitationID("42"); return err }(), field: FieldInvitationID, is: ErrInvalidInvitationID},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := fielderr.Field(tc.err); got != tc.field {
				t.Fatalf("field = %q, want %q (err = %v)", got, tc.field, tc.err)
			}
			if !errors.Is(tc.err, tc.is) {
				t.Fatalf("err = %v, want %v", tc.err, tc.is)
			}
		})
	}
}

// Naming the user twice or not at all is not about one field.
func TestAddValidateRefusesTwoOrNoUsers(t *testing.T) {
	if err := (AddParams{Role: auth.RoleTenantAdmin}).Validate(); !errors.Is(err, ErrUserOrEmailRequired) {
		t.Fatalf("no user: err = %v, want ErrUserOrEmailRequired", err)
	}
	if err := (AddParams{UserPublicID: "USER1", Email: "a@example.com", Role: auth.RoleTenantAdmin}).Validate(); !errors.Is(err, ErrUserAndEmailBothSet) {
		t.Fatalf("both: err = %v, want ErrUserAndEmailBothSet", err)
	}
}
