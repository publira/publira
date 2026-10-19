package adminapi

import (
	"slices"
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
)

func TestCheckCampaignPrice(t *testing.T) {
	for _, price := range []int32{0, -1} {
		if err := checkCampaignPrice(price); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Errorf("checkCampaignPrice(%d) code = %v, want invalid_argument", price, connect.CodeOf(err))
		}
	}
	if err := checkCampaignPrice(1); err != nil {
		t.Errorf("checkCampaignPrice(1) = %v, want nil", err)
	}
}

func TestCheckCampaignUndercuts(t *testing.T) {
	cases := []struct {
		name        string
		campaign    int32
		episode     int32
		wantRefused bool
	}{
		{name: "below the price", campaign: 300, episode: 500},
		{name: "the price itself", campaign: 500, episode: 500, wantRefused: true},
		{name: "above the price", campaign: 600, episode: 500, wantRefused: true},
		{name: "a free episode", campaign: 100, episode: 0, wantRefused: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := checkCampaignUndercuts(tc.campaign, tc.episode)
			if tc.wantRefused {
				if connect.CodeOf(err) != connect.CodeInvalidArgument {
					t.Fatalf("code = %v, want invalid_argument", connect.CodeOf(err))
				}
				return
			}
			if err != nil {
				t.Fatalf("err = %v, want nil", err)
			}
		})
	}
}

func TestSeriesCampaignPriceEpisodes(t *testing.T) {
	first := uuid.MustParse("01900000-0000-7000-8000-000000000001")
	second := uuid.MustParse("01900000-0000-7000-8000-000000000002")

	// A whole series is not scheduled by naming none, as a free window is.
	t.Run("no episodes named is refused", func(t *testing.T) {
		if _, err := seriesCampaignPriceEpisodes(nil); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("code = %v, want invalid_argument", connect.CodeOf(err))
		}
	})

	t.Run("the named episodes are read in the order given", func(t *testing.T) {
		ids, err := seriesCampaignPriceEpisodes([]string{second.String(), first.String()})
		if err != nil {
			t.Fatalf("err = %v", err)
		}
		if !slices.Equal(ids, []uuid.UUID{second, first}) {
			t.Fatalf("ids = %v, want [%v %v]", ids, second, first)
		}
	})

	t.Run("an episode named twice is refused", func(t *testing.T) {
		if _, err := seriesCampaignPriceEpisodes([]string{first.String(), first.String()}); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("code = %v, want invalid_argument", connect.CodeOf(err))
		}
	})

	t.Run("more episodes than one call may name is refused", func(t *testing.T) {
		raw := make([]string, 0, maxSeriesScheduleEpisodes+1)
		for range maxSeriesScheduleEpisodes + 1 {
			raw = append(raw, uuid.Must(uuid.NewV7()).String())
		}
		if _, err := seriesCampaignPriceEpisodes(raw); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("code = %v, want invalid_argument", connect.CodeOf(err))
		}
	})
}
