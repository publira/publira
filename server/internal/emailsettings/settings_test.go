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

// savedServer is the server encryptedSMTPPassword was saved for.
var savedServer = SMTPSettings{Host: "smtp.example.com", Port: 587, Username: "mailer", Encryption: "starttls"}

func TestResolvePasswordForTestNilManagerEncryptedEnvelope(t *testing.T) {
	_, err := ResolvePasswordForTest(savedServer, savedServer, encryptedSMTPPassword, secretupdate.Unchanged, "", nil)
	if !errors.Is(err, ErrSecretManagerUnavailable) {
		t.Fatalf("ResolvePasswordForTest error = %v, want ErrSecretManagerUnavailable", err)
	}
}

// stubSecretManager opens every stored password as "saved-password".
type stubSecretManager struct{}

func (stubSecretManager) EncryptString(string) (string, error) { return encryptedSMTPPassword, nil }
func (stubSecretManager) DecryptString(string) (string, error) { return "saved-password", nil }

// The saved password goes only to the server it was saved for. A test that
// names another one has to state a password of its own, and a test that names
// no username sends none.
func TestResolvePasswordForTestSendsTheSavedPasswordOnlyToItsServer(t *testing.T) {
	with := func(change func(*SMTPSettings)) SMTPSettings {
		settings := savedServer
		change(&settings)
		return settings
	}
	for _, tc := range []struct {
		name     string
		settings SMTPSettings
		mode     secretupdate.Mode
		password string
		want     string
		field    string
		is       error
	}{
		{name: "the saved server", settings: savedServer, mode: secretupdate.Unchanged, want: "saved-password"},
		{name: "the saved server with no mode stated", settings: savedServer, mode: secretupdate.Unspecified, want: "saved-password"},
		{name: "the saved host in another case and padded", settings: with(func(s *SMTPSettings) { s.Host = " SMTP.Example.COM " }), mode: secretupdate.Unchanged, want: "saved-password"},
		{name: "another host", settings: with(func(s *SMTPSettings) { s.Host = "smtp.elsewhere.example" }), mode: secretupdate.Unchanged, field: FieldPassword, is: ErrServerChanged},
		{name: "another port", settings: with(func(s *SMTPSettings) { s.Port = 2525 }), mode: secretupdate.Unchanged, field: FieldPassword, is: ErrServerChanged},
		{name: "another username", settings: with(func(s *SMTPSettings) { s.Username = "someone-else" }), mode: secretupdate.Unchanged, field: FieldPassword, is: ErrServerChanged},
		{name: "no encryption", settings: with(func(s *SMTPSettings) { s.Encryption = "none" }), mode: secretupdate.Unspecified, field: FieldPassword, is: ErrServerChanged},
		{name: "no username", settings: with(func(s *SMTPSettings) { s.Username = "" }), mode: secretupdate.Unchanged, field: FieldUsername, is: ErrPasswordWithoutUsername},
		{name: "another host with a password of its own", settings: with(func(s *SMTPSettings) { s.Host = "smtp.elsewhere.example" }), mode: secretupdate.Replace, password: "its-own-password", want: "its-own-password"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ResolvePasswordForTest(tc.settings, savedServer, encryptedSMTPPassword, tc.mode, tc.password, stubSecretManager{})
			if tc.is == nil {
				if err != nil || got != tc.want {
					t.Fatalf("ResolvePasswordForTest = %q, %v; want %q", got, err, tc.want)
				}
				return
			}
			if got != "" || !errors.Is(err, tc.is) || fielderr.Field(err) != tc.field {
				t.Fatalf("ResolvePasswordForTest = %q, %v on %q; want %v on %q", got, err, fielderr.Field(err), tc.is, tc.field)
			}
		})
	}
}

// With no password saved there is nothing to keep from another server, so the
// test goes out with none and Validate decides whether it needs one.
func TestResolvePasswordForTestWithNothingSaved(t *testing.T) {
	elsewhere := savedServer
	elsewhere.Host = "smtp.elsewhere.example"
	if got, err := ResolvePasswordForTest(elsewhere, SMTPSettings{}, "", secretupdate.Unchanged, "", nil); got != "" || err != nil {
		t.Fatalf("ResolvePasswordForTest = %q, %v; want an empty password", got, err)
	}
}

func TestEncryptUpdatedPasswordRefusesABlankReplacementAsAPassword(t *testing.T) {
	_, _, err := EncryptUpdatedPassword(encryptedSMTPPassword, secretupdate.Replace, "   ", nil)
	if !errors.Is(err, ErrPasswordRequired) {
		t.Fatalf("EncryptUpdatedPassword(replace, blank) error = %v, want ErrPasswordRequired", err)
	}
	_, err = ResolvePasswordForTest(savedServer, savedServer, encryptedSMTPPassword, secretupdate.Replace, "", nil)
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

// No stored password and a cleared one are both an empty password, which
// Validate then judges against the username.
func TestAnAbsentPasswordResolvesToAnEmptyOne(t *testing.T) {
	if password, err := DecryptPassword("", nil); password != "" || err != nil {
		t.Fatalf("DecryptPassword(empty) = %q, %v; want an empty password", password, err)
	}
	if password, err := ResolvePasswordForTest(savedServer, savedServer, encryptedSMTPPassword, secretupdate.Clear, "", nil); password != "" || err != nil {
		t.Fatalf("ResolvePasswordForTest(clear) = %q, %v; want an empty password", password, err)
	}
}

func TestWithTenantFromNameFillsOnlyAnEmptySenderName(t *testing.T) {
	cases := []struct {
		name     string
		fromName string
		want     string
	}{
		{name: "empty", fromName: "", want: "Weekly Comics"},
		{name: "blank", fromName: "   ", want: "Weekly Comics"},
		{name: "saved", fromName: "Editorial Desk", want: "Editorial Desk"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := WithTenantFromName(SMTPSettings{FromName: tc.fromName}, " Weekly Comics ")
			if got.FromName != tc.want {
				t.Fatalf("FromName = %q, want %q", got.FromName, tc.want)
			}
		})
	}
}
