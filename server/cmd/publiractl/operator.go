package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/platformoperators"
)

var operatorGroup = commandGroup{
	name:    "operator",
	summary: "Recover a Platform Console operator's account where no operator can sign in",
	commands: []command{
		{name: "reset-mfa", summary: "Remove an operator's two-step verification, for one who lost the authenticator and every recovery code", setup: setupOperatorResetMFA},
	},
}

// operatorError names the flag behind what platformoperators refused.
func operatorError(err error) error {
	switch {
	case fielderr.Field(err) == platformoperators.FieldEmail:
		return fmt.Errorf("--email: %w", err)
	case errors.Is(err, platformoperators.ErrUserOrEmailRequired), errors.Is(err, platformoperators.ErrUserAndEmailBothSet):
		return fmt.Errorf("--user or --email: %w", err)
	}
	return err
}

func setupOperatorResetMFA(f *commandFlags) func(context.Context, *commandEnv) error {
	var params platformoperators.ResetMFAParams
	f.StringVar(&params.UserPublicID, "user", "", "the operator, by public ID")
	f.StringVar(&params.Email, "email", "", "the operator, by email address")
	return func(ctx context.Context, env *commandEnv) error {
		if err := params.Validate(); err != nil {
			return operatorError(err)
		}
		db, err := env.openPlatformDB()
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin: %w", err)
		}
		defer tx.Rollback() //nolint:errcheck

		operator, err := platformoperators.ResetMFA(ctx, tx, env.logger, auditlog.SystemPlatformActor, params)
		if err != nil {
			return operatorError(err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit: %w", err)
		}
		_, err = fmt.Fprintf(env.stdout, "Removed two-step verification from %s (%s)\n", operator.Email, operator.PublicID)
		return err
	}
}
