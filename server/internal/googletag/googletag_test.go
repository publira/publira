package googletag

import (
	"errors"
	"regexp"
	"testing"
)

func TestNormalizeMeasurementID(t *testing.T) {
	tests := []struct {
		raw     string
		want    string
		wantErr error
	}{
		{raw: "G-ABC123XYZ9", want: "G-ABC123XYZ9"},
		{raw: " g-abc123xyz9 ", want: "G-ABC123XYZ9"},
		{raw: "", want: ""},
		{raw: "   ", want: ""},
		{raw: "UA-12345678-1", wantErr: ErrUniversalAnalyticsID},
		{raw: "ua-12345678-1", wantErr: ErrUniversalAnalyticsID},
		{raw: "GTM-ABC123", wantErr: ErrInvalidMeasurementID},
		{raw: "G-", wantErr: ErrInvalidMeasurementID},
		{raw: "G-ABC-123", wantErr: ErrInvalidMeasurementID},
		{raw: "ABC123", wantErr: ErrInvalidMeasurementID},
		{raw: "G-" + "A1234567890123456789012345678901", wantErr: ErrInvalidMeasurementID},
	}
	for _, tt := range tests {
		got, err := NormalizeMeasurementID(tt.raw)
		if !errors.Is(err, tt.wantErr) || got != tt.want {
			t.Errorf("NormalizeMeasurementID(%q) = (%q, %v), want (%q, %v)", tt.raw, got, err, tt.want, tt.wantErr)
		}
	}
}

func TestNormalizeContainerID(t *testing.T) {
	tests := []struct {
		raw     string
		want    string
		wantErr error
	}{
		{raw: "GTM-ABC1234", want: "GTM-ABC1234"},
		{raw: " gtm-abc1234 ", want: "GTM-ABC1234"},
		{raw: "", want: ""},
		{raw: "G-ABC1234", wantErr: ErrInvalidContainerID},
		{raw: "GTM-", wantErr: ErrInvalidContainerID},
		{raw: "GTM-ABC_123", wantErr: ErrInvalidContainerID},
		{raw: "<script>", wantErr: ErrInvalidContainerID},
	}
	for _, tt := range tests {
		got, err := NormalizeContainerID(tt.raw)
		if !errors.Is(err, tt.wantErr) || got != tt.want {
			t.Errorf("NormalizeContainerID(%q) = (%q, %v), want (%q, %v)", tt.raw, got, err, tt.want, tt.wantErr)
		}
	}
}

func TestNormalizeServerContainerURL(t *testing.T) {
	accepted := map[string]string{
		"https://sgtm.example.com":         "https://sgtm.example.com",
		" https://sgtm.example.com/ ":      "https://sgtm.example.com",
		"HTTPS://SGTM.Example.COM":         "https://sgtm.example.com",
		"https://sgtm.example.com:443":     "https://sgtm.example.com",
		"https://sgtm.example.com:8443/":   "https://sgtm.example.com:8443",
		"https://計測.example.jp":            "https://xn--g6w570d.example.jp",
		"https://tag-server.example.co.jp": "https://tag-server.example.co.jp",
		"":                                 "",
	}
	for raw, want := range accepted {
		got, err := NormalizeServerContainerURL(raw)
		if err != nil || got != want {
			t.Errorf("NormalizeServerContainerURL(%q) = (%q, %v), want %q", raw, got, err, want)
		}
	}

	refused := []string{
		"http://sgtm.example.com",
		"sgtm.example.com",
		"//sgtm.example.com",
		"ftp://sgtm.example.com",
		"https://sgtm.example.com/gtm",
		"https://sgtm.example.com/?id=1",
		"https://sgtm.example.com?",
		"https://sgtm.example.com#tag",
		"https://sgtm.example.com#",
		"https://user:pass@sgtm.example.com",
		"https://sgtm.example.com:",
		"https://sgtm.example.com:0",
		"https://sgtm.example.com:65536",
		"https://sgtm.example.com:https",
		"https://localhost",
		"https://127.0.0.1",
		"https://127.1",
		"https://10.0.0.5:8443",
		"https://[::1]",
		"https://sgtm.example.com.",
		"https://sgtm..example.com",
		"https://-sgtm.example.com",
		"https://sgtm_server.example.com",
		"https://sgtm .example.com",
		"https:///",
		"https://",
	}
	for _, raw := range refused {
		if got, err := NormalizeServerContainerURL(raw); !errors.Is(err, ErrInvalidServerContainerURL) {
			t.Errorf("NormalizeServerContainerURL(%q) = (%q, %v), want ErrInvalidServerContainerURL", raw, got, err)
		}
	}
}

// A gateway path holds an underscore, which no page slug segment may, and
// the stored CHECK accepts exactly the shape generated here.
func TestNewGatewayPathIsRandomAndNeverAPageSlug(t *testing.T) {
	stored := regexp.MustCompile(`^_[a-z2-7]{16}$`)
	pageSlugSegment := regexp.MustCompile(`^[a-z0-9][a-z0-9\-]*$`)
	seen := map[string]struct{}{}
	for range 100 {
		path, err := NewGatewayPath()
		if err != nil {
			t.Fatalf("NewGatewayPath: %v", err)
		}
		if !stored.MatchString(path) {
			t.Fatalf("NewGatewayPath() = %q, want the stored shape", path)
		}
		if pageSlugSegment.MatchString(path) {
			t.Fatalf("NewGatewayPath() = %q, which a page slug could take", path)
		}
		if _, ok := seen[path]; ok {
			t.Fatalf("NewGatewayPath() repeated %q", path)
		}
		seen[path] = struct{}{}
	}
}

func TestSettingsMeasuresOnlyWithAnID(t *testing.T) {
	for _, tt := range []struct {
		settings Settings
		want     bool
	}{
		{settings: Default()},
		{settings: Settings{ServingMode: ServingModeServerContainer, ServerContainerURL: "https://sgtm.example.com"}},
		{settings: Settings{ServingMode: ServingModeGateway, GatewayPath: "_abcdefghijklmnop"}},
		{settings: Settings{ServingMode: ServingModeGoogle, GA4MeasurementID: "G-ABC123"}, want: true},
		{settings: Settings{ServingMode: ServingModeGoogle, GTMContainerID: "GTM-ABC123"}, want: true},
	} {
		if got := tt.settings.Measures(); got != tt.want {
			t.Errorf("%+v.Measures() = %v, want %v", tt.settings, got, tt.want)
		}
	}
}
