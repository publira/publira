package testutil

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"fmt"
	"net"
	"strings"
	"sync"
	"testing"
)

// SMTPServer is a plaintext SMTP server on the loopback that keeps every
// message it accepts. It offers AUTH PLAIN and takes any credentials, and
// accepts a message whether or not the client authenticated.
type SMTPServer struct {
	Host string
	Port int32

	offersAuth bool
	mu         sync.Mutex
	messages   []string
	logins     []SMTPLogin
}

// SMTPLogin is a set of credentials a client authenticated with.
type SMTPLogin struct {
	Username string
	Password string
}

// StartSMTPServer serves until the test ends.
func StartSMTPServer(t *testing.T) *SMTPServer {
	t.Helper()
	return startSMTPServer(t, true)
}

// StartSMTPRelay is [StartSMTPServer] without AUTH: a relay that trusts
// whoever reaches it.
func StartSMTPRelay(t *testing.T) *SMTPServer {
	t.Helper()
	return startSMTPServer(t, false)
}

func startSMTPServer(t *testing.T, offersAuth bool) *SMTPServer {
	t.Helper()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for SMTP: %v", err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	addr := ln.Addr().(*net.TCPAddr)
	s := &SMTPServer{Host: addr.IP.String(), Port: int32(addr.Port), offersAuth: offersAuth} //nolint:gosec // a TCP port fits
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go s.serve(conn)
		}
	}()
	return s
}

// Messages are the DATA of every message accepted so far, headers and body,
// with the terminating dot removed.
func (s *SMTPServer) Messages() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.messages...)
}

// Logins are the credentials of every AUTH accepted so far.
func (s *SMTPServer) Logins() []SMTPLogin {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]SMTPLogin(nil), s.logins...)
}

func (s *SMTPServer) serve(conn net.Conn) {
	defer conn.Close() //nolint:errcheck
	r := bufio.NewReader(conn)
	reply := func(line string) { _, _ = fmt.Fprintf(conn, "%s\r\n", line) }

	reply("220 publira-test ESMTP")
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		verb, arg, _ := strings.Cut(strings.TrimSpace(line), " ")
		switch strings.ToUpper(verb) {
		case "EHLO":
			if s.offersAuth {
				reply("250-publira-test")
				reply("250 AUTH PLAIN")
			} else {
				reply("250 publira-test")
			}
		case "HELO":
			reply("250 publira-test")
		case "AUTH":
			login, ok := s.plainLogin(arg)
			if !ok {
				reply("504 Unrecognized authentication")
				continue
			}
			s.mu.Lock()
			s.logins = append(s.logins, login)
			s.mu.Unlock()
			reply("235 Authentication successful")
		case "MAIL", "RCPT", "RSET", "NOOP":
			reply("250 OK")
		case "DATA":
			reply("354 End data with <CR><LF>.<CR><LF>")
			var data strings.Builder
			for {
				line, err := r.ReadString('\n')
				if err != nil {
					return
				}
				if line == ".\r\n" {
					break
				}
				data.WriteString(strings.TrimPrefix(line, "."))
			}
			s.mu.Lock()
			s.messages = append(s.messages, data.String())
			s.mu.Unlock()
			reply("250 OK")
		case "QUIT":
			reply("221 Bye")
			return
		default:
			reply("502 Command not implemented")
		}
	}
}

// plainLogin reads the initial response of an AUTH PLAIN command.
func (s *SMTPServer) plainLogin(arg string) (SMTPLogin, bool) {
	mechanism, response, _ := strings.Cut(arg, " ")
	if !s.offersAuth || !strings.EqualFold(mechanism, "PLAIN") {
		return SMTPLogin{}, false
	}
	decoded, err := base64.StdEncoding.DecodeString(response)
	if err != nil {
		return SMTPLogin{}, false
	}
	parts := bytes.Split(decoded, []byte{0})
	if len(parts) != 3 {
		return SMTPLogin{}, false
	}
	return SMTPLogin{Username: string(parts[1]), Password: string(parts[2])}, true
}
