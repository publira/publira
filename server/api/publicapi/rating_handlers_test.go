package publicapi

import (
	"reflect"
	"testing"
)

func TestSeriesRatingRevalidateTags(t *testing.T) {
	got := seriesRatingRevalidateTags(" tenant-id ", " series-id ")
	want := []string{
		"tenant:tenant-id:series:detail",
		"tenant:tenant-id:series:series-id",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("seriesRatingRevalidateTags() = %v, want %v", got, want)
	}
}
