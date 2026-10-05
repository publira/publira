package maintenance

import (
	"context"
	"errors"

	"github.com/publira/publira/server/internal/platformsearch"
)

// SearchIndexBuild builds the catalog index on the search engine the platform
// saved, when the search does not answer from it yet, and moves the search onto
// it once the index holds the catalog. A pass with nothing to build does
// nothing, and so does one that finds another build holding the lock.
//
// A build that fails is recorded on the platform's search settings and tried
// again on the next pass, so an engine an operator fixes — a plugin installed,
// a credential corrected — is picked up without saving the settings again.
type SearchIndexBuild struct{}

// Run builds the index if one is due.
func (SearchIndexBuild) Run(ctx context.Context, deps Deps) error {
	if deps.DB == nil {
		return errNoDB
	}
	logger := deps.logger()
	result, err := platformsearch.Build(ctx, platformsearch.BuildParams{
		DB:      deps.DB,
		Secrets: deps.Secrets,
		Logger:  logger,
	})
	switch {
	case errors.Is(err, platformsearch.ErrBuildRunning):
		logger.InfoContext(ctx, "search index build skipped; another build is running")
		return nil
	case err != nil:
		logger.ErrorContext(ctx, "search index build failed", "error", err)
		return err
	case !result.Built:
		return nil
	}
	logger.InfoContext(ctx, "search index build completed",
		"alias", result.Alias,
		"index", result.Index,
		"serving", result.Serving,
	)
	return nil
}
