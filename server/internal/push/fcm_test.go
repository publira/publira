package push

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSendPostsTheProjectMessageEndpoint(t *testing.T) {
	var gotPath string
	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read request: %v", err)
		}
		if err := json.Unmarshal(body, &gotBody); err != nil {
			t.Errorf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"name":"projects/publira/messages/1"}`))
	}))
	defer server.Close()

	client := newTestClient(t, server)
	err := client.Send(context.Background(), Message{
		Token: "device-token",
		Title: "Seed Series 001",
		Body:  "Episode 3",
		Data:  map[string]string{"route": "/series/S1/episodes/E1"},
	})
	if err != nil {
		t.Fatalf("send: %v", err)
	}

	if want := "/v1/projects/publira-test/messages:send"; gotPath != want {
		t.Fatalf("path = %q, want %q", gotPath, want)
	}
	message, ok := gotBody["message"].(map[string]any)
	if !ok {
		t.Fatalf("body = %v, want a message object", gotBody)
	}
	if message["token"] != "device-token" {
		t.Fatalf("token = %v", message["token"])
	}
	notification, ok := message["notification"].(map[string]any)
	if !ok {
		t.Fatalf("notification = %v", message["notification"])
	}
	if notification["title"] != "Seed Series 001" || notification["body"] != "Episode 3" {
		t.Fatalf("notification = %v", notification)
	}
	data, ok := message["data"].(map[string]any)
	if !ok {
		t.Fatalf("data = %v", message["data"])
	}
	if data["route"] != "/series/S1/episodes/E1" {
		t.Fatalf("data = %v", data)
	}
}

func TestSendReportsARevokedTokenAsGone(t *testing.T) {
	tests := []struct {
		name       string
		statusCode int
		body       string
	}{
		{
			name:       "unregistered",
			statusCode: http.StatusNotFound,
			body:       `{"error":{"code":404,"status":"NOT_FOUND","message":"Requested entity was not found.","details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"UNREGISTERED"}]}}`,
		},
		{
			name:       "invalid argument naming the token field",
			statusCode: http.StatusBadRequest,
			body: `{"error":{"code":400,"status":"INVALID_ARGUMENT","message":"Request contains an invalid argument.","details":[` +
				`{"@type":"type.googleapis.com/google.rpc.BadRequest","fieldViolations":[{"field":"message.token","description":"Invalid registration token"}]},` +
				`{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"INVALID_ARGUMENT"}]}}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tt.statusCode)
				_, _ = w.Write([]byte(tt.body))
			}))
			defer server.Close()

			err := newTestClient(t, server).Send(context.Background(), Message{Token: "gone"})
			if !errors.Is(err, ErrTokenGone) {
				t.Fatalf("send error = %v, want ErrTokenGone", err)
			}
		})
	}
}

func TestSendKeepsADeviceWhenOnlyTheMessageWasRejected(t *testing.T) {
	// FCM answers INVALID_ARGUMENT for a malformed message as readily as for a
	// malformed token. Taking the bare status for the token would delete every
	// device of a tenant over one unsendable episode.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"code":400,"status":"INVALID_ARGUMENT","message":"Invalid value at 'message.notification.title'.","details":[` +
			`{"@type":"type.googleapis.com/google.rpc.BadRequest","fieldViolations":[{"field":"message.notification.title","description":"Invalid value"}]},` +
			`{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"INVALID_ARGUMENT"}]}}`))
	}))
	defer server.Close()

	err := newTestClient(t, server).Send(context.Background(), Message{Token: "device-token"})
	if err == nil {
		t.Fatal("send error = nil, want an error")
	}
	if errors.Is(err, ErrTokenGone) {
		t.Fatalf("send error = %v, want the device kept", err)
	}
}

func TestSendReportsAnOutageAsRetriable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":{"code":503,"status":"UNAVAILABLE","message":"The service is unavailable."}}`))
	}))
	defer server.Close()

	err := newTestClient(t, server).Send(context.Background(), Message{Token: "device-token"})
	if err == nil {
		t.Fatal("send error = nil, want an error")
	}
	if errors.Is(err, ErrTokenGone) {
		t.Fatalf("send error = %v, want a retriable error", err)
	}
}

func TestSendReportsANonJSONBodyAsRetriable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("<html>gateway</html>"))
	}))
	defer server.Close()

	err := newTestClient(t, server).Send(context.Background(), Message{Token: "device-token"})
	if err == nil || errors.Is(err, ErrTokenGone) {
		t.Fatalf("send error = %v, want a retriable error", err)
	}
}

// newTestClient points a client at server and skips the OAuth2 exchange by
// supplying the HTTP client itself, which is what a real deployment gets from
// the token source.
func newTestClient(t *testing.T, server *httptest.Server) *Client {
	t.Helper()
	return &Client{
		projectID: "publira-test",
		endpoint:  server.URL,
		http:      server.Client(),
	}
}
