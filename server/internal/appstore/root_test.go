package appstore

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestTheEmbeddedRootIsApplesG3(t *testing.T) {
	sum := sha256.Sum256(appleRootCAG3)
	if got := hex.EncodeToString(sum[:]); got != "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179" {
		t.Fatalf("embedded root fingerprint = %s, want Apple Root CA - G3's", got)
	}
}
