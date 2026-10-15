package dbtest

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
	"github.com/publira/publira/server/internal/usericon"
)

// Staff deleting a preset lock it and then clear the accounts showing it,
// while a reader picking it locks their account and then, through the foreign
// key, the preset. The two never wait on each other in a cycle: the clear
// reaches only accounts whose committed row shows the preset, and a pick of the
// preset an account already shows leaves the key unchanged, which PostgreSQL
// does not check against the preset at all.
func TestPickingAPresetWhileItIsDeletedDoesNotDeadlock(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	for i, tc := range []struct {
		name string
		// shows is whether the reader shows the preset before picking it.
		shows bool
	}{
		{"a reader who shows it picks it again", true},
		{"a reader who shows no icon picks it", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()

			suffix := string(rune('A' + i))
			tenant := pg.SeedTenant(t, "PRESETLOCK"+suffix, "preset-lock-"+suffix+".example.com", "Preset Lock")
			reader := pg.SeedEndUser(t, tenant.ID, "PRESETLCKR"+suffix, "reader@preset-lock-"+suffix+".example.com", "Reader")
			presetID := uuid.Must(uuid.NewV7())
			if _, err := pg.DB.ExecContext(ctx, `INSERT INTO reader_icon_presets (id, tenant_id) VALUES ($1, $2)`, presetID, tenant.ID); err != nil {
				t.Fatalf("insert preset: %v", err)
			}
			if tc.shows {
				if _, err := pg.DB.ExecContext(ctx, `UPDATE users SET icon_preset_id = $2 WHERE id = $1`, reader.ID, presetID); err != nil {
					t.Fatalf("elect preset: %v", err)
				}
			}

			deleting, err := pg.DB.BeginTx(ctx, nil)
			if err != nil {
				t.Fatalf("begin the deleting transaction: %v", err)
			}
			defer deleting.Rollback() //nolint:errcheck
			deletes := dbmodels.New(deleting)
			if _, err := deletes.LockReaderIconPreset(ctx, dbmodels.LockReaderIconPresetParams{TenantID: tenant.ID, ID: presetID}); err != nil {
				t.Fatalf("lock the preset: %v", err)
			}

			picked := make(chan error, 1)
			go func() {
				picking, err := pg.DB.BeginTx(ctx, nil)
				if err != nil {
					picked <- err
					return
				}
				defer picking.Rollback() //nolint:errcheck
				if err := usericon.SelectPreset(ctx, dbmodels.New(picking), tenant.ID, reader.ID, presetID); err != nil {
					picked <- err
					return
				}
				picked <- picking.Commit()
			}()

			if tc.shows {
				// The key is unchanged, so the pick takes no lock on the
				// preset and commits while the delete still holds it.
				select {
				case err := <-picked:
					if err != nil {
						t.Fatalf("pick of the preset the reader shows: %v", err)
					}
				case <-time.After(10 * time.Second):
					t.Fatal("the pick of the preset the reader shows waited on the preset the delete holds")
				}
			} else {
				// The pick holds the account and waits on the preset; the
				// clear below must not wait on the account in turn.
				waitForBlockedBackend(t, pg)
			}

			cleared, err := deletes.ClearReaderIconPresetElections(ctx, dbmodels.ClearReaderIconPresetElectionsParams{
				TenantID:           uuid.NullUUID{UUID: tenant.ID, Valid: true},
				ReaderIconPresetID: uuid.NullUUID{UUID: presetID, Valid: true},
			})
			if err != nil {
				t.Fatalf("clear the accounts showing the preset: %v", err)
			}
			if wantCleared := tc.shows; (len(cleared) == 1 && cleared[0] == reader.ID) != wantCleared || len(cleared) > 1 {
				t.Fatalf("cleared accounts = %v, want the reader cleared: %t", cleared, wantCleared)
			}
			if _, err := deletes.DeleteReaderIconPreset(ctx, dbmodels.DeleteReaderIconPresetParams{TenantID: tenant.ID, ID: presetID}); err != nil {
				t.Fatalf("delete the preset: %v", err)
			}
			if err := deleting.Commit(); err != nil {
				t.Fatalf("commit the delete: %v", err)
			}

			if !tc.shows {
				if err := <-picked; !errors.Is(err, usericon.ErrPresetNotFound) {
					t.Fatalf("pick of the deleted preset = %v, want %v", err, usericon.ErrPresetNotFound)
				}
			}
			var shown uuid.NullUUID
			if err := pg.DB.QueryRowContext(ctx, `SELECT icon_preset_id FROM users WHERE id = $1`, reader.ID).Scan(&shown); err != nil {
				t.Fatalf("read the reader's preset: %v", err)
			}
			if shown.Valid {
				t.Fatalf("reader's preset after the delete = %s, want none", shown.UUID)
			}
		})
	}
}
