package main

import (
	"log/slog"
	"os"

	"github.com/publira/publira/server/internal/auth"
)

// newWebServiceToken reads the credential the web apps call the console APIs'
// reads that answer every operator alike with: the admin API's tenant-level
// ones and the platform API's platform-level ones. Unset leaves both APIs to
// operator sessions alone.
func newWebServiceToken(logger *slog.Logger) *auth.ServiceToken {
	token := auth.NewServiceToken(os.Getenv("PUBLIRA_WEB_SERVICE_TOKEN"))
	if token == nil {
		logger.Info("web service token is disabled", "reason", "PUBLIRA_WEB_SERVICE_TOKEN is empty")
		return nil
	}
	logger.Info("web service token is enabled")
	return token
}
