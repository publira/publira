package adminapi

// A reorder request states the whole order twice: the order the client wants,
// and the order it read before composing it. Both lists are permutations of
// the same set, so each is checked with validateDistinctPublicIDs and then
// compared.

// samePublicIDSet reports whether two lists hold the same public IDs, in any
// order. Both have already been checked for duplicates, so equal lengths and
// one-way containment settle it.
func samePublicIDSet(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	want := make(map[string]struct{}, len(left))
	for _, id := range left {
		want[id] = struct{}{}
	}
	for _, id := range right {
		if _, ok := want[id]; !ok {
			return false
		}
	}
	return true
}
