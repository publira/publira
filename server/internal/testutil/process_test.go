package testutil

import (
	"errors"
	"net"
	"syscall"
	"testing"
	"time"
)

// The port is held without being listened on, so a connection to it is
// refused rather than left waiting in a backlog nothing accepts from.
func TestUnreachableAddrRefusesConnections(t *testing.T) {
	addr := UnreachableAddr(t)

	_, err := net.DialTimeout("tcp", addr, time.Second)
	if !errors.Is(err, syscall.ECONNREFUSED) {
		t.Fatalf("dial %s = %v, want %v", addr, err, syscall.ECONNREFUSED)
	}
}
