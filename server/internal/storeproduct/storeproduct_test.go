package storeproduct

import (
	"regexp"
	"testing"

	"github.com/google/uuid"
)

func TestProductID(t *testing.T) {
	for _, tc := range []struct {
		price int32
		want  string
	}{
		{price: 100, want: "episode_100"},
		{price: 300, want: "episode_300"},
		{price: 12000, want: "episode_12000"},
	} {
		if got := ProductID(tc.price); got != tc.want {
			t.Errorf("ProductID(%d) = %q, want %q", tc.price, got, tc.want)
		}
	}
}

// googlePlayProductID is what Google Play accepts as a product ID: digits,
// lowercase letters, underscores, and periods, starting with a digit or a
// lowercase letter.
var googlePlayProductID = regexp.MustCompile(`^[0-9a-z][0-9a-z_.]*$`)

func TestCoinPackProductIDIsOneGooglePlayAccepts(t *testing.T) {
	id := uuid.MustParse("019a2f3c-4B5d-7e6f-8A9b-0c1d2e3f4a5b")
	if got, want := CoinPackProductID(id), "coins_019a2f3c4b5d7e6f8a9b0c1d2e3f4a5b"; got != want {
		t.Fatalf("CoinPackProductID(%s) = %q, want %q", id, got, want)
	}
	for range 100 {
		if got := CoinPackProductID(uuid.Must(uuid.NewV7())); !googlePlayProductID.MatchString(got) {
			t.Fatalf("CoinPackProductID = %q, which Google Play refuses", got)
		}
	}
}
