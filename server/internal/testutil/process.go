package testutil

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"testing"
	"time"
)

// mainChildArg marks a test binary that [StartMain] or [RunMain] re-executed
// to run the command's main instead of its tests.
const mainChildArg = "-publira.run-main"

// RunMainIfChild runs main and reports true when this test binary is such a
// child. A command's TestMain calls it first, so the child sees os.Args as the
// command itself would: its own path followed by the arguments it was given.
func RunMainIfChild(main func()) bool {
	if len(os.Args) < 2 || os.Args[1] != mainChildArg {
		return false
	}
	os.Args = append([]string{os.Args[0]}, os.Args[2:]...)
	main()
	return true
}

// Process is a command started by [StartMain].
type Process struct {
	cmd    *exec.Cmd
	output *syncBuffer
	done   chan struct{}
	err    error
}

// Output returns everything the process has written so far.
func (p *Process) Output() string { return p.output.String() }

// StartMain starts the current test binary's command in a child process whose
// environment is env and nothing else, so no variable of the test's own
// environment can stand in for one the command needs. The process is stopped
// with SIGTERM when the test ends.
func StartMain(t *testing.T, env []string, args ...string) *Process {
	t.Helper()
	cmd, output := mainCommand(t, env, args)
	if err := cmd.Start(); err != nil {
		t.Fatalf("start %s: %v", os.Args[0], err)
	}
	p := &Process{cmd: cmd, output: output, done: make(chan struct{})}
	go func() {
		p.err = cmd.Wait()
		close(p.done)
	}()
	t.Cleanup(func() {
		_ = cmd.Process.Signal(syscall.SIGTERM)
		select {
		case <-p.done:
		case <-time.After(15 * time.Second):
			_ = cmd.Process.Kill()
			<-p.done
		}
		if t.Failed() {
			t.Logf("process output:\n%s", p.Output())
		}
	})
	return p
}

// WaitReady polls url until it answers 200, failing the test if the process
// exits or the deadline passes first.
func (p *Process) WaitReady(t *testing.T, url string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			t.Fatalf("readiness request: %v", err)
		}
		if resp, err := http.DefaultClient.Do(req); err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return
			}
		}
		select {
		case <-p.done:
			t.Fatalf("process exited before %s was ready: %v", url, p.err)
		case <-ctx.Done():
			t.Fatalf("%s was not ready within the deadline", url)
		case <-time.After(100 * time.Millisecond):
		}
	}
}

// RunMain runs the current test binary's command to completion with env as its
// whole environment, and returns its exit code and output.
func RunMain(t *testing.T, env []string, args ...string) (int, string) {
	t.Helper()
	cmd, output := mainCommand(t, env, args)
	err := cmd.Run()
	var exitErr *exec.ExitError
	switch {
	case err == nil:
		return 0, output.String()
	case errors.As(err, &exitErr):
		return exitErr.ExitCode(), output.String()
	default:
		t.Fatalf("run %s: %v", os.Args[0], err)
		return 0, ""
	}
}

func mainCommand(t *testing.T, env, args []string) (*exec.Cmd, *syncBuffer) {
	t.Helper()
	output := &syncBuffer{}
	cmd := exec.CommandContext(t.Context(), os.Args[0], append([]string{mainChildArg}, args...)...)
	cmd.Env = env
	cmd.Stdout = output
	cmd.Stderr = output
	return cmd, output
}

// FreeAddr returns a loopback address with a port nothing is listening on.
func FreeAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve a port: %v", err)
	}
	addr := l.Addr().String()
	if err := l.Close(); err != nil {
		t.Fatalf("release %s: %v", addr, err)
	}
	return addr
}

// DeploymentSecrets returns the bootstrap secrets a standard deployment sets
// for every server process.
func DeploymentSecrets() map[string]string {
	return map[string]string{
		"PUBLIRA_AUTH_JWT_SECRET":                  "startup-test-jwt-secret-at-least-32-bytes",
		"PUBLIRA_SECRET_ENCRYPTION_KEYS":           "k1:" + base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32)),
		"PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID": "k1",
		"PUBLIRA_REVALIDATE_TOKEN":                 "startup-test-revalidate-token",
	}
}

// Env merges groups of variables into the KEY=value list exec.Cmd.Env takes.
func Env(groups ...map[string]string) []string {
	var env []string
	for _, vars := range groups {
		for k, v := range vars {
			env = append(env, fmt.Sprintf("%s=%s", k, v))
		}
	}
	return env
}

type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}
