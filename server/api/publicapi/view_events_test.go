package publicapi

import (
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
)

func cookieHeader(value string) http.Header {
	header := http.Header{}
	header.Set("Cookie", anonymousIDCookieName+"="+value)
	return header
}

func TestResolveViewActorPrefersSignedInMember(t *testing.T) {
	userID := uuid.Must(uuid.NewV7())
	cookieID := uuid.Must(uuid.NewV7())

	actor, minted := resolveViewActor(uuid.NullUUID{UUID: userID, Valid: true}, cookieHeader(cookieID.String()))

	if actor.userID.UUID != userID {
		t.Fatalf("user_id = %v, want %v", actor.userID, userID)
	}
	// A member's views must aggregate under the member, not under whichever
	// browser they happen to be reading in.
	if actor.anonymousID.Valid {
		t.Fatalf("anonymous_id = %v, want unset for a signed-in member", actor.anonymousID.UUID)
	}
	if minted != nil {
		t.Fatalf("minted cookie = %v, want none for a signed-in member", minted)
	}
}

func TestResolveViewActorReusesExistingCookie(t *testing.T) {
	cookieID := uuid.Must(uuid.NewV7())

	actor, minted := resolveViewActor(uuid.NullUUID{}, cookieHeader(cookieID.String()))

	if actor.anonymousID.UUID != cookieID {
		t.Fatalf("anonymous_id = %v, want the cookie's %v", actor.anonymousID.UUID, cookieID)
	}
	if minted != nil {
		t.Fatalf("minted cookie = %v, want none when the request already carries one", minted)
	}
}

func TestResolveViewActorMintsWhenCookieIsUnusable(t *testing.T) {
	tests := []struct {
		name   string
		header http.Header
	}{
		{name: "no-header", header: nil},
		{name: "no-cookie", header: http.Header{}},
		{name: "empty-value", header: cookieHeader("")},
		{name: "not-a-uuid", header: cookieHeader("not-a-uuid")},
		// The value reaches content_events.anonymous_id, so the all-zero UUID is
		// rejected the same way a malformed one is rather than becoming an actor
		// every anonymous reader shares.
		{name: "nil-uuid", header: cookieHeader(uuid.Nil.String())},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			actor, minted := resolveViewActor(uuid.NullUUID{}, tc.header)

			if !actor.anonymousID.Valid || actor.anonymousID.UUID == uuid.Nil {
				t.Fatalf("anonymous_id = %v, want a freshly minted identifier", actor.anonymousID)
			}
			if minted == nil {
				t.Fatal("minted cookie = nil, want the identifier handed back to the reader")
			}
			if minted.Value != actor.anonymousID.UUID.String() {
				t.Fatalf("cookie value = %q, want the recorded actor %q", minted.Value, actor.anonymousID.UUID)
			}
		})
	}
}

func TestAnonymousIDCookieKeepsMinimalAttributes(t *testing.T) {
	cookie := newAnonymousIDCookie(uuid.Must(uuid.NewV7()))

	if cookie.Name != "publira_aid" {
		t.Fatalf("name = %q, want publira_aid", cookie.Name)
	}
	if !cookie.HttpOnly {
		t.Fatal("HttpOnly = false, want the identifier hidden from client script")
	}
	if !cookie.Secure {
		t.Fatal("Secure = false, want the identifier kept off plain HTTP")
	}
	if cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("SameSite = %v, want Lax", cookie.SameSite)
	}
	if cookie.Path != "/" {
		t.Fatalf("Path = %q, want /", cookie.Path)
	}
	// Session cookies would restart the actor on every browser restart, and an
	// unbounded one would outlive any window that reads the events.
	if want := int(anonymousIDCookieMaxAge / time.Second); cookie.MaxAge != want {
		t.Fatalf("MaxAge = %d, want %d", cookie.MaxAge, want)
	}
}

func TestViewDebounceBucketIsAFixedEpochWindow(t *testing.T) {
	// 10:00:00Z is a bucket boundary: 1800 divides its Unix time exactly.
	boundary := time.Date(2026, time.March, 1, 10, 0, 0, 0, time.UTC)

	tests := []struct {
		name string
		at   time.Time
		want int64
	}{
		{name: "boundary", at: boundary, want: viewDebounceBucket(boundary)},
		{name: "one-second-later", at: boundary.Add(time.Second), want: viewDebounceBucket(boundary)},
		{name: "last-second-of-window", at: boundary.Add(viewDebounceWindow - time.Second), want: viewDebounceBucket(boundary)},
		{name: "next-window", at: boundary.Add(viewDebounceWindow), want: viewDebounceBucket(boundary) + 1},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := viewDebounceBucket(tc.at); got != tc.want {
				t.Fatalf("bucket(%s) = %d, want %d", tc.at, got, tc.want)
			}
		})
	}
}

// A sliding window would need the previous view to compute, which is exactly
// what the fixed epoch avoids: the same wall clock always lands in the same
// bucket regardless of the reader's local zone.
func TestViewDebounceBucketIgnoresTheLocationOfTheTimestamp(t *testing.T) {
	utc := time.Date(2026, time.March, 1, 10, 5, 0, 0, time.UTC)
	elsewhere := utc.In(time.FixedZone("JST", 9*60*60))

	if viewDebounceBucket(utc) != viewDebounceBucket(elsewhere) {
		t.Fatalf("bucket differs by location: %d vs %d", viewDebounceBucket(utc), viewDebounceBucket(elsewhere))
	}
}

func TestIsPrefetchRequest(t *testing.T) {
	tests := []struct {
		name   string
		header http.Header
		want   bool
	}{
		{name: "no-header", header: nil, want: false},
		{name: "plain-request", header: http.Header{}, want: false},
		{name: "sec-purpose", header: http.Header{"Sec-Purpose": []string{"prefetch"}}, want: true},
		{name: "sec-purpose-prerender", header: http.Header{"Sec-Purpose": []string{"prefetch;prerender"}}, want: true},
		{name: "purpose", header: http.Header{"Purpose": []string{"prefetch"}}, want: true},
		{name: "x-purpose", header: http.Header{"X-Purpose": []string{"preview"}}, want: true},
		{name: "x-moz", header: http.Header{"X-Moz": []string{"prefetch"}}, want: true},
		{name: "next-router", header: http.Header{"Next-Router-Prefetch": []string{"1"}}, want: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := isPrefetchRequest(tc.header); got != tc.want {
				t.Fatalf("isPrefetchRequest = %v, want %v", got, tc.want)
			}
		})
	}
}
