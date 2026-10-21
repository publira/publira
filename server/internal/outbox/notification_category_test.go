package outbox

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strconv"
	"strings"
	"testing"
)

// Every notification_type this package declares is filed under a category, or
// its rows would answer to no preference. The types are read from the
// package's own source rather than listed here, so a NotificationType constant
// added without an entry in notificationCategories fails this test instead of
// the first fan-out that files one.
func TestEveryNotificationTypeHasACategory(t *testing.T) {
	declared := declaredNotificationTypes(t)
	if len(declared) == 0 {
		t.Fatal("found no NotificationType constants; the scan no longer matches how they are declared")
	}
	for name, value := range declared {
		if _, err := NotificationCategoryFor(value); err != nil {
			t.Errorf("%s (%q) has no category in notificationCategories", name, value)
		}
	}
	for notificationType := range notificationCategories {
		found := false
		for _, value := range declared {
			if value == notificationType {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("notificationCategories names %q, which no NotificationType constant declares", notificationType)
		}
	}
}

func TestNotificationCategoryForRefusesACategoryTheTypeIsNotFiledUnder(t *testing.T) {
	if _, err := NotificationCategoryFor(NotificationTypeCommentApproved, NotificationCategoryAnnouncements); err == nil {
		t.Fatal("NotificationCategoryFor(comment_approved, announcements) error = nil, want an error")
	}
	got, err := NotificationCategoryFor(NotificationTypeEpisodePublished, NotificationCategoryFollowedCreators)
	if err != nil {
		t.Fatalf("NotificationCategoryFor(episode_published, followed_creators): %v", err)
	}
	if got != string(NotificationCategoryFollowedCreators) {
		t.Fatalf("category = %q, want %q", got, NotificationCategoryFollowedCreators)
	}
}

// declaredNotificationTypes answers every string constant named
// NotificationType* in this package's non-test sources, by name.
func declaredNotificationTypes(t *testing.T) map[string]string {
	t.Helper()

	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read package directory: %v", err)
	}
	fset := token.NewFileSet()
	declared := map[string]string{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, entry.Name(), nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", entry.Name(), err)
		}
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.CONST {
				continue
			}
			for _, spec := range gen.Specs {
				value, ok := spec.(*ast.ValueSpec)
				if !ok {
					continue
				}
				for i, name := range value.Names {
					if !strings.HasPrefix(name.Name, "NotificationType") || i >= len(value.Values) {
						continue
					}
					literal, ok := value.Values[i].(*ast.BasicLit)
					if !ok || literal.Kind != token.STRING {
						continue
					}
					unquoted, err := strconv.Unquote(literal.Value)
					if err != nil {
						t.Fatalf("unquote %s: %v", name.Name, err)
					}
					declared[name.Name] = unquoted
				}
			}
		}
	}
	return declared
}
