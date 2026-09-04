package imageserver

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"errors"
)

const (
	imageEncryptionAlgorithm = "xor-hmac-sha256-v1"
	imageEncryptionDomain    = "publira:image:xor-hmac-sha256:v1\x00"
)

var errInvalidImageCipherMaterial = errors.New("invalid image cipher material")

// imageCipher encrypts an already-converted rendition immediately before it
// leaves the image server. Its key is deliberately derived from the short-lived
// JWT the viewer already has, rather than from a server-only secret: the
// canvas viewer can reproduce the stream to decode the response. This hides
// image signatures from passive image extraction, but is not DRM; a reader who
// can view a page can also recover its decoded pixels.
type imageCipher struct {
	rawToken string
	subject  string
}

func (c imageCipher) xor(data []byte, keyID string) ([]byte, error) {
	if c.rawToken == "" || c.subject == "" || keyID == "" {
		return nil, errInvalidImageCipherMaterial
	}

	keyMAC := hmac.New(sha256.New, []byte(c.rawToken))
	_, _ = keyMAC.Write([]byte(imageEncryptionDomain))
	_, _ = keyMAC.Write([]byte(c.subject))
	_, _ = keyMAC.Write([]byte{0})
	_, _ = keyMAC.Write([]byte(keyID))
	key := keyMAC.Sum(nil)

	out := make([]byte, len(data))
	var counter uint64
	for offset := 0; offset < len(data); {
		blockMAC := hmac.New(sha256.New, key)
		var blockCounter [8]byte
		binary.BigEndian.PutUint64(blockCounter[:], counter)
		_, _ = blockMAC.Write(blockCounter[:])
		stream := blockMAC.Sum(nil)
		for i := 0; i < len(stream) && offset < len(data); i++ {
			out[offset] = data[offset] ^ stream[i]
			offset++
		}
		counter++
	}
	return out, nil
}
