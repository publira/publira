package adminapi

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
)

func TestNormalizeAndroidAssociationAcceptsManifestIdentities(t *testing.T) {
	for _, applicationID := range []string{"com.example.reader", "jp.example.reader_app", "Com.Example.R2"} {
		got, err := normalizeAndroidAssociation(&publiraadminv1.TenantAndroidAppAssociation{
			ApplicationId:          applicationID,
			Sha256CertFingerprints: []string{" " + strings.ToLower(testFingerprintA) + " ", testFingerprintB},
		})
		if err != nil {
			t.Fatalf("normalizeAndroidAssociation(%q): %v", applicationID, err)
		}
		if got.applicationID.String != applicationID || !got.applicationID.Valid {
			t.Fatalf("application ID = %v, want %q", got.applicationID, applicationID)
		}
		if want := []string{testFingerprintA, testFingerprintB}; !slices.Equal(got.fingerprints, want) {
			t.Fatalf("fingerprints = %v, want %v in uppercase and in the order given", got.fingerprints, want)
		}
	}
}

func TestNormalizeAndroidAssociationWithoutAnAppStoresNothing(t *testing.T) {
	got, err := normalizeAndroidAssociation(nil)
	if err != nil {
		t.Fatalf("normalizeAndroidAssociation(nil): %v", err)
	}
	if got.applicationID.Valid {
		t.Fatalf("application ID = %v, want NULL", got.applicationID)
	}
	if got.fingerprints == nil || len(got.fingerprints) != 0 {
		t.Fatalf("fingerprints = %#v, want an empty non-nil list for the NOT NULL column", got.fingerprints)
	}
}

func TestNormalizeAndroidAssociationRefusesMalformedValues(t *testing.T) {
	tooMany := make([]string, maxAndroidCertFingerprints+1)
	for i := range tooMany {
		tooMany[i] = fmt.Sprintf("%s%02X", testFingerprintA[:len(testFingerprintA)-2], i)
	}
	tests := []struct {
		name          string
		applicationID string
		fingerprints  []string
		wantField     string
	}{
		{"an empty application ID", "", []string{testFingerprintA}, "association.android.application_id"},
		{"a single-segment application ID", "reader", []string{testFingerprintA}, "association.android.application_id"},
		{"a segment starting with a digit", "com.1example.reader", []string{testFingerprintA}, "association.android.application_id"},
		{"a hyphen in the application ID", "com.example-app.reader", []string{testFingerprintA}, "association.android.application_id"},
		{"no fingerprint", "com.example.reader", nil, "association.android.sha256_cert_fingerprints"},
		{"more fingerprints than the bound", "com.example.reader", tooMany, "association.android.sha256_cert_fingerprints"},
		{"a fingerprint without colons", "com.example.reader", []string{testFingerprintA, strings.ReplaceAll(testFingerprintB, ":", "")}, "association.android.sha256_cert_fingerprints[1]"},
		{"a SHA-1 fingerprint", "com.example.reader", []string{"DA:39:A3:EE:5E:6B:4B:0D:32:55:BF:EF:95:60:18:90:AF:D8:07:09"}, "association.android.sha256_cert_fingerprints[0]"},
		{"a fingerprint that is not hex", "com.example.reader", []string{strings.Replace(testFingerprintA, "14", "ZZ", 1)}, "association.android.sha256_cert_fingerprints[0]"},
		{"a fingerprint listed twice in different case", "com.example.reader", []string{testFingerprintA, strings.ToLower(testFingerprintA)}, "association.android.sha256_cert_fingerprints[1]"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := normalizeAndroidAssociation(&publiraadminv1.TenantAndroidAppAssociation{
				ApplicationId:          tt.applicationID,
				Sha256CertFingerprints: tt.fingerprints,
			})
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
			}
			assertBadRequestField(t, err, tt.wantField)
		})
	}
}

func TestNormalizeIosAssociationAcceptsManifestIdentities(t *testing.T) {
	teamID, bundleIdentifier, err := normalizeIosAssociation(&publiraadminv1.TenantIosAppAssociation{
		TeamId:           " abcde12345 ",
		BundleIdentifier: " com.example.Reader-App ",
	})
	if err != nil {
		t.Fatalf("normalizeIosAssociation: %v", err)
	}
	if teamID.String != "ABCDE12345" || !teamID.Valid {
		t.Fatalf("team ID = %v, want ABCDE12345", teamID)
	}
	if bundleIdentifier.String != "com.example.Reader-App" || !bundleIdentifier.Valid {
		t.Fatalf("bundle identifier = %v, want com.example.Reader-App with its case kept", bundleIdentifier)
	}

	teamID, bundleIdentifier, err = normalizeIosAssociation(nil)
	if err != nil || teamID.Valid || bundleIdentifier.Valid {
		t.Fatalf("normalizeIosAssociation(nil) = %v, %v, %v, want NULL for both", teamID, bundleIdentifier, err)
	}
}

func TestNormalizeIosAssociationRefusesMalformedValues(t *testing.T) {
	tests := []struct {
		name             string
		teamID           string
		bundleIdentifier string
		wantField        string
	}{
		{"an empty team ID", "", "com.example.reader", "association.ios.team_id"},
		{"a nine-character team ID", "ABCDE1234", "com.example.reader", "association.ios.team_id"},
		{"a team ID with punctuation", "ABCDE-1234", "com.example.reader", "association.ios.team_id"},
		{"an empty bundle identifier", "ABCDE12345", "", "association.ios.bundle_identifier"},
		{"a single-segment bundle identifier", "ABCDE12345", "reader", "association.ios.bundle_identifier"},
		{"an underscore in the bundle identifier", "ABCDE12345", "com.example.reader_app", "association.ios.bundle_identifier"},
		{"an empty segment", "ABCDE12345", "com..reader", "association.ios.bundle_identifier"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, err := normalizeIosAssociation(&publiraadminv1.TenantIosAppAssociation{
				TeamId:           tt.teamID,
				BundleIdentifier: tt.bundleIdentifier,
			})
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
			}
			assertBadRequestField(t, err, tt.wantField)
		})
	}
}
