package webpushsettings

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/golang-jwt/jwt/v5"

	"github.com/publira/publira/server/internal/push"
)

// receivedPush is one request as a push service receives it.
type receivedPush struct {
	path   string
	header http.Header
	body   []byte
}

// startPushEndpoint serves a push service on this machine that keeps every
// request and accepts it the way a real one does.
func startPushEndpoint(t *testing.T) (*httptest.Server, <-chan receivedPush) {
	t.Helper()
	received := make(chan receivedPush, 1)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		received <- receivedPush{path: r.URL.Path, header: r.Header.Clone(), body: body}
		w.WriteHeader(http.StatusCreated)
	}))
	t.Cleanup(server.Close)
	return server, received
}

// browser is the key material a browser keeps for one subscription.
type browser struct {
	key  *ecdh.PrivateKey
	auth []byte
}

func newBrowser(t *testing.T) browser {
	t.Helper()
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}
	auth := make([]byte, 16)
	if _, err := rand.Read(auth); err != nil {
		t.Fatalf("rand.Read: %v", err)
	}
	return browser{key: key, auth: auth}
}

func (b browser) subscription(endpoint string) push.WebPushSubscription {
	return push.WebPushSubscription{
		Endpoint: endpoint,
		P256dh:   base64.RawURLEncoding.EncodeToString(b.key.PublicKey().Bytes()),
		Auth:     base64.RawURLEncoding.EncodeToString(b.auth),
	}
}

// verifyVAPID checks an Authorization header the way a push service does
// (RFC 8292): the token is signed by publicKey, which the header also names,
// for the endpoint's origin, and names subject as the contact.
func verifyVAPID(header, publicKey, audience, subject string) error {
	token, key, ok := strings.Cut(strings.TrimPrefix(header, "vapid t="), ", k=")
	if !ok || !strings.HasPrefix(header, "vapid t=") {
		return fmt.Errorf("authorization %q is not a VAPID header", header)
	}
	if key != publicKey {
		return fmt.Errorf("header names public key %q, want the stored %q", key, publicKey)
	}
	point, err := base64.RawURLEncoding.DecodeString(publicKey)
	if err != nil {
		return fmt.Errorf("decode the stored public key: %w", err)
	}
	verifier, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), point)
	if err != nil {
		return fmt.Errorf("parse the stored public key: %w", err)
	}
	parsed, err := jwt.Parse(token, func(*jwt.Token) (any, error) { return verifier, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodES256.Alg()}),
		jwt.WithAudience(audience),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return fmt.Errorf("verify the token against the stored public key: %w", err)
	}
	sub, err := parsed.Claims.GetSubject()
	if err != nil || sub != subject {
		return fmt.Errorf("token subject = %q, %v; want %q", sub, err, subject)
	}
	return nil
}

// decrypt opens an aes128gcm body (RFC 8291) with the browser's keys.
func (b browser) decrypt(body []byte) ([]byte, error) {
	const saltLength, recordSizeLength = 16, 4
	if len(body) < saltLength+recordSizeLength+1 {
		return nil, errors.New("body is shorter than its header")
	}
	salt := body[:saltLength]
	recordSize := binary.BigEndian.Uint32(body[saltLength : saltLength+recordSizeLength])
	keyIDLength := int(body[saltLength+recordSizeLength])
	rest := body[saltLength+recordSizeLength+1:]
	if len(rest) < keyIDLength {
		return nil, errors.New("body is shorter than its key id")
	}
	serverKey, err := ecdh.P256().NewPublicKey(rest[:keyIDLength])
	if err != nil {
		return nil, fmt.Errorf("key id is not a P-256 point: %w", err)
	}
	ciphertext := rest[keyIDLength:]
	if uint32(len(ciphertext)) > recordSize {
		return nil, fmt.Errorf("ciphertext of %d bytes spans more than one %d-byte record", len(ciphertext), recordSize)
	}

	shared, err := b.key.ECDH(serverKey)
	if err != nil {
		return nil, fmt.Errorf("ECDH: %w", err)
	}
	keyInfo := append(append([]byte("WebPush: info\x00"), b.key.PublicKey().Bytes()...), serverKey.Bytes()...)
	ikm, err := hkdf.Key(sha256.New, shared, b.auth, string(keyInfo), 32)
	if err != nil {
		return nil, err
	}
	contentKey, err := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", 16)
	if err != nil {
		return nil, err
	}
	nonce, err := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", 12)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(contentKey)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	record, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("open the record: %w", err)
	}
	// The last record ends its content with 0x02 and pads with zeros.
	padded := bytes.TrimRight(record, "\x00")
	if len(padded) == 0 || padded[len(padded)-1] != 0x02 {
		return nil, errors.New("record has no last-record delimiter")
	}
	return padded[:len(padded)-1], nil
}

// deliver sends message through a Senders over the stored settings, building
// each client with newClient before pointing it at endpoint.
func deliver(t *testing.T, store *fakeStore, endpoint *httptest.Server, newClient NewClient, subscription push.WebPushSubscription, message push.WebPushMessage) {
	t.Helper()
	senders := NewSenders(store, testEncryptor(t), func(cfg push.WebPushConfig) (*push.WebPushClient, error) {
		cfg.HTTPClient = endpoint.Client()
		return newClient(cfg)
	}, 0, slog.Default())
	if err := senders.Send(context.Background(), subscription, message); err != nil {
		t.Fatalf("Send: %v", err)
	}
}

func storeConfigured(t *testing.T, subject string) *fakeStore {
	t.Helper()
	store := &fakeStore{}
	if _, err := Ensure(context.Background(), store, testEncryptor(t)); err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	store.saveSubject(subject)
	return store
}

// A delivery is one a browser accepts: the push service can verify its VAPID
// signature against the stored public key, and the subscription's keys open
// the payload the worker wrote.
func TestSendersDeliverWhatABrowserAccepts(t *testing.T) {
	t.Parallel()

	for _, subject := range []string{"mailto:push@example.com", "https://example.com/contact"} {
		t.Run(subject, func(t *testing.T) {
			t.Parallel()

			store := storeConfigured(t, subject)
			endpoint, received := startPushEndpoint(t)
			reader := newBrowser(t)
			message := push.WebPushMessage{Title: "New episode", Body: "Episode 2 is out", Data: map[string]string{"url": "/series/abc/episodes/def"}}

			deliver(t, store, endpoint, NewPushClient, reader.subscription(endpoint.URL+"/push/subscription"), message)

			got := <-received
			if got.path != "/push/subscription" {
				t.Fatalf("delivered to %q, want the subscription's endpoint", got.path)
			}
			if err := verifyVAPID(got.header.Get("Authorization"), store.row.VapidPublicKey, endpoint.URL, subject); err != nil {
				t.Fatal(err)
			}
			if encoding := got.header.Get("Content-Encoding"); encoding != "aes128gcm" {
				t.Fatalf("Content-Encoding = %q, want aes128gcm", encoding)
			}
			plaintext, err := reader.decrypt(got.body)
			if err != nil {
				t.Fatalf("the subscription's keys do not open the payload: %v", err)
			}
			var opened push.WebPushMessage
			if err := json.Unmarshal(plaintext, &opened); err != nil {
				t.Fatalf("payload %q is not a message: %v", plaintext, err)
			}
			if !reflect.DeepEqual(opened, message) {
				t.Fatalf("payload = %+v, want %+v", opened, message)
			}
		})
	}
}

// The checks above would be worthless if they accepted a delivery signed or
// encrypted with the wrong keys, so each tampering here has to be caught.
func TestDeliveryChecksRefuseTheWrongKeys(t *testing.T) {
	t.Parallel()

	const subject = "https://example.com/contact"
	store := storeConfigured(t, subject)
	endpoint, received := startPushEndpoint(t)
	reader := newBrowser(t)

	t.Run("signed with a key other than the stored one", func(t *testing.T) {
		otherPrivate, otherPublic, err := webpush.GenerateVAPIDKeys()
		if err != nil {
			t.Fatalf("generate a VAPID key pair: %v", err)
		}
		deliver(t, store, endpoint, func(cfg push.WebPushConfig) (*push.WebPushClient, error) {
			cfg.VAPIDPublicKey, cfg.VAPIDPrivateKey = otherPublic, otherPrivate
			return push.NewWebPushClient(cfg)
		}, reader.subscription(endpoint.URL), push.WebPushMessage{Title: "New episode"})

		got := <-received
		if err := verifyVAPID(got.header.Get("Authorization"), store.row.VapidPublicKey, endpoint.URL, subject); err == nil {
			t.Fatal("verifyVAPID accepted a token signed with another key")
		}
	})

	t.Run("encrypted to keys other than the subscription's", func(t *testing.T) {
		deliver(t, store, endpoint, NewPushClient, newBrowser(t).subscription(endpoint.URL), push.WebPushMessage{Title: "New episode"})

		got := <-received
		if _, err := reader.decrypt(got.body); err == nil {
			t.Fatal("decrypt opened a payload encrypted to another subscription's keys")
		}
	})
}
