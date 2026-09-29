package testutil

import (
	"bufio"
	"fmt"
	"net"
	"strings"
	"sync"
	"testing"
)

// SMTPServer is a plaintext SMTP server on the loopback that accepts every
// message without authentication and keeps what it was sent.
type SMTPServer struct {
	Host string
	Port int32

	mu       sync.Mutex
	messages []string
}

// StartSMTPServer serves until the test ends.
func StartSMTPServer(t *testing.T) *SMTPServer {
	t.Helper()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for SMTP: %v", err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	addr := ln.Addr().(*net.TCPAddr)
	s := &SMTPServer{Host: addr.IP.String(), Port: int32(addr.Port)} //nolint:gosec // a TCP port fits
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
		verb, _, _ := strings.Cut(strings.ToUpper(strings.TrimSpace(line)), " ")
		switch verb {
		case "EHLO", "HELO":
			reply("250 publira-test")
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
