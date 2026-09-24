package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"golang.org/x/term"
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
}

// Secret declares --<name>-stdin, the only flag through which the secret can
// be given; without it the secret is asked for at a masked prompt. No flag
// named after the secret itself exists, so --<name>=value is a usage error.
func (f *commandFlags) Secret(name, label string) *secret {
	s := &secret{name: name, label: label}
	f.BoolVar(&s.fromStdin, name+"-stdin", false, "read the "+label+" from the whole of stdin")
	f.secrets = append(f.secrets, s)
	return s
}

// checkSecretSources refuses more than one secret on stdin, which a single
// stream cannot tell apart.
func (f *commandFlags) checkSecretSources() error {
	var fromStdin []string
	for _, s := range f.secrets {
		if s.fromStdin {
			fromStdin = append(fromStdin, "-"+s.name+"-stdin")
		}
	}
	if len(fromStdin) > 1 {
		return fmt.Errorf("only one secret can be read from stdin per invocation, got %s", strings.Join(fromStdin, " and "))
	}
	return nil
}

// read takes the secret from stdin when its flag was given, else from a masked
// prompt on the terminal. One line break ending stdin is dropped, so
// `echo "$PASSWORD" | publiractl …` stores the password alone.
func (s *secret) read(con console) (string, error) {
	var value string
	switch {
	case s.fromStdin:
		raw, err := io.ReadAll(con.stdin)
		if err != nil {
			return "", fmt.Errorf("read the %s from stdin: %w", s.label, err)
		}
		value = strings.TrimSuffix(strings.TrimSuffix(string(raw), "\n"), "\r")
	case con.isTerminal():
		_, _ = fmt.Fprintf(con.stderr, "%s: ", s.label)
		raw, err := con.readPassword()
		_, _ = io.WriteString(con.stderr, "\n")
		if err != nil {
			return "", fmt.Errorf("read the %s: %w", s.label, err)
		}
		value = string(raw)
	default:
		return "", fmt.Errorf("stdin is not a terminal to prompt for the %s on; pipe it in with -%s-stdin", s.label, s.name)
	}
	if value == "" {
		return "", errors.New("the " + s.label + " is empty")
	}
	return value, nil
}
