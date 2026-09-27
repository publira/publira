package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"golang.org/x/term"

	"github.com/publira/publira/server/internal/fielderr"
)

// console is the terminal a command reads secrets from and reports on.
type console struct {
	stdin  io.Reader
	stderr io.Writer
	// isTerminal reports whether stdin is a terminal, and readPassword reads
	// one line from it without echoing it.
	isTerminal   func() bool
	readPassword func() ([]byte, error)
}

func osConsole() console {
	fd := int(os.Stdin.Fd())
	return console{
		stdin:        os.Stdin,
		stderr:       os.Stderr,
		isTerminal:   func() bool { return term.IsTerminal(fd) },
		readPassword: func() ([]byte, error) { return term.ReadPassword(fd) },
	}
}

// secret is a value a command stores and never takes on its command line,
// where ps and the shell history would show it.
type secret struct {
	name      string
	label     string
	fromStdin bool
	// file is the path --<name>-file named, "" when it was not given.
	file string
	// keepable is a secret a command already has a saved value for, which
	// reads as "" when none is given.
	keepable bool
}

// Secret declares --<name>-stdin and --<name>-file, the only flags through
// which the secret can be given; without either the secret is asked for at a
// masked prompt. No flag named after the secret itself exists, so
// --<name>=value is a usage error.
func (f *commandFlags) Secret(name, label string) *secret {
	s := &secret{name: name, label: label}
	f.BoolVar(&s.fromStdin, name+"-stdin", false, "read the "+label+" from the whole of stdin")
	f.StringVar(&s.file, name+"-file", "", "read the "+label+" from the whole of the named `file`")
	f.secrets = append(f.secrets, s)
	return s
}

// KeepableSecret is [commandFlags.Secret] for a secret that replaces a saved
// one: left blank at the prompt, or not given where no terminal can prompt for
// it, it reads as "" and the saved one is kept.
func (f *commandFlags) KeepableSecret(name, label string) *secret {
	s := f.Secret(name, label)
	s.keepable = true
	return s
}

// given reports whether the secret was given through one of its flags rather
// than left to the prompt.
func (s *secret) given() bool {
	return s.fromStdin || s.file != ""
}

// source is the flag the secret was given through, and the stdin one when it
// was typed at the prompt, which has no flag of its own.
func (s *secret) source() string {
	if s.file != "" {
		return "--" + s.name + "-file"
	}
	return "--" + s.name + "-stdin"
}

// refusal names s's flag when err refuses field, and leaves every other
// refusal to named.
func (s *secret) refusal(err error, field string, named func(error) error) error {
	if fielderr.Field(err) == field {
		return fmt.Errorf("%s: %w", s.source(), err)
	}
	return named(err)
}

// checkSecretSources refuses a secret given through both of its flags, and
// more than one secret on stdin, which a single stream cannot tell apart. Any
// number of secrets can each come from a file.
func (f *commandFlags) checkSecretSources() error {
	var fromStdin []string
	for _, s := range f.secrets {
		if s.fromStdin && s.file != "" {
			return fmt.Errorf("--%[1]s-stdin and --%[1]s-file cannot both be given", s.name)
		}
		if s.fromStdin {
			fromStdin = append(fromStdin, "--"+s.name+"-stdin")
		}
	}
	if len(fromStdin) > 1 {
		return fmt.Errorf("only one secret can be read from stdin per invocation, got %s", strings.Join(fromStdin, " and "))
	}
	return nil
}

// read takes the secret from the file or stdin its flag named, else from a
// masked prompt on the terminal. One line break ending the file or stdin is
// dropped, so `echo "$PASSWORD" | publiractl …` stores the password alone.
func (s *secret) read(con console) (string, error) {
	var value string
	switch {
	case s.file != "":
		raw, err := os.ReadFile(s.file)
		if err != nil {
			return "", fmt.Errorf("read the %s from --%s-file: %w", s.label, s.name, err)
		}
		value = dropLineBreak(raw)
	case s.fromStdin:
		raw, err := io.ReadAll(con.stdin)
		if err != nil {
			return "", fmt.Errorf("read the %s from stdin: %w", s.label, err)
		}
		value = dropLineBreak(raw)
	case con.isTerminal():
		prompt := s.label
		if s.keepable {
			prompt += " (blank keeps the saved one)"
		}
		_, _ = fmt.Fprintf(con.stderr, "%s: ", prompt)
		raw, err := con.readPassword()
		_, _ = io.WriteString(con.stderr, "\n")
		if err != nil {
			return "", fmt.Errorf("read the %s: %w", s.label, err)
		}
		if s.keepable && len(raw) == 0 {
			return "", nil
		}
		value = string(raw)
	case s.keepable:
		return "", nil
	default:
		return "", fmt.Errorf("stdin is not a terminal to prompt for the %[1]s on; pipe it in with --%[2]s-stdin or name a file with --%[2]s-file", s.label, s.name)
	}
	if value == "" {
		return "", errors.New("the " + s.label + " is empty")
	}
	return value, nil
}

// dropLineBreak is raw without the one line break a shell or an editor ends it
// with.
func dropLineBreak(raw []byte) string {
	return strings.TrimSuffix(strings.TrimSuffix(string(raw), "\n"), "\r")
}
