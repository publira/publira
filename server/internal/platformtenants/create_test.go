package platformtenants

import (
	"database/sql"
	"errors"
	"slices"
	"testing"

	"github.com/publira/publira/server/internal/locale"
)

func validParams() CreateParams {
	return CreateParams{
		Name:          "Example Comics",
		Domain:        "example.com",
		DefaultLocale: "en",
	}
}

func TestValidateNormalizesTheRequest(t *testing.T) {
	c, err := CreateParams{
		Name:               "  Example Comics  ",
		Domain:             " example.com ",
		AdminDomain:        " admin.example.com ",
		DefaultLocale:      " en ",
		InitialAdminEmails: []string{" Owner@Example.com ", "", "  ", "owner@example.com", "editor@example.com"},
	}.Validate()
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if c.name != "Example Comics" || c.domain != "example.com" || c.defaultLocale != "en" {
		t.Fatalf("creation = %+v, want the values trimmed", c)
	}
	if want := (sql.NullString{String: "admin.example.com", Valid: true}); c.adminDomain != want {
		t.Fatalf("admin domain = %+v, want %+v", c.adminDomain, want)
	}
	if got, want := c.InitialAdminEmails(), []string{"owner@example.com", "editor@example.com"}; !slices.Equal(got, want) {
		t.Fatalf("initial admin emails = %q, want %q", got, want)
	}
}

func TestValidateLeavesABlankAdminDomainUnset(t *testing.T) {
	p := validParams()
	p.AdminDomain = "   "
	c, err := p.Validate()
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if c.adminDomain.Valid {
		t.Fatalf("admin domain = %+v, want NULL", c.adminDomain)
	}
}

func TestValidateRefusesAField(t *testing.T) {
	for _, tc := range []struct {
		name   string
		modify func(*CreateParams)
		field  string
		err    error
	}{
		{name: "blank name", modify: func(p *CreateParams) { p.Name = "  " }, field: FieldName, err: ErrNameRequired},
		{name: "blank domain", modify: func(p *CreateParams) { p.Domain = "" }, field: FieldDomain, err: ErrDomainRequired},
		{name: "missing locale", modify: func(p *CreateParams) { p.DefaultLocale = "" }, field: FieldDefaultLocale, err: locale.ErrInvalid},
		{name: "unsupported locale", modify: func(p *CreateParams) { p.DefaultLocale = "en-US" }, field: FieldDefaultLocale, err: locale.ErrInvalid},
		{
			name:   "malformed admin email",
			modify: func(p *CreateParams) { p.InitialAdminEmails = []string{"owner@example.com", "not-an-address"} },
			field:  FieldInitialAdminEmails,
			err:    ErrInvalidInitialAdminEmails,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := validParams()
			tc.modify(&p)
			_, err := p.Validate()
			var invalid *InvalidError
			if !errors.As(err, &invalid) {
				t.Fatalf("err = %v, want *InvalidError", err)
			}
			if invalid.Field != tc.field {
				t.Fatalf("field = %q, want %q", invalid.Field, tc.field)
			}
			if !errors.Is(err, tc.err) {
				t.Fatalf("err = %v, want %v", err, tc.err)
			}
		})
	}
}
