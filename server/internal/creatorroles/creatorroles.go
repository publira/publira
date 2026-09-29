// Package creatorroles holds the creator-role vocabulary a tenant starts with.
//
// A credit on a series names a role of the tenant, and the column is NOT NULL,
// so a tenant with no roles is a tenant that cannot credit anybody. That is why
// the vocabulary is created with the tenant rather than left for the console to
// fill in, which is where it differs from genres: a series carries no genre
// until somebody assigns one, and it carries creators from the day it is
// written.
package creatorroles

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/publicid"
)

// Default is one entry of the starting vocabulary: the name it is created
// under, and where it sits in the priority order that puts the leading role
// first on every credit list.
type Default struct {
	Name            string
	DisplayPriority int32
}

// Defaults is what a tenant is created with, so a console opened for the first
// time offers the roles a serialized work is actually credited with instead of
// an empty list. db/seeds/creator_roles.sql writes the same four for the
// tenants a seed creates, which do not come through here.
//
// The names are English because that is the language this repository writes its
// own copy in; they are ordinary rows, and a tenant publishing in another
// language renames them once. Nothing translates them on read — a role name is
// tenant data, the way a genre name is.
var Defaults = []Default{
	{Name: "Original Author", DisplayPriority: 1},
	{Name: "Artist", DisplayPriority: 2},
	{Name: "Writer", DisplayPriority: 3},
	{Name: "Supervisor", DisplayPriority: 4},
}

// CreateDefaults writes the starting vocabulary for one tenant. It takes the
// transaction the tenant itself was created in, so a tenant either reaches the
// database with its roles or does not reach it at all.
func CreateDefaults(ctx context.Context, tx *sql.Tx, tenantID uuid.UUID) error {
	queries := dbmodels.New(tx)
	for _, role := range Defaults {
		roleID, err := uuid.NewV7()
		if err != nil {
			return err
		}
		if _, err := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.CreatorRole, error) {
			return queries.CreateCreatorRole(ctx, dbmodels.CreateCreatorRoleParams{
				ID:              roleID,
				TenantID:        tenantID,
				PublicID:        publicID,
				Name:            role.Name,
				DisplayPriority: role.DisplayPriority,
			})
		}); err != nil {
			return fmt.Errorf("create default creator role %q: %w", role.Name, err)
		}
	}
	return nil
}
