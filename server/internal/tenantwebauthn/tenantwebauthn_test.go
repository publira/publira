package tenantwebauthn

import (
	"database/sql"
	"errors"
	"testing"
	"time"

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
		{name: "shares the storefront's host under the default console host", domain: "comics.example", want: "comics.example"},
		{name: "shares the storefront's host under a saved subdomain", domain: "comics.example", adminDomain: sql.NullString{String: "staff.comics.example", Valid: true}, want: "comics.example"},
		{name: "keeps a console outside the storefront's domain to itself", domain: "comics.example", adminDomain: sql.NullString{String: "console.publisher.example", Valid: true}, want: "console.publisher.example"},
		{name: "does not mistake a sibling for a subdomain", domain: "comics.example", adminDomain: sql.NullString{String: "admincomics.example", Valid: true}, want: "admincomics.example"},
		{name: "leaves the port out", domain: "comics.localhost:3180", want: "comics.localhost"},
		{name: "keeps a console to itself under a storefront host that is no registrable domain", domain: "localhost:3080", want: "admin.localhost"},
		{name: "keeps a console to itself under a storefront on a public suffix", domain: "github.io", adminDomain: sql.NullString{String: "admin.github.io", Valid: true}, want: "admin.github.io"},
		{name: "folds the case of a saved host", domain: "Comics.Example", want: "comics.example"},
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

func TestRelyingPartiesAcceptTheirOwnOriginAlone(t *testing.T) {
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
	if console.ID != site.ID {
		t.Fatalf("RP IDs = %q and %q, want one shared by the console under the storefront", console.ID, site.ID)
	}
	if console.Origin != "https://admin.comics.example" || site.Origin != "https://comics.example" {
		t.Fatalf("origins = %q and %q", console.Origin, site.Origin)
	}

	authenticator := webauthntest.New(t, console.Origin)
	user := User{Handle: UserHandle("USER00000001"), Name: "staff@comics.example", DisplayName: "Staff"}
	row := register(t, console, authenticator, user)
	user.Credentials = []dbmodels.UserWebauthnCredential{row}

	// The same credential, asserted on the storefront, is the console's to
	// refuse even though the RP ID is the same.
	authenticator.Origin = site.Origin
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
