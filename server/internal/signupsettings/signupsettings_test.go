package signupsettings

import (
	"errors"
	"strings"
	"testing"
)

func TestNormalizeTrimsTheMessage(t *testing.T) {
	got, err := Normalize(Settings{Open: false, ClosedMessage: "  \n Sign-up reopens in spring.\n\nThank you. \t"})
	if err != nil {
		t.Fatalf("Normalize: %v", err)
	}
	want := Settings{Open: false, ClosedMessage: "Sign-up reopens in spring.\n\nThank you."}
	if got != want {
		t.Fatalf("Normalize = %#v, want %#v", got, want)
	}
}

func TestNormalizeCountsTheMessageInCharacters(t *testing.T) {
	// A character outside ASCII takes several bytes, and the bound is on
	// characters, as the column's check is.
	atLimit := strings.Repeat("é", MaxClosedMessageLength)
	if _, err := Normalize(Settings{ClosedMessage: atLimit}); err != nil {
		t.Fatalf("Normalize(%d characters): %v", MaxClosedMessageLength, err)
	}
	if _, err := Normalize(Settings{ClosedMessage: atLimit + "é"}); !errors.Is(err, ErrClosedMessageTooLong) {
		t.Fatalf("Normalize(%d characters) error = %v, want ErrClosedMessageTooLong", MaxClosedMessageLength+1, err)
	}
	// Whitespace the trim removes does not count.
	if _, err := Normalize(Settings{ClosedMessage: "  " + atLimit + "  "}); err != nil {
		t.Fatalf("Normalize(padded): %v", err)
	}
}
