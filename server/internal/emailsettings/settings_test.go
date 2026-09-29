package emailsettings

import (
	"errors"
	"testing"

	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/secretupdate"
)

const encryptedSMTPPassword = "enc:v1:k1:nonce:ciphertext"

func TestDecryptPasswordNilManagerEncryptedEnvelope(t *testing.T) {
	_, err := DecryptPassword(encryptedSMTPPassword, nil)
	if !errors.Is(err, ErrSecretManagerUnavailable) {
		t.Fatalf("DecryptPassword error = %v, want ErrSecretManagerUnavailable", err)
	}
}

func TestResolvePasswordForTestNilManagerEncryptedEnvelope(t *testing.T) {
	_, err := ResolvePasswordForTest(encryptedSMTPPassword, secretupdate.Unchanged, "", nil)
	if !errors.Is(err, ErrSecretManagerUnavailable) {
		t.Fatalf("ResolvePasswordForTest error = %v, want ErrSecretManagerUnavailable", err)
	}
}

func TestEncryptUpdatedPasswordRefusesABlankReplacementAsAPassword(t *testing.T) {
	_, _, err := EncryptUpdatedPassword(encryptedSMTPPassword, secretupdate.Replace, "   ", nil)
	if !errors.Is(err, ErrPasswordRequired) {
		t.Fatalf("EncryptUpdatedPassword(replace, blank) error = %v, want ErrPasswordRequired", err)
	}
	_, err = ResolvePasswordForTest(encryptedSMTPPassword, secretupdate.Replace, "", nil)
	if !errors.Is(err, ErrPasswordRequired) {
		t.Fatalf("ResolvePasswordForTest(replace, blank) error = %v, want ErrPasswordRequired", err)
	}
}

func TestValidateTakesNoUsernameForARelayWithoutCredentials(t *testing.T) {
	base := SMTPSettings{Host: "smtp.example.com", Port: 25, Encryption: "none", FromAddress: "no-reply@example.com"}
	with := func(username, password string) SMTPSettings {
		settings := base
		settings.Username, settings.Password = username, password
		return settings
	}

	for _, tc := range []struct {
		name            string
		settings        SMTPSettings
		requirePassword bool
		field           string
		is              error
	}{
		{name: "no username and no password", settings: with("", ""), requirePassword: true},
		{name: "a blank username", settings: with("   ", ""), requirePassword: true},
		{name: "a username and a password", settings: with("mailer", "password"), requirePassword: true},
		{name: "a username whose password is kept", settings: with("mailer", ""), requirePassword: false},
		{name: "a username with no password", settings: with("mailer", ""), requirePassword: true, field: FieldPassword, is: ErrPasswordRequired},
		{name: "a password with no username", settings: with("", "password"), requirePassword: false, field: FieldUsername, is: ErrPasswordWithoutUsername},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := Validate(tc.settings, tc.requirePassword)
			if tc.is == nil {
				if err != nil {
					t.Fatalf("Validate = %v, want nil", err)
				}
				return
			}
			if !errors.Is(err, tc.is) || fielderr.Field(err) != tc.field {
				t.Fatalf("Validate = %v on %q, want %v on %q", err, fielderr.Field(err), tc.is, tc.field)
			}
		})
	}
}

func TestRequireUsername(t *testing.T) {
	err := RequireUsername(SMTPSettings{Username: "  "})
	if !errors.Is(err, ErrUsernameRequired) || fielderr.Field(err) != FieldUsername {
		t.Fatalf("RequireUsername(blank) = %v, want ErrUsernameRequired on username", err)
	}
	if err := RequireUsername(SMTPSettings{Username: "mailer"}); err != nil {
		t.Fatalf("RequireUsername(mailer) = %v, want nil", err)
	}
}

// No stored password and a cleared one are both an empty password, which
// Validate then judges against the username.
func TestAnAbsentPasswordResolvesToAnEmptyOne(t *testing.T) {
	if password, err := DecryptPassword("", nil); password != "" || err != nil {
		t.Fatalf("DecryptPassword(empty) = %q, %v; want an empty password", password, err)
	}
	if password, err := ResolvePasswordForTest(encryptedSMTPPassword, secretupdate.Clear, "", nil); password != "" || err != nil {
		t.Fatalf("ResolvePasswordForTest(clear) = %q, %v; want an empty password", password, err)
	}
}
