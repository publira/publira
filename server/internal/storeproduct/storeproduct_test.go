package storeproduct

import "testing"

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
