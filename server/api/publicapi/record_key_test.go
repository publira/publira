package publicapi

import (
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"
)

func TestRequestRecordKey(t *testing.T) {
	id := uuid.Must(uuid.NewV7())

	t.Run("the ID wins over the public ID", func(t *testing.T) {
		key, err := requestRecordKey("episode_id", " "+id.String()+" ", "EPISODE001")
		if err != nil {
			t.Fatalf("requestRecordKey: %v", err)
		}
		if !key.id.Valid || key.id.UUID != id || key.publicID.Valid {
			t.Fatalf("key = %+v, want the ID alone", key)
		}
	})

	t.Run("the public ID is used without an ID", func(t *testing.T) {
		key, err := requestRecordKey("episode_id", "", " EPISODE001 ")
		if err != nil {
			t.Fatalf("requestRecordKey: %v", err)
		}
		if key.id.Valid || key.publicID.String != "EPISODE001" || !key.publicID.Valid {
			t.Fatalf("key = %+v, want the public ID alone", key)
		}
	})

	t.Run("a malformed ID is invalid", func(t *testing.T) {
		_, err := requestRecordKey("episode_id", "EPISODE001", "")
		if connect.CodeOf(err) != connect.CodeInvalidArgument || err.Error() != "invalid_argument: episode_id is invalid" {
			t.Fatalf("error = %v, want episode_id is invalid", err)
		}
	})

	t.Run("naming neither is invalid", func(t *testing.T) {
		_, err := requestRecordKey("episode_id", " ", "")
		if connect.CodeOf(err) != connect.CodeInvalidArgument || err.Error() != "invalid_argument: episode_id is required" {
			t.Fatalf("error = %v, want episode_id is required", err)
		}
	})
}
