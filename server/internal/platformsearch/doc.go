// Package platformsearch resolves the catalog search engine every process uses
// from the platform's saved search configuration, the way platformstorage
// resolves the object store.
//
// The row holds two configurations: the one an operator saved and the one the
// search answers from. They differ while the worker builds the index a save
// names on a target the search has not used before, and the search moves onto
// it only once that index holds the catalog ([Build]). Until then the server
// keeps answering from the previous target ([Searcher]), and the worker writes
// every catalog change into both ([Indexer]).
//
// The platform API's PlatformSearchSettingsService and publiractl search are
// adapters over [Save] and [Tester]. A refusal of what the caller asked for is
// a [*fielderr.Invalid] naming the field at fault, or [ErrConflict]; any other
// error is the database's or the engine's.
package platformsearch
