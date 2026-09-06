// Package push delivers one message to one device through Firebase Cloud
// Messaging's HTTP v1 API.
//
// FCM carries both platforms: Firebase relays to APNs for iOS once the APNs
// auth key is uploaded to the project, so the server keeps one integration
// instead of two. The legacy server key is gone, so every send is
// OAuth2-authenticated with a service account.
package push

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

// Scope FCM's send endpoint is authorized with.
const messagingScope = "https://www.googleapis.com/auth/firebase.messaging"

const defaultEndpoint = "https://fcm.googleapis.com"

const defaultTimeout = 15 * time.Second

// ErrTokenGone reports a registration token FCM will never accept again: the
// app was uninstalled, or the token was replaced. The caller deletes it rather
// than retrying, because no later attempt can succeed.
var ErrTokenGone = errors.New("push: registration token is no longer valid")

// Config builds a [Client]. Credentials are resolved once, at construction.
type Config struct {
	// ProjectID is the Firebase project the messages are sent to. Empty takes
	// the project the credentials name.
	ProjectID string
	// CredentialsJSON is a service account key. Empty falls back to
	// Application Default Credentials, which is what
	// GOOGLE_APPLICATION_CREDENTIALS configures.
	CredentialsJSON []byte
	// Endpoint replaces the FCM host, which is how the tests point a client at
	// a local server. Empty uses the real one.
	Endpoint string
	// HTTPClient carries the send. Nil builds one holding the OAuth2 token
	// source, with a timeout that bounds a stalled request.
	HTTPClient *http.Client
}

// Message is one notification for one device.
//
// Title and Body are what the OS renders while the app is backgrounded or
// terminated; Data is what the app routes from once it is opened.
type Message struct {
	Token string
	Title string
	Body  string
	Data  map[string]string
}

// Client sends to FCM on behalf of one Firebase project.
type Client struct {
	projectID string
	endpoint  string
	http      *http.Client
}

// New resolves the credentials and returns a client for cfg.
func New(ctx context.Context, cfg Config) (*Client, error) {
	creds, err := resolveCredentials(ctx, cfg.CredentialsJSON)
	if err != nil {
		return nil, err
	}

	projectID := strings.TrimSpace(cfg.ProjectID)
	if projectID == "" {
		projectID = strings.TrimSpace(creds.ProjectID)
	}
	if projectID == "" {
		return nil, errors.New("push: no FCM project id, and the credentials name none")
	}

	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = oauth2.NewClient(ctx, creds.TokenSource)
		httpClient.Timeout = defaultTimeout
	}

	endpoint := strings.TrimRight(strings.TrimSpace(cfg.Endpoint), "/")
	if endpoint == "" {
		endpoint = defaultEndpoint
	}

	return &Client{projectID: projectID, endpoint: endpoint, http: httpClient}, nil
}

func resolveCredentials(ctx context.Context, credentialsJSON []byte) (*google.Credentials, error) {
	if len(bytes.TrimSpace(credentialsJSON)) > 0 {
		// Pinned to a service account key rather than accepting any credential
		// shape: that is the only kind FCM HTTP v1 is authorized with, and the
		// library refuses an unvalidated configuration from anywhere else.
		creds, err := google.CredentialsFromJSONWithType(ctx, credentialsJSON, google.ServiceAccount, messagingScope)
		if err != nil {
			return nil, fmt.Errorf("push: read FCM credentials: %w", err)
		}
		return creds, nil
	}
	creds, err := google.FindDefaultCredentials(ctx, messagingScope)
	if err != nil {
		return nil, fmt.Errorf("push: find default FCM credentials: %w", err)
	}
	return creds, nil
}

// ProjectID is the Firebase project this client sends to.
func (c *Client) ProjectID() string {
	if c == nil {
		return ""
	}
	return c.projectID
}

// Send delivers msg to one device.
//
// It returns [ErrTokenGone] for a token FCM has answered for as revoked, and a
// plain error for everything else, which the caller retries.
func (c *Client) Send(ctx context.Context, msg Message) error {
	body, err := json.Marshal(sendRequest{Message: newFCMMessage(msg)})
	if err != nil {
		return fmt.Errorf("push: encode message: %w", err)
	}

	url := fmt.Sprintf("%s/v1/projects/%s/messages:send", c.endpoint, c.projectID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("push: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("push: send: %w", err)
	}
	defer res.Body.Close() //nolint:errcheck

	// Bounded so a misrouted response cannot pull an unbounded body into the
	// worker; an FCM answer of either shape is far smaller than this.
	payload, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("push: read response: %w", err)
	}
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return nil
	}
	return sendError(res.StatusCode, payload)
}

// tokenFieldPath is how FCM names the registration token in a field violation,
// which is the only thing that tells an unusable token apart from an unusable
// message.
const tokenFieldPath = "message.token"

// sendError turns an FCM error body into either [ErrTokenGone] or a retriable
// error.
//
// UNREGISTERED is a token the app no longer holds. INVALID_ARGUMENT is not, on
// its own: FCM answers with it for a malformed message as readily as for a
// malformed token, and this message carries a title, a body, and a data block,
// so taking the bare status for the token would let one unsendable episode
// delete every device of a tenant. It counts only when the error names the
// token field, which FCM reports in a google.rpc.BadRequest detail.
func sendError(statusCode int, payload []byte) error {
	var decoded errorResponse
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return fmt.Errorf("push: HTTP %d: %s", statusCode, truncate(string(payload)))
	}

	code := decoded.Error.Status
	namesToken := false
	for _, detail := range decoded.Error.Details {
		if strings.TrimSpace(detail.ErrorCode) != "" {
			code = detail.ErrorCode
		}
		for _, violation := range detail.FieldViolations {
			if strings.TrimSpace(violation.Field) == tokenFieldPath {
				namesToken = true
			}
		}
	}
	if code == "UNREGISTERED" || (code == "INVALID_ARGUMENT" && namesToken) {
		return fmt.Errorf("%w: %s", ErrTokenGone, code)
	}

	message := strings.TrimSpace(decoded.Error.Message)
	if message == "" {
		message = truncate(string(payload))
	}
	return fmt.Errorf("push: HTTP %d (%s): %s", statusCode, code, message)
}

func truncate(value string) string {
	const limit = 512
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}

type sendRequest struct {
	Message fcmMessage `json:"message"`
}

type fcmMessage struct {
	Token        string            `json:"token"`
	Notification fcmNotification   `json:"notification"`
	Data         map[string]string `json:"data,omitempty"`
	Android      fcmAndroidConfig  `json:"android"`
	APNS         fcmAPNSConfig     `json:"apns"`
}

type fcmNotification struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

type fcmAndroidConfig struct {
	Priority     string                 `json:"priority"`
	Notification fcmAndroidNotification `json:"notification"`
}

type fcmAndroidNotification struct {
	// The launcher activity declares this action, which is how a tap on a
	// notification the OS drew reaches the Flutter app rather than only
	// resuming it.
	ClickAction string `json:"click_action"`
}

type fcmAPNSConfig struct {
	Headers map[string]string `json:"headers"`
	Payload fcmAPNSPayload    `json:"payload"`
}

type fcmAPNSPayload struct {
	APS fcmAPS `json:"aps"`
}

type fcmAPS struct {
	Sound string `json:"sound"`
}

// clickAction is the intent action firebase_messaging listens for, and the
// value mobile/android/app/src/main/AndroidManifest.xml declares.
const clickAction = "FLUTTER_NOTIFICATION_CLICK"

func newFCMMessage(msg Message) fcmMessage {
	return fcmMessage{
		Token:        msg.Token,
		Notification: fcmNotification{Title: msg.Title, Body: msg.Body},
		Data:         msg.Data,
		Android: fcmAndroidConfig{
			Priority:     "high",
			Notification: fcmAndroidNotification{ClickAction: clickAction},
		},
		APNS: fcmAPNSConfig{
			// APNs drops a notification with no priority header for a device
			// that is asleep; 10 is "deliver now", which is what an alert the
			// reader is meant to see asks for.
			Headers: map[string]string{"apns-priority": "10"},
			Payload: fcmAPNSPayload{APS: fcmAPS{Sound: "default"}},
		},
	}
}

// errorResponse is the google.rpc.Status body FCM answers an error with. The
// details array is heterogeneous — a google.firebase.fcm.v1.FcmError carries
// the messaging error code, a google.rpc.BadRequest the field violations — so
// one struct reads both and the caller looks at whichever is present.
type errorResponse struct {
	Error struct {
		Message string `json:"message"`
		Status  string `json:"status"`
		Details []struct {
			ErrorCode       string `json:"errorCode"`
			FieldViolations []struct {
				Field string `json:"field"`
			} `json:"fieldViolations"`
		} `json:"details"`
	} `json:"error"`
}
