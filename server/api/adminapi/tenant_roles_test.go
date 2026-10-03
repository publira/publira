package adminapi

import (
	"bufio"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"

	"github.com/publira/publira/server/internal/auth"
	_ "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
)

// levelHelpers maps each level helper to the role it names.
var levelHelpers = map[string]string{
	"requireTenantAdmin":   auth.RoleTenantAdmin,
	"requireTenantEditor":  auth.RoleTenantEditor,
	"requireTenantAuditor": auth.RoleTenantAuditor,
}

// levelFreeProcedures are the AdminAuthService RPCs that carry no level: they
// run before a session exists, or act on the caller's own account and nothing
// of the tenant's.
var levelFreeProcedures = []string{
	"/publira.admin.v1.AdminAuthService/Login",
	"/publira.admin.v1.AdminAuthService/Logout",
	"/publira.admin.v1.AdminAuthService/RequestPasswordReset",
	"/publira.admin.v1.AdminAuthService/ConfirmPasswordReset",
	"/publira.admin.v1.AdminAuthService/GetMe",
	"/publira.admin.v1.AdminAuthService/GetTenantByDomain",
	"/publira.admin.v1.AdminAuthService/GetTenantAdminInvitationState",
	"/publira.admin.v1.AdminAuthService/AcceptTenantAdminInvitation",
	"/publira.admin.v1.AdminAuthService/RequestEmailChange",
	"/publira.admin.v1.AdminAuthService/ConfirmEmailChange",
	"/publira.admin.v1.AdminAuthService/VerifyMfa",
	"/publira.admin.v1.AdminAuthService/GetMfaStatus",
	"/publira.admin.v1.AdminAuthService/StartMfaEnrollment",
	"/publira.admin.v1.AdminAuthService/ConfirmMfaEnrollment",
	"/publira.admin.v1.AdminAuthService/DisableMfa",
	"/publira.admin.v1.AdminAuthService/RegenerateMfaRecoveryCodes",
}

var (
	protoServicePattern = regexp.MustCompile(`^service (\w+) \{`)
	protoRPCPattern     = regexp.MustCompile(`^\s*rpc (\w+)\(`)
	protoLevelPattern   = regexp.MustCompile(`^\s*// Minimum role: (\w+)\.$`)
)

// adminRPCLevels reads, from the proto sources, the level every
// publira.admin.v1 RPC names in its comment, keyed by procedure. An RPC whose
// comment names none maps to "".
func adminRPCLevels(t *testing.T) map[string]string {
	t.Helper()

	paths, err := filepath.Glob(filepath.Join("..", "..", "..", "proto", "publira", "admin", "v1", "*.proto"))
	if err != nil {
		t.Fatalf("glob the admin protos: %v", err)
	}
	if len(paths) == 0 {
		t.Fatal("found no admin proto under proto/publira/admin/v1")
	}

	levels := map[string]string{}
	for _, path := range paths {
		file, err := os.Open(path)
		if err != nil {
			t.Fatalf("open %s: %v", path, err)
		}
		service, level := "", ""
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			line := scanner.Text()
			if match := protoServicePattern.FindStringSubmatch(line); match != nil {
				service, level = match[1], ""
				continue
			}
			if match := protoLevelPattern.FindStringSubmatch(line); match != nil {
				level = match[1]
				continue
			}
			if match := protoRPCPattern.FindStringSubmatch(line); match != nil && service != "" {
				levels["/publira.admin.v1."+service+"/"+match[1]] = level
			}
			// The level line is the last of the comment over its RPC, so
			// anything but a comment between the two drops it.
			if !strings.HasPrefix(strings.TrimSpace(line), "//") {
				level = ""
			}
		}
		if err := scanner.Err(); err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		_ = file.Close()
	}

	// The registry is what the server is generated from, so a proto the
	// scanner above misreads shows up as a difference here.
	var registered []string
	protoregistry.GlobalFiles.RangeFilesByPackage("publira.admin.v1", func(file protoreflect.FileDescriptor) bool {
		services := file.Services()
		for i := range services.Len() {
			methods := services.Get(i).Methods()
			for j := range methods.Len() {
				method := methods.Get(j)
				registered = append(registered, "/"+string(method.Parent().FullName())+"/"+string(method.Name()))
			}
		}
		return true
	})
	read := make([]string, 0, len(levels))
	for procedure := range levels {
		read = append(read, procedure)
	}
	slices.Sort(registered)
	slices.Sort(read)
	if !slices.Equal(read, registered) {
		t.Fatalf("the RPCs read from the proto sources differ from the registered ones\nread:       %v\nregistered: %v", read, registered)
	}
	return levels
}

// levelHelperCalls counts, for every function and method of this package, the
// calls it makes to each level helper.
func levelHelperCalls(t *testing.T) map[string]map[string]int {
	t.Helper()

	fset := token.NewFileSet()
	paths, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatalf("glob the package sources: %v", err)
	}
	calls := map[string]map[string]int{}
	for _, path := range paths {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", path, err)
		}
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			name := fn.Name.Name
			if fn.Recv != nil {
				name = "adminServer." + name
			}
			ast.Inspect(fn.Body, func(node ast.Node) bool {
				call, ok := node.(*ast.CallExpr)
				if !ok {
					return true
				}
				selector, ok := call.Fun.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				if _, ok := levelHelpers[selector.Sel.Name]; ok {
					if calls[name] == nil {
						calls[name] = map[string]int{}
					}
					calls[name][selector.Sel.Name]++
				}
				return true
			})
		}
	}
	return calls
}

func TestEveryAdminRPCRequiresItsLevel(t *testing.T) {
	levels := adminRPCLevels(t)
	calls := levelHelperCalls(t)

	handlers := map[string]bool{}
	for procedure, level := range levels {
		method := procedure[strings.LastIndex(procedure, "/")+1:]
		handler := "adminServer." + method
		handlers[handler] = true
		made := calls[handler]

		if slices.Contains(levelFreeProcedures, procedure) {
			if level != "" {
				t.Errorf("%s names %s in its proto but is listed as an RPC without a level", procedure, level)
			}
			if len(made) != 0 {
				t.Errorf("%s calls %v but is listed as an RPC without a level", procedure, made)
			}
			continue
		}

		if !slices.Contains([]string{auth.RoleTenantAdmin, auth.RoleTenantEditor, auth.RoleTenantAuditor}, level) {
			t.Errorf("%s names no level in its proto comment; end the comment with \"Minimum role: tenant_<level>.\"", procedure)
			continue
		}
		total := 0
		for helper, count := range made {
			total += count
			if levelHelpers[helper] != level {
				t.Errorf("%s calls %s, but its proto names %s", procedure, helper, level)
			}
		}
		if total != 1 {
			t.Errorf("%s calls a level helper %d times (%v), want exactly once", procedure, total, made)
		}
	}

	// A helper that checks the level on a handler's behalf hides it from the
	// handler, and from this test.
	for function, made := range calls {
		if !handlers[function] {
			t.Errorf("%s calls %v; only an RPC handler calls a level helper", function, made)
		}
	}
}

func TestServiceProceduresAreAuditorReads(t *testing.T) {
	levels := adminRPCLevels(t)
	for procedure := range serviceProcedures {
		if levels[procedure] != auth.RoleTenantAuditor {
			t.Errorf("%s is open to the service credential at level %q; only tenant_auditor reads may be", procedure, levels[procedure])
		}
	}
}
