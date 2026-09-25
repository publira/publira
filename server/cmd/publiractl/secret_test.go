package main

import (
	"bytes"
	"errors"
	"flag"
	"strings"
	"testing"
)

func TestSecretFromStdinDropsOneTrailingLineBreak(t *testing.T) {
	for _, tc := range []struct {
		stdin string
		want  string
	}{
		{stdin: "s3cret", want: "s3cret"},
		{stdin: "s3cret\n", want: "s3cret"},
		{stdin: "s3cret\r\n", want: "s3cret"},
		{stdin: " s3cret \n\n", want: " s3cret \n"},
		{stdin: "line one\nline two\n", want: "line one\nline two"},
	} {
		var stderr bytes.Buffer
		s := &secret{name: "password", label: "password", fromStdin: true}
		got, err := s.read(pipedConsole(tc.stdin, &stderr))
		if err != nil {
			t.Fatalf("read(%q): %v", tc.stdin, err)
		}
		if got != tc.want {
			t.Fatalf("read(%q) = %q, want %q", tc.stdin, got, tc.want)
		}
	}
}

func TestSecretPromptsOnATerminalWithoutEchoingIt(t *testing.T) {
	var stderr bytes.Buffer
	con := console{
		stdin:        strings.NewReader(""),
		stderr:       &stderr,
		isTerminal:   func() bool { return true },
		readPassword: func() ([]byte, error) { return []byte(testSecretValue), nil },
	}
	s := &secret{name: "smtp-password", label: "SMTP password"}

	got, err := s.read(con)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if got != testSecretValue {
		t.Fatalf("read = %q, want %q", got, testSecretValue)
	}
	if want := "SMTP password: \n"; stderr.String() != want {
		t.Fatalf("stderr = %q, want %q", stderr.String(), want)
	}
}

// A piped stdin with no -stdin flag cannot be prompted on, and reading it
// anyway would take input meant for something else.
func TestSecretWithoutATerminalOrItsFlagNamesTheFlag(t *testing.T) {
	var stderr bytes.Buffer
	s := &secret{name: "smtp-password", label: "SMTP password"}

	_, err := s.read(pipedConsole(testSecretValue, &stderr))
	if err == nil || !strings.Contains(err.Error(), "--smtp-password-stdin") {
		t.Fatalf("error = %v, want the flag named", err)
	}
}

func TestSecretRefusesAnEmptyValue(t *testing.T) {
	for _, tc := range []struct {
		name string
		con  console
		s    *secret
	}{
		{
			name: "stdin",
			con:  pipedConsole("\n", &bytes.Buffer{}),
			s:    &secret{name: "password", label: "password", fromStdin: true},
		},
		{
			name: "prompt",
			con: console{
				stderr:       &bytes.Buffer{},
				isTerminal:   func() bool { return true },
				readPassword: func() ([]byte, error) { return nil, nil },
			},
			s: &secret{name: "password", label: "password"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := tc.s.read(tc.con); err == nil || !strings.Contains(err.Error(), "empty") {
				t.Fatalf("error = %v, want the empty value refused", err)
			}
		})
	}
}

func TestSecretPromptFailureIsReported(t *testing.T) {
	con := console{
		stderr:       &bytes.Buffer{},
		isTerminal:   func() bool { return true },
		readPassword: func() ([]byte, error) { return nil, errors.New("interrupted") },
	}
	s := &secret{name: "password", label: "password"}
	if _, err := s.read(con); err == nil || !strings.Contains(err.Error(), "interrupted") {
		t.Fatalf("error = %v, want the prompt failure", err)
	}
}

// Stdin is one stream, so two secrets on it could not be told apart.
func TestOnlyOneSecretReadsStdinPerInvocation(t *testing.T) {
	f := &commandFlags{FlagSet: flag.NewFlagSet("webpush save", flag.ContinueOnError)}
	f.Secret("vapid-private-key", "VAPID private key")
	f.Secret("smtp-password", "SMTP password")

	if err := f.Parse([]string{"--vapid-private-key-stdin"}); err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if err := f.checkSecretSources(); err != nil {
		t.Fatalf("one secret on stdin: %v", err)
	}
	if err := f.Parse([]string{"--vapid-private-key-stdin", "--smtp-password-stdin"}); err != nil {
		t.Fatalf("Parse: %v", err)
	}
	err := f.checkSecretSources()
	if err == nil || !strings.Contains(err.Error(), "only one secret") {
		t.Fatalf("error = %v, want two secrets on stdin refused", err)
	}
}

// A secret that replaces a saved one reads as "" when none is given, so the
// command keeps what is saved; one given on stdin must still hold something.
func TestKeepableSecretReadsBlankAsKeep(t *testing.T) {
	var stderr bytes.Buffer
	blankPrompt := console{
		stderr:       &stderr,
		isTerminal:   func() bool { return true },
		readPassword: func() ([]byte, error) { return nil, nil },
	}
	s := &secret{name: "password", label: "SMTP password", keepable: true}

	if got, err := s.read(blankPrompt); err != nil || got != "" {
		t.Fatalf("blank at the prompt = %q, %v; want \"\"", got, err)
	}
	if want := "SMTP password (blank keeps the saved one): \n"; stderr.String() != want {
		t.Fatalf("prompt = %q, want %q", stderr.String(), want)
	}
	if got, err := s.read(pipedConsole(testSecretValue, &bytes.Buffer{})); err != nil || got != "" {
		t.Fatalf("no terminal and no flag = %q, %v; want \"\" without reading stdin", got, err)
	}

	s.fromStdin = true
	if _, err := s.read(pipedConsole("\n", &bytes.Buffer{})); err == nil || !strings.Contains(err.Error(), "empty") {
		t.Fatalf("an empty stdin = %v, want it refused", err)
	}
}
