package mailgun

import (
	"testing"

	"github.com/publira/publira/server/internal/inboundprovider"
)

// A token has to be remembered for as long as its signature verifies, or a
// captured signature could carry another mail once the token is forgotten.
func TestASignatureExpiresBeforeItsTokenIsForgotten(t *testing.T) {
	if signatureMaxAge+signatureMaxSkew > inboundprovider.ReplayKeyLifetime {
		t.Fatalf("a signature verifies for %v, but its token is remembered for %v", signatureMaxAge+signatureMaxSkew, inboundprovider.ReplayKeyLifetime)
	}
}
