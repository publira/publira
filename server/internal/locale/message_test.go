package locale

import (
	"errors"
	"testing"
)

func TestMessageFillsInTheVariablesItReads(t *testing.T) {
	got, err := Message("en", "email.layout.footer", map[string]string{"brand": "Aoto Press"})
	if err != nil {
		t.Fatalf("Message: %v", err)
	}
	if want := "This email was sent by Aoto Press."; got != want {
		t.Errorf("Message = %q, want %q", got, want)
	}
}

func TestMessageAnswersInTheLocaleItIsGiven(t *testing.T) {
	for _, code := range Supported {
		got, err := Message(code, "email.reader_password_reset.subject", map[string]string{"tenant_name": "Aoto Press"})
		if err != nil {
			t.Fatalf("Message(%s): %v", code, err)
		}
		if got == "" {
			t.Errorf("Message(%s) is empty", code)
		}
	}
}

func TestMessageRefusesRatherThanWordingAMailWrongly(t *testing.T) {
	if _, err := Message("de", "email.layout.brand", nil); !errors.Is(err, ErrUnresolved) {
		t.Errorf("err = %v, want %v", err, ErrUnresolved)
	}
	if _, err := Message("en", "email.layout.wordmark", nil); !errors.Is(err, ErrUnknownMessage) {
		t.Errorf("err = %v, want %v", err, ErrUnknownMessage)
	}
	if _, err := Message("en", "email.layout.footer", nil); !errors.Is(err, ErrMissingValue) {
		t.Errorf("err = %v, want %v", err, ErrMissingValue)
	}
}
