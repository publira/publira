package push_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/push"
	"github.com/publira/publira/server/internal/testutil"
)

func withField(t *testing.T, keyJSON, field string, value any) string {
	t.Helper()
	var key map[string]any
	if err := json.Unmarshal([]byte(keyJSON), &key); err != nil {
		t.Fatalf("decode key: %v", err)
	}
	if value == nil {
		delete(key, field)
	} else {
		key[field] = value
	}
	body, err := json.Marshal(key)
	if err != nil {
		t.Fatalf("encode key: %v", err)
	}
	return string(body)
}

func TestParseServiceAccountReadsTheProjectAndAccount(t *testing.T) {
	t.Parallel()

	keyJSON := testutil.ServiceAccountJSON(t, "tenant-a", "push@tenant-a.iam.gserviceaccount.com")
	account, err := push.ParseServiceAccount([]byte(keyJSON))
	if err != nil {
		t.Fatalf("ParseServiceAccount: %v", err)
	}
	if account.ProjectID != "tenant-a" || account.ClientEmail != "push@tenant-a.iam.gserviceaccount.com" {
		t.Fatalf("account = %+v", account)
	}
}

func TestParseServiceAccountRefusesWhatCannotSend(t *testing.T) {
	t.Parallel()

	valid := testutil.ServiceAccountJSON(t, "tenant-a", "push@tenant-a.iam.gserviceaccount.com")
	for _, tc := range []struct {
		name    string
		keyJSON string
	}{
		{name: "not JSON", keyJSON: "not json"},
		{name: "a JSON array", keyJSON: "[]"},
		{name: "a user credential", keyJSON: withField(t, valid, "type", "authorized_user")},
		{name: "no project", keyJSON: withField(t, valid, "project_id", nil)},
		{name: "no account", keyJSON: withField(t, valid, "client_email", " ")},
		{name: "no private key", keyJSON: withField(t, valid, "private_key", nil)},
		{name: "a private key that is not PEM", keyJSON: withField(t, valid, "private_key", "not-a-key")},
		{name: "a token endpoint other than Google's", keyJSON: withField(t, valid, "token_uri", "http://169.254.169.254/token")},
		{name: "an oversized file", keyJSON: withField(t, valid, "padding", strings.Repeat("a", push.MaxServiceAccountJSONBytes))},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			_, err := push.ParseServiceAccount([]byte(tc.keyJSON))
			if !errors.Is(err, push.ErrInvalidServiceAccount) {
				t.Fatalf("ParseServiceAccount error = %v, want ErrInvalidServiceAccount", err)
			}
		})
	}
}

// The refusal is shown to the administrator who pasted the key, so it names
// the field at fault and repeats nothing from the file.
func TestParseServiceAccountKeepsTheKeyOutOfItsError(t *testing.T) {
	t.Parallel()

	keyJSON := withField(t, testutil.ServiceAccountJSON(t, "tenant-a", "push@tenant-a.iam.gserviceaccount.com"),
		"private_key", "-----BEGIN PRIVATE KEY-----\nc2VjcmV0LW1hdGVyaWFs\n-----END PRIVATE KEY-----\n")
	_, err := push.ParseServiceAccount([]byte(keyJSON))
	if err == nil || strings.Contains(err.Error(), "c2VjcmV0LW1hdGVyaWFs") {
		t.Fatalf("ParseServiceAccount error = %v, want a refusal without the key", err)
	}
}

func TestNewRequiresAProjectAndAUsableKey(t *testing.T) {
	t.Parallel()

	keyJSON := testutil.ServiceAccountJSON(t, "tenant-a", "push@tenant-a.iam.gserviceaccount.com")
	if _, err := push.New(context.Background(), push.Config{CredentialsJSON: []byte(keyJSON)}); err == nil {
		t.Fatal("New without a project succeeded")
	}
	if _, err := push.New(context.Background(), push.Config{ProjectID: "tenant-a"}); !errors.Is(err, push.ErrInvalidServiceAccount) {
		t.Fatalf("New without a key error = %v, want ErrInvalidServiceAccount", err)
	}
	client, err := push.New(context.Background(), push.Config{ProjectID: "tenant-a", CredentialsJSON: []byte(keyJSON)})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if client.ProjectID() != "tenant-a" {
		t.Fatalf("ProjectID = %q", client.ProjectID())
	}
}
