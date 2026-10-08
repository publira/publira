package publicapi

import (
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
)

func TestRequestRecordID(t *testing.T) {
	id := uuid.Must(uuid.NewV7())

	t.Run("an ID is read with its surrounding space trimmed", func(t *testing.T) {
		got, err := requestRecordID("episode_id", " "+id.String()+" ")
		if err != nil || got != id {
			t.Fatalf("requestRecordID = %s, %v, want %s", got, err, id)
		}
	})

	t.Run("a public ID is not an ID", func(t *testing.T) {
		_, err := requestRecordID("episode_id", "EPISODE001")
		if connect.CodeOf(err) != connect.CodeInvalidArgument || err.Error() != "invalid_argument: episode_id is invalid" {
			t.Fatalf("error = %v, want episode_id is invalid", err)
		}
	})

	t.Run("a missing ID is required", func(t *testing.T) {
		_, err := requestRecordID("episode_id", " ")
		if connect.CodeOf(err) != connect.CodeInvalidArgument || err.Error() != "invalid_argument: episode_id is required" {
			t.Fatalf("error = %v, want episode_id is required", err)
		}
	})
}
