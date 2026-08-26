package imageserver

import (
	"bytes"
	"errors"
	"testing"
)

func TestImageCipherXORRoundTrip(t *testing.T) {
	t.Parallel()

	plain := bytes.Repeat([]byte("converted-webp-payload"), 8)
	cipher := imageCipher{rawToken: "header.payload.signature", subject: "reader-public-id"}
	encrypted, err := cipher.xor(plain, "rendition-cache-key")
	if err != nil {
		t.Fatalf("xor encrypt: %v", err)
	}
	if bytes.Equal(encrypted, plain) {
		t.Fatal("encrypted bytes equal plaintext")
	}
	decrypted, err := cipher.xor(encrypted, "rendition-cache-key")
	if err != nil {
		t.Fatalf("xor decrypt: %v", err)
	}
	if !bytes.Equal(decrypted, plain) {
		t.Fatal("decrypted bytes differ from plaintext")
	}
}

func TestImageCipherSeparatesUsersAndRenditions(t *testing.T) {
	t.Parallel()

	plain := []byte("converted-image")
	first, err := (imageCipher{rawToken: "first-token", subject: "reader-a"}).xor(plain, "key-a")
	if err != nil {
		t.Fatalf("first xor: %v", err)
	}
	second, err := (imageCipher{rawToken: "second-token", subject: "reader-b"}).xor(plain, "key-a")
	if err != nil {
		t.Fatalf("second xor: %v", err)
	}
	if bytes.Equal(first, second) {
		t.Fatal("different credentials produced identical ciphertext")
	}
	otherRendition, err := (imageCipher{rawToken: "first-token", subject: "reader-a"}).xor(plain, "key-b")
	if err != nil {
		t.Fatalf("other rendition xor: %v", err)
	}
	if bytes.Equal(first, otherRendition) {
		t.Fatal("different renditions produced identical ciphertext")
	}
}

func TestImageCipherRejectsMissingMaterial(t *testing.T) {
	t.Parallel()

	_, err := (imageCipher{rawToken: "token"}).xor([]byte("image"), "key")
	if !errors.Is(err, errInvalidImageCipherMaterial) {
		t.Fatalf("missing subject error = %v, want %v", err, errInvalidImageCipherMaterial)
	}
}

func TestImageEncryptionEnabled(t *testing.T) {
	for raw, want := range map[string]bool{
		"":         false,
		"disabled": false,
		"false":    false,
		"enabled":  true,
		"ON":       true,
	} {
		t.Run(raw, func(t *testing.T) {
			t.Setenv("PUBLIRA_IMAGE_ENCRYPTION", raw)
			if got := imageEncryptionEnabled(); got != want {
				t.Fatalf("imageEncryptionEnabled() = %v, want %v", got, want)
			}
		})
	}
}
