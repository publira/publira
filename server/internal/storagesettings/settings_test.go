package storagesettings_test

import (
	"bytes"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/storagesettings"
)

func testEncryptor(t *testing.T) *secretcrypto.Manager {
	t.Helper()
	manager, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{7}, 32)}, "k1")
	if err != nil {
		t.Fatalf("secretcrypto.NewManager: %v", err)
	}
	return manager
}

func validSettings() storagesettings.Settings {
	return storagesettings.Settings{
		Bucket:         "publira-objects",
		Region:         "ap-northeast-1",
		Endpoint:       "https://s3.example.com",
		ForcePathStyle: true,
		PublicBaseURL:  "https://cdn.example.com/objects",
	}
}

func TestNormalizeTrimsAndDropsTrailingSlashes(t *testing.T) {
	t.Parallel()

	normalized := storagesettings.Normalize(storagesettings.Settings{
		Bucket:        "  publira-objects ",
		Region:        " ap-northeast-1 ",
		Endpoint:      " https://s3.example.com/ ",
		PublicBaseURL: "https://cdn.example.com/objects//",
	})

	want := storagesettings.Settings{
		Bucket:        "publira-objects",
		Region:        "ap-northeast-1",
		Endpoint:      "https://s3.example.com",
		PublicBaseURL: "https://cdn.example.com/objects",
	}
	if normalized != want {
		t.Fatalf("Normalize() = %+v, want %+v", normalized, want)
	}
}

func TestValidateAcceptsAConfigurationThatAddressesABucket(t *testing.T) {
	t.Parallel()

	if err := storagesettings.Validate(validSettings()); err != nil {
		t.Fatalf("Validate(): %v", err)
	}
	// A bucket on AWS names neither an endpoint nor a base URL.
	minimal := storagesettings.Settings{Bucket: "publira-objects", Region: "ap-northeast-1"}
	if err := storagesettings.Validate(minimal); err != nil {
		t.Fatalf("Validate(minimal): %v", err)
	}
}

func TestValidateRefusesAConfigurationNothingCouldBeStoredIn(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name  string
		apply func(*storagesettings.Settings)
		want  string
	}{
		{name: "no bucket", apply: func(s *storagesettings.Settings) { s.Bucket = "" }, want: "bucket is required"},
		{name: "bucket too short", apply: func(s *storagesettings.Settings) { s.Bucket = "ab" }, want: "between"},
		{name: "bucket in upper case", apply: func(s *storagesettings.Settings) { s.Bucket = "Publira-Objects" }, want: "lowercase"},
		{name: "bucket with consecutive dots", apply: func(s *storagesettings.Settings) { s.Bucket = "publira..objects" }, want: "consecutive dots"},
		{name: "bucket ending in a hyphen", apply: func(s *storagesettings.Settings) { s.Bucket = "publira-objects-" }, want: "start and end"},
		{name: "bucket as an IP address", apply: func(s *storagesettings.Settings) { s.Bucket = "192.168.0.1" }, want: "IP address"},
		{name: "no region", apply: func(s *storagesettings.Settings) { s.Region = "" }, want: "region is required"},
		{name: "endpoint without a scheme", apply: func(s *storagesettings.Settings) { s.Endpoint = "s3.example.com" }, want: "endpoint"},
		{name: "endpoint with a query", apply: func(s *storagesettings.Settings) { s.Endpoint = "https://s3.example.com?a=1" }, want: "endpoint"},
		{name: "public base URL without a host", apply: func(s *storagesettings.Settings) { s.PublicBaseURL = "https:///objects" }, want: "public_base_url"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			settings := validSettings()
			tc.apply(&settings)
			err := storagesettings.Validate(settings)
			if err == nil {
				t.Fatalf("Validate(%+v) = nil, want an error", settings)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("Validate() error = %q, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestValidateCredentialPairRefusesHalfACredential(t *testing.T) {
	t.Parallel()

	if err := storagesettings.ValidateCredentialPair("", false); err != nil {
		t.Fatalf("ValidateCredentialPair(ambient): %v", err)
	}
	if err := storagesettings.ValidateCredentialPair("AKIAEXAMPLE", true); err != nil {
		t.Fatalf("ValidateCredentialPair(explicit): %v", err)
	}
	if err := storagesettings.ValidateCredentialPair("AKIAEXAMPLE", false); !errors.Is(err, storagesettings.ErrSecretAccessKeyMissing) {
		t.Fatalf("ValidateCredentialPair(id only) = %v, want ErrSecretAccessKeyMissing", err)
	}
	if err := storagesettings.ValidateCredentialPair("", true); !errors.Is(err, storagesettings.ErrAccessKeyIDRequired) {
		t.Fatalf("ValidateCredentialPair(secret only) = %v, want ErrAccessKeyIDRequired", err)
	}
}

func TestCredentialsKeepTheSecretOutOfEveryRendering(t *testing.T) {
	t.Parallel()

	credentials := storagesettings.Credentials{AccessKeyID: "AKIAEXAMPLE", SecretAccessKey: "s3cr3t-value"}
	logs := &bytes.Buffer{}
	slog.New(slog.NewTextHandler(logs, nil)).Info("storage", "credentials", credentials)

	for _, rendered := range []string{
		fmt.Sprintf("%v", credentials),
		fmt.Sprintf("%+v", credentials),
		fmt.Sprintf("%#v", credentials),
		logs.String(),
	} {
		if strings.Contains(rendered, "s3cr3t-value") {
			t.Fatalf("rendering %q carries the secret access key", rendered)
		}
	}
}

func TestCredentialsAreAmbientWhenNeitherHalfIsGiven(t *testing.T) {
	t.Parallel()

	if !(storagesettings.Credentials{}).Ambient() {
		t.Fatal("the zero credential is not ambient")
	}
	if (storagesettings.Credentials{AccessKeyID: "AKIAEXAMPLE"}).Ambient() {
		t.Fatal("a credential naming an access key id is ambient")
	}
}

func TestEncryptUpdatedSecretKeepsReplacesAndClearsTheStoredSecret(t *testing.T) {
	t.Parallel()

	encryptor := testEncryptor(t)
	stored, err := encryptor.EncryptString("stored-secret")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}

	unchanged, err := storagesettings.EncryptUpdatedSecret(stored, storagesettings.SecretUpdateModeUnchanged, "", encryptor)
	if err != nil {
		t.Fatalf("EncryptUpdatedSecret(unchanged): %v", err)
	}
	if unchanged != stored {
		t.Fatalf("EncryptUpdatedSecret(unchanged) = %q, want the stored ciphertext", unchanged)
	}

	replaced, err := storagesettings.EncryptUpdatedSecret(stored, storagesettings.SecretUpdateModeReplace, "new-secret", encryptor)
	if err != nil {
		t.Fatalf("EncryptUpdatedSecret(replace): %v", err)
	}
	if !secretcrypto.IsEncryptedEnvelope(replaced) {
		t.Fatalf("EncryptUpdatedSecret(replace) = %q, want an encrypted envelope", replaced)
	}
	plaintext, err := encryptor.DecryptString(replaced)
	if err != nil {
		t.Fatalf("DecryptString: %v", err)
	}
	if plaintext != "new-secret" {
		t.Fatalf("the replaced secret decrypts to %q, want %q", plaintext, "new-secret")
	}

	cleared, err := storagesettings.EncryptUpdatedSecret(stored, storagesettings.SecretUpdateModeClear, "", encryptor)
	if err != nil {
		t.Fatalf("EncryptUpdatedSecret(clear): %v", err)
	}
	if cleared != "" {
		t.Fatalf("EncryptUpdatedSecret(clear) = %q, want nothing stored", cleared)
	}
}

func TestEncryptUpdatedSecretRefusesAReplacementWithNoSecret(t *testing.T) {
	t.Parallel()

	_, err := storagesettings.EncryptUpdatedSecret("", storagesettings.SecretUpdateModeReplace, "   ", testEncryptor(t))
	if !errors.Is(err, storagesettings.ErrSecretAccessKeyRequired) {
		t.Fatalf("EncryptUpdatedSecret(replace, blank) = %v, want ErrSecretAccessKeyRequired", err)
	}
	if _, err := storagesettings.EncryptUpdatedSecret("", storagesettings.SecretUpdateModeReplace, "secret", nil); !errors.Is(err, storagesettings.ErrSecretManagerUnavailable) {
		t.Fatalf("EncryptUpdatedSecret(no manager) = %v, want ErrSecretManagerUnavailable", err)
	}
}

func TestResolveSecretForTestAnswersTheStoredSecretAndTheAmbientCredential(t *testing.T) {
	t.Parallel()

	encryptor := testEncryptor(t)
	stored, err := encryptor.EncryptString("stored-secret")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}

	secret, err := storagesettings.ResolveSecretForTest(stored, storagesettings.SecretUpdateModeUnchanged, "", encryptor)
	if err != nil {
		t.Fatalf("ResolveSecretForTest(unchanged): %v", err)
	}
	if secret != "stored-secret" {
		t.Fatalf("ResolveSecretForTest(unchanged) = %q, want the stored secret", secret)
	}

	// Nothing stored is the ambient credential rather than a missing value:
	// the test then signs the way every process does.
	secret, err = storagesettings.ResolveSecretForTest("", storagesettings.SecretUpdateModeUnchanged, "", encryptor)
	if err != nil {
		t.Fatalf("ResolveSecretForTest(nothing stored): %v", err)
	}
	if secret != "" {
		t.Fatalf("ResolveSecretForTest(nothing stored) = %q, want no secret", secret)
	}

	secret, err = storagesettings.ResolveSecretForTest(stored, storagesettings.SecretUpdateModeReplace, "typed-secret", encryptor)
	if err != nil {
		t.Fatalf("ResolveSecretForTest(replace): %v", err)
	}
	if secret != "typed-secret" {
		t.Fatalf("ResolveSecretForTest(replace) = %q, want the secret the request carried", secret)
	}
}

func TestFromConfigReadsASavedRowWithoutItsSecret(t *testing.T) {
	t.Parallel()

	stored := storagesettings.FromConfig(dbmodels.PlatformStorageConfig{
		Bucket:                   "publira-objects",
		Region:                   "ap-northeast-1",
		Endpoint:                 sql.NullString{String: "https://s3.example.com", Valid: true},
		ForcePathStyle:           true,
		PublicBaseUrl:            sql.NullString{},
		AccessKeyID:              sql.NullString{String: "AKIAEXAMPLE", Valid: true},
		SecretAccessKeyEncrypted: sql.NullString{String: "enc:v1:k1:nonce:ciphertext", Valid: true},
		Revision:                 4,
	})

	want := storagesettings.Stored{
		Settings: storagesettings.Settings{
			Bucket:         "publira-objects",
			Region:         "ap-northeast-1",
			Endpoint:       "https://s3.example.com",
			ForcePathStyle: true,
		},
		AccessKeyID:        "AKIAEXAMPLE",
		HasSecretAccessKey: true,
		Revision:           4,
	}
	if stored != want {
		t.Fatalf("FromConfig() = %+v, want %+v", stored, want)
	}
}

func TestConfigParamsLeavesAnAbsentValueNull(t *testing.T) {
	t.Parallel()

	params := storagesettings.ConfigParams(storagesettings.Settings{
		Bucket: "publira-objects",
		Region: "ap-northeast-1",
	}, "", "")

	if params.Endpoint.Valid || params.PublicBaseUrl.Valid || params.AccessKeyID.Valid || params.SecretAccessKeyEncrypted.Valid {
		t.Fatalf("ConfigParams() = %+v, want every absent value null", params)
	}
	if params.Bucket != "publira-objects" || params.Region != "ap-northeast-1" {
		t.Fatalf("ConfigParams() = %+v, want the bucket and region it was given", params)
	}
}

func TestFailedAnswersTheFirstRefusedCheck(t *testing.T) {
	t.Parallel()

	checks := []storagesettings.Check{
		{Operation: storagesettings.OperationPutObject},
		{Operation: storagesettings.OperationGetObject, Reason: "STORAGE_TEST_PERMISSION"},
		{Operation: storagesettings.OperationDeleteObject, Reason: "STORAGE_TEST_UNKNOWN"},
	}
	failed, ok := storagesettings.Failed(checks)
	if !ok {
		t.Fatal("Failed() found no refused check")
	}
	if failed.Operation != storagesettings.OperationGetObject {
		t.Fatalf("Failed() = %+v, want the get", failed)
	}
	if _, ok := storagesettings.Failed(checks[:1]); ok {
		t.Fatal("Failed() reported a refusal among checks that all succeeded")
	}
}
