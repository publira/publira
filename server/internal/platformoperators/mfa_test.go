package platformoperators

import (
	"errors"
	"testing"

	"github.com/publira/publira/server/internal/fielderr"
)

func TestResetMFAParamsValidateNamesTheEmailField(t *testing.T) {
	if got := fielderr.Field(ResetMFAParams{Email: "nobody"}.Validate()); got != FieldEmail {
		t.Fatalf("field = %q, want %q", got, FieldEmail)
	}
	if err := (ResetMFAParams{UserPublicID: " PLATRESET01 "}).Validate(); err != nil {
		t.Fatalf("Validate a public ID = %v", err)
	}
	if err := (ResetMFAParams{UserPublicID: "  "}).Validate(); !errors.Is(err, ErrUserOrEmailRequired) {
		t.Fatalf("Validate a blank public ID = %v, want %v", err, ErrUserOrEmailRequired)
	}
}
