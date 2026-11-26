package adminapi

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/auth"
)

var protoStepUpPattern = regexp.MustCompile(`^\s*// Requires a recent re-authentication\.$`)

// stepUpProceduresInProto reads, from the proto sources, every
// publira.admin.v1 RPC whose comment says it requires a recent
// re-authentication.
func stepUpProceduresInProto(t *testing.T) []string {
	t.Helper()

	paths, err := filepath.Glob(filepath.Join("..", "..", "..", "proto", "publira", "admin", "v1", "*.proto"))
	if err != nil {
		t.Fatalf("glob the admin protos: %v", err)
	}
	var marked []string
	for _, path := range paths {
		file, err := os.Open(path)
		if err != nil {
			t.Fatalf("open %s: %v", path, err)
		}
		service, stepUp := "", false
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			line := scanner.Text()
			if match := protoServicePattern.FindStringSubmatch(line); match != nil {
				service, stepUp = match[1], false
				continue
			}
			if protoStepUpPattern.MatchString(line) {
				stepUp = true
				continue
			}
			if match := protoRPCPattern.FindStringSubmatch(line); match != nil && service != "" {
				if stepUp {
					marked = append(marked, "/publira.admin.v1."+service+"/"+match[1])
				}
				stepUp = false
				continue
			}
			if !strings.HasPrefix(strings.TrimSpace(line), "//") {
				stepUp = false
			}
		}
		if err := scanner.Err(); err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		_ = file.Close()
	}
	slices.Sort(marked)
	return marked
}

// The procedures that ask for a step-up token are the ones whose proto
// comment says so, every one of them is a tenant_admin's, and none of them is
// open to a credential that no person types a password for.
func TestStepUpProceduresMatchTheirProtoComments(t *testing.T) {
	listed := make([]string, 0, len(stepUpProcedures))
	for procedure := range stepUpProcedures {
		listed = append(listed, procedure)
	}
	slices.Sort(listed)
	if marked := stepUpProceduresInProto(t); !slices.Equal(listed, marked) {
		t.Fatalf("stepUpProcedures differs from the RPCs whose proto comment says \"Requires a recent re-authentication.\"\nlisted: %v\nproto:  %v", listed, marked)
	}

	levels := adminRPCLevels(t)
	for _, procedure := range listed {
		if levels[procedure] != auth.RoleTenantAdmin {
			t.Errorf("%s asks for a step-up at level %q; every such RPC is tenant_admin, which is what lets a weaker role reach the handler's own refusal", procedure, levels[procedure])
		}
		if _, ok := apiKeyProcedures[procedure]; ok {
			t.Errorf("%s asks for a step-up and is open to an API key, which has no password to re-authenticate with", procedure)
		}
		if _, ok := serviceProcedures[procedure]; ok {
			t.Errorf("%s asks for a step-up and is open to the service credential", procedure)
		}
	}
}
