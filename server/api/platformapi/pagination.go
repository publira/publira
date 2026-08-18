package platformapi

// toPage converts one direction's generated row type into the shape the handler
// renders. Keyset lists query a different type per scan direction, so the two
// results have to meet somewhere before the response is built.
func toPage[T, R any](rows []T, convert func(T) R) []R {
	page := make([]R, len(rows))
	for index, row := range rows {
		page[index] = convert(row)
	}
	return page
}
