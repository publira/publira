package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/loginguard"
	"github.com/publira/publira/server/internal/ratelimit"
)

// openSignInCounters opens the counters the sign-in limit is charged against
// on every server. Tests replace it, having no Redis to reach.
var openSignInCounters = ratelimit.OpenShared

var tenantUnlockSignInCommand = command{
	name:    "unlock-sign-in",
	summary: "Lift the sign-in limit of one address on a tenant's site and tenant console",
	setup:   setupTenantUnlockSignIn,
}

var operatorUnlockSignInCommand = command{
	name:    "unlock-sign-in",
	summary: "Lift the sign-in limit of one address on the Platform Console",
	setup:   setupOperatorUnlockSignIn,
}

func setupTenantUnlockSignIn(f *commandFlags) func(context.Context, *commandEnv) error {
	ref := tenantFlag(f)
	email := signInEmailFlag(f)
	return func(ctx context.Context, env *commandEnv) error {
		address, err := signInAddress(*email)
		if err != nil {
			return err
		}
		var tenant dbmodels.Tenant
		if err := env.inTenant(ctx, *ref, func(_ *sql.Tx, found dbmodels.Tenant) error {
			tenant = found
			return nil
		}); err != nil {
			return err
		}
		if err := unlockSignIn(ctx, tenant.ID.String(), address); err != nil {
			return err
		}
		_, err = fmt.Fprintf(env.stdout, "Lifted the sign-in limit of %s on %s\n", address, tenant.PublicID)
		return err
	}
}

func setupOperatorUnlockSignIn(f *commandFlags) func(context.Context, *commandEnv) error {
	email := signInEmailFlag(f)
	return func(ctx context.Context, env *commandEnv) error {
		address, err := signInAddress(*email)
		if err != nil {
			return err
		}
		if err := unlockSignIn(ctx, loginguard.PlatformScope, address); err != nil {
			return err
		}
		_, err = fmt.Fprintf(env.stdout, "Lifted the sign-in limit of %s on the Platform Console\n", address)
		return err
	}
}

// signInEmailFlag is the address whose limit is lifted. It is the address as a
// sign-in types it, and nothing looks it up: the limit is kept by address
// whether or not an account holds one, so lifting it for an address with no
// account is harmless, and saying so would be no help to anyone.
func signInEmailFlag(f *commandFlags) *string {
	return f.String("email", "", "the address, as it is typed to sign in")
}

func signInAddress(email string) (string, error) {
	address := strings.TrimSpace(email)
	if address == "" {
		return "", errors.New("--email is required")
	}
	return address, nil
}

// unlockSignIn lifts every allowance of address within scope on the counters
// every server shares.
func unlockSignIn(ctx context.Context, scope, address string) error {
	limiter, closeCounters, err := openSignInCounters()
	if errors.Is(err, ratelimit.ErrNoSharedCounters) {
		return fmt.Errorf("%w; restarting publira server clears what they hold", err)
	}
	if err != nil {
		return fmt.Errorf("open the sign-in counters: %w", err)
	}
	defer closeCounters() //nolint:errcheck
	if err := loginguard.Lift(ctx, limiter, scope, address); err != nil {
		return fmt.Errorf("lift the sign-in limit: %w", err)
	}
	return nil
}
