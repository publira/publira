package tenantwebauthn

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/tenantorigin"
	"github.com/publira/publira/server/internal/tenantwebauthn/webauthntest"
)

func TestAdminConsoleRPID(t *testing.T) {
	tests := []struct {
		name        string
		domain      string
		adminDomain sql.NullString
		want        string
	}{
		{name: "keeps the default console host to itself", domain: "comics.example", want: "admin.comics.example"},
		{name: "keeps a saved subdomain of the storefront to itself", domain: "comics.example", adminDomain: sql.NullString{String: "staff.comics.example", Valid: true}, want: "staff.comics.example"},
		{name: "keeps a console outside the storefront's domain to itself", domain: "comics.example", adminDomain: sql.NullString{String: "console.publisher.example", Valid: true}, want: "console.publisher.example"},
		{name: "keeps a console on the storefront's own host to itself", domain: "comics.example", adminDomain: sql.NullString{String: "comics.example", Valid: true}, want: "comics.example"},
		{name: "leaves the port out", domain: "comics.localhost:3180", want: "admin.comics.localhost"},
		{name: "keeps a console to itself under a storefront host that is no registrable domain", domain: "localhost:3080", want: "admin.localhost"},
		{name: "folds the case of a saved host", domain: "Comics.Example", want: "admin.comics.example"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv(tenantorigin.SchemeEnv, "")
			got, err := AdminConsoleRPID(dbmodels.Tenant{Domain: tt.domain, AdminDomain: tt.adminDomain})
			if err != nil {
				t.Fatalf("AdminConsoleRPID: %v", err)
			}
			if got != tt.want {
				t.Fatalf("AdminConsoleRPID = %q, want %q", got, tt.want)
			}
		})
	}
}

// A console served under the storefront's domain is still a relying party of
// its own, so a passkey registered on the storefront answers the console in
// no way: not through the storefront's RP ID, and not from the console's
// origin either.
func TestRelyingPartiesShareNoCredentials(t *testing.T) {
	t.Setenv(tenantorigin.SchemeEnv, "")
	tenant := dbmodels.Tenant{Domain: "comics.example", Name: "Comics"}

	console, err := AdminConsole(tenant)
	if err != nil {
		t.Fatalf("AdminConsole: %v", err)
	}
	site, err := Site(tenant)
	if err != nil {
		t.Fatalf("Site: %v", err)
	}
	if console.ID != "admin.comics.example" || site.ID != "comics.example" {
		t.Fatalf("RP IDs = %q and %q, want each surface's own host", console.ID, site.ID)
	}
	if console.Origin != "https://admin.comics.example" || site.Origin != "https://comics.example" {
		t.Fatalf("origins = %q and %q", console.Origin, site.Origin)
	}

	user := User{Handle: UserHandle("USER00000001"), Name: "staff@comics.example", DisplayName: "Staff"}
	storefront := webauthntest.New(t, site.Origin)
	user.Credentials = []dbmodels.UserWebauthnCredential{register(t, site, storefront, user)}

	for _, origin := range []string{site.Origin, console.Origin} {
		storefront.Origin = origin
		options, ceremony, err := console.BeginAuthentication(user)
		if err != nil {
			t.Fatalf("BeginAuthentication: %v", err)
		}
		parsed, _, err := ParseAssertion([]byte(storefront.Assert(t, string(options))))
		if err != nil {
			t.Fatalf("ParseAssertion: %v", err)
		}
		if _, err := console.FinishAuthentication(user, ceremony, parsed); err == nil {
			t.Fatalf("the console accepted a storefront passkey asserted on %s", origin)
		}
	}
}

func TestRelyingPartiesAcceptTheirOwnOriginAlone(t *testing.T) {
	t.Setenv(tenantorigin.SchemeEnv, "")
	console, err := AdminConsole(dbmodels.Tenant{Domain: "comics.example", Name: "Comics"})
	if err != nil {
		t.Fatalf("AdminConsole: %v", err)
	}

	authenticator := webauthntest.New(t, console.Origin)
	user := User{Handle: UserHandle("USER00000001"), Name: "staff@comics.example", DisplayName: "Staff"}
	row := register(t, console, authenticator, user)
	user.Credentials = []dbmodels.UserWebauthnCredential{row}

	// The console's own credential, asserted on the storefront, is the
	// console's to refuse.
	authenticator.Origin = "https://comics.example"
	options, ceremony, err := console.BeginAuthentication(user)
	if err != nil {
		t.Fatalf("BeginAuthentication: %v", err)
	}
	parsed, _, err := ParseAssertion([]byte(authenticator.Assert(t, string(options))))
	if err != nil {
		t.Fatalf("ParseAssertion: %v", err)
	}
	if _, err := console.FinishAuthentication(user, ceremony, parsed); err == nil {
		t.Fatal("the console accepted an assertion made on the storefront")
	}

	authenticator.Origin = console.Origin
	options, ceremony, err = console.BeginAuthentication(user)
	if err != nil {
		t.Fatalf("BeginAuthentication: %v", err)
	}
	parsed, challenge, err := ParseAssertion([]byte(authenticator.Assert(t, string(options))))
	if err != nil {
		t.Fatalf("ParseAssertion: %v", err)
	}
	if challenge != ceremony.Challenge {
		t.Fatalf("parsed challenge = %q, want %q", challenge, ceremony.Challenge)
	}
	credential, err := console.FinishAuthentication(user, ceremony, parsed)
	if err != nil {
		t.Fatalf("FinishAuthentication: %v", err)
	}
	if credential.Authenticator.SignCount != authenticator.SignCount {
		t.Fatalf("sign count = %d, want %d", credential.Authenticator.SignCount, authenticator.SignCount)
	}
}

func TestFinishAuthenticationRefusesACounterThatWentBackwards(t *testing.T) {
	t.Setenv(tenantorigin.SchemeEnv, "")
	console, err := AdminConsole(dbmodels.Tenant{Domain: "comics.example"})
	if err != nil {
		t.Fatalf("AdminConsole: %v", err)
	}
	authenticator := webauthntest.New(t, console.Origin)
	user := User{Handle: UserHandle("USER00000001"), Name: "staff@comics.example", DisplayName: "Staff"}
	row := register(t, console, authenticator, user)
	row.SignCount = 10
	user.Credentials = []dbmodels.UserWebauthnCredential{row}

	authenticator.SignCount = 4
	options, ceremony, err := console.BeginAuthentication(user)
	if err != nil {
		t.Fatalf("BeginAuthentication: %v", err)
	}
	parsed, _, err := ParseAssertion([]byte(authenticator.Assert(t, string(options))))
	if err != nil {
		t.Fatalf("ParseAssertion: %v", err)
	}
	if _, err := console.FinishAuthentication(user, ceremony, parsed); !errors.Is(err, ErrSignCountRegressed) {
		t.Fatalf("FinishAuthentication = %v, want %v", err, ErrSignCountRegressed)
	}
}

func TestFinishRefusesACeremonyOfAnotherRelyingPartyOrPastItsExpiry(t *testing.T) {
	t.Setenv(tenantorigin.SchemeEnv, "")
	console, err := AdminConsole(dbmodels.Tenant{Domain: "comics.example", AdminDomain: sql.NullString{String: "console.publisher.example", Valid: true}})
	if err != nil {
		t.Fatalf("AdminConsole: %v", err)
	}
	authenticator := webauthntest.New(t, console.Origin)
	user := User{Handle: UserHandle("USER00000001"), Name: "staff@comics.example", DisplayName: "Staff"}

	options, ceremony, err := console.BeginRegistration(user)
	if err != nil {
		t.Fatalf("BeginRegistration: %v", err)
	}
	parsed, _, err := ParseRegistration([]byte(authenticator.Register(t, string(options))))
	if err != nil {
		t.Fatalf("ParseRegistration: %v", err)
	}

	foreign := ceremony
	foreign.RPID = "comics.example"
	if _, err := console.FinishRegistration(user, foreign, parsed); !errors.Is(err, ErrCeremonyMismatch) {
		t.Fatalf("FinishRegistration with another RP ID = %v, want %v", err, ErrCeremonyMismatch)
	}
	expired := ceremony
	expired.ExpiresAt = time.Now().Add(-time.Second)
	if _, err := console.FinishRegistration(user, expired, parsed); !errors.Is(err, ErrCeremonyMismatch) {
		t.Fatalf("FinishRegistration past its expiry = %v, want %v", err, ErrCeremonyMismatch)
	}
}

func TestFinishRegistrationRequiresUserVerification(t *testing.T) {
	t.Setenv(tenantorigin.SchemeEnv, "")
	console, err := AdminConsole(dbmodels.Tenant{Domain: "comics.example"})
	if err != nil {
		t.Fatalf("AdminConsole: %v", err)
	}
	authenticator := webauthntest.New(t, console.Origin)
	authenticator.UserVerified = false
	user := User{Handle: UserHandle("USER00000001"), Name: "staff@comics.example", DisplayName: "Staff"}

	options, ceremony, err := console.BeginRegistration(user)
	if err != nil {
		t.Fatalf("BeginRegistration: %v", err)
	}
	parsed, _, err := ParseRegistration([]byte(authenticator.Register(t, string(options))))
	if err != nil {
		t.Fatalf("ParseRegistration: %v", err)
	}
	if _, err := console.FinishRegistration(user, ceremony, parsed); err == nil {
		t.Fatal("FinishRegistration accepted a credential created without user verification")
	}
}

// The storefront signs a reader in with a passkey alone, so it asks for a
// discoverable credential, where the console, asking for a second factor after
// a password, only prefers one.
func TestSiteRequiresAResidentKey(t *testing.T) {
	t.Setenv(tenantorigin.SchemeEnv, "")
	tenant := dbmodels.Tenant{Domain: "comics.example"}
	user := User{Handle: UserHandle("USER00000001"), Name: "reader@comics.example", DisplayName: "Reader"}

	for _, tt := range []struct {
		name        string
		rp          func(dbmodels.Tenant) (*RelyingParty, error)
		residentKey string
		require     bool
	}{
		{name: "storefront", rp: Site, residentKey: "required", require: true},
		{name: "console", rp: AdminConsole, residentKey: "preferred", require: false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			rp, err := tt.rp(tenant)
			if err != nil {
				t.Fatalf("relying party: %v", err)
			}
			options, _, err := rp.BeginRegistration(user)
			if err != nil {
				t.Fatalf("BeginRegistration: %v", err)
			}
			var creation struct {
				AuthenticatorSelection struct {
					ResidentKey        string `json:"residentKey"`
					RequireResidentKey bool   `json:"requireResidentKey"`
					UserVerification   string `json:"userVerification"`
				} `json:"authenticatorSelection"`
			}
			if err := json.Unmarshal(options, &creation); err != nil {
				t.Fatalf("read creation options: %v", err)
			}
			selection := creation.AuthenticatorSelection
			if selection.ResidentKey != tt.residentKey || selection.RequireResidentKey != tt.require || selection.UserVerification != "required" {
				t.Fatalf("authenticatorSelection = %+v, want residentKey %q, requireResidentKey %v, userVerification required", selection, tt.residentKey, tt.require)
			}
		})
	}
}

// A sign-in that names no account allows no credential in particular, and the
// account the authenticator's credential names is the one it signs in to, so
// long as the user handle the authenticator returns is that account's.
func TestFinishDiscoverableAuthenticationNamesTheAccountByItsCredential(t *testing.T) {
	t.Setenv(tenantorigin.SchemeEnv, "")
	site, err := Site(dbmodels.Tenant{Domain: "comics.example"})
	if err != nil {
		t.Fatalf("Site: %v", err)
	}
	authenticator := webauthntest.New(t, site.Origin)
	user := User{Handle: UserHandle("USER00000001"), Name: "reader@comics.example", DisplayName: "Reader"}
	user.Credentials = []dbmodels.UserWebauthnCredential{register(t, site, authenticator, user)}

	begin := func() (*protocol.ParsedCredentialAssertionData, Ceremony) {
		t.Helper()
		options, ceremony, err := site.BeginDiscoverableAuthentication()
		if err != nil {
			t.Fatalf("BeginDiscoverableAuthentication: %v", err)
		}
		var request struct {
			AllowCredentials []any  `json:"allowCredentials"`
			RPID             string `json:"rpId"`
			UserVerification string `json:"userVerification"`
		}
		if err := json.Unmarshal(options, &request); err != nil {
			t.Fatalf("read request options: %v", err)
		}
		if len(request.AllowCredentials) != 0 || request.RPID != site.ID || request.UserVerification != "required" {
			t.Fatalf("request options = %+v, want no credential named, the storefront's RP ID, and user verification", request)
		}
		parsed, _, err := ParseAssertion([]byte(authenticator.Assert(t, string(options))))
		if err != nil {
			t.Fatalf("ParseAssertion: %v", err)
		}
		return parsed, ceremony
	}

	parsed, ceremony := begin()
	var handed []byte
	credential, err := site.FinishDiscoverableAuthentication(ceremony, parsed, func(credentialID, userHandle []byte) (User, error) {
		handed = userHandle
		if !bytes.Equal(credentialID, authenticator.CredentialID) {
			return User{}, errors.New("unknown credential")
		}
		return user, nil
	})
	if err != nil {
		t.Fatalf("FinishDiscoverableAuthentication: %v", err)
	}
	if !bytes.Equal(credential.ID, authenticator.CredentialID) || !bytes.Equal(handed, user.Handle) {
		t.Fatalf("credential %x for handle %q, want %x for %q", credential.ID, handed, authenticator.CredentialID, user.Handle)
	}

	// An account the lookup answers for the credential that is not the one the
	// handle names is refused.
	parsed, ceremony = begin()
	other := user
	other.Handle = UserHandle("USER00000002")
	if _, err := site.FinishDiscoverableAuthentication(ceremony, parsed, func([]byte, []byte) (User, error) {
		return other, nil
	}); err == nil {
		t.Fatal("FinishDiscoverableAuthentication accepted a user handle of another account")
	}

	// A credential the lookup does not know is refused.
	parsed, ceremony = begin()
	if _, err := site.FinishDiscoverableAuthentication(ceremony, parsed, func([]byte, []byte) (User, error) {
		return User{}, errors.New("unknown credential")
	}); err == nil {
		t.Fatal("FinishDiscoverableAuthentication accepted a credential the lookup did not know")
	}
}

// register runs a whole registration and answers the row it would store.
func register(t *testing.T, rp *RelyingParty, authenticator *webauthntest.Authenticator, user User) dbmodels.UserWebauthnCredential {
	t.Helper()

	options, ceremony, err := rp.BeginRegistration(user)
	if err != nil {
		t.Fatalf("BeginRegistration: %v", err)
	}
	parsed, challenge, err := ParseRegistration([]byte(authenticator.Register(t, string(options))))
	if err != nil {
		t.Fatalf("ParseRegistration: %v", err)
	}
	if challenge != ceremony.Challenge {
		t.Fatalf("parsed challenge = %q, want %q", challenge, ceremony.Challenge)
	}
	credential, err := rp.FinishRegistration(user, ceremony, parsed)
	if err != nil {
		t.Fatalf("FinishRegistration: %v", err)
	}
	if AAGUID(credential) != uuid.UUID(webauthntest.AAGUID) {
		t.Fatalf("AAGUID = %s, want %s", AAGUID(credential), uuid.UUID(webauthntest.AAGUID))
	}
	return dbmodels.UserWebauthnCredential{
		RpID:           rp.ID,
		CredentialID:   credential.ID,
		PublicKey:      credential.PublicKey,
		SignCount:      int64(credential.Authenticator.SignCount),
		Aaguid:         AAGUID(credential),
		Transports:     Transports(credential),
		BackupEligible: credential.Flags.BackupEligible,
		BackedUp:       credential.Flags.BackupState,
	}
}
