package protomapper

import (
	"testing"

	"github.com/google/uuid"
)

func TestEyeCatchVariantURLNamesTheRowThatHoldsTheBytes(t *testing.T) {
	imageID := uuid.MustParse("018f0e76-0001-7000-8000-000000000001")
	rowID := uuid.MustParse("018f0e76-0001-7000-8000-000000000010")
	replacedRowID := uuid.MustParse("018f0e76-0001-7000-8000-000000000011")

	got := EyeCatchVariantURL("labels", imageID, "square", 600, rowID)
	want := "/images/labels/" + imageID.String() + "/square/600?v=" + rowID.String()
	if got != want {
		t.Fatalf("url = %q, want %q", got, want)
	}
	if EyeCatchVariantURL("labels", imageID, "square", 600, rowID) != got {
		t.Fatal("the same row produced a different url")
	}
	if EyeCatchVariantURL("labels", imageID, "square", 600, replacedRowID) == got {
		t.Fatal("a new row kept the url of the row it replaced")
	}
	if EyeCatchVariantURL("series", imageID, "square", 600, rowID) == got {
		t.Fatal("a series url collided with the label url")
	}
}
