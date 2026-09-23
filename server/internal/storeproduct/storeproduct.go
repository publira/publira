// Package storeproduct names the consumable product a store sells an episode
// as. A product is a price tier rather than an episode, so a tenant creates one
// per price in App Store Connect and the Play Console, under the same ID in
// both.
package storeproduct

import "strconv"

// ProductID is the product an episode priced at price JPY is bought as.
func ProductID(price int32) string {
	return "episode_" + strconv.FormatInt(int64(price), 10)
}
