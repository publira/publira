// Package storeproduct names the consumable product a store sells an episode
// as. A product is a price tier rather than an episode, so a tenant creates one
// per price in App Store Connect and the Play Console, under the same ID in
// both.
package storeproduct

import "strconv"

// ProductID is the product an episode priced at price, in the minor unit of the
// tenant currency, is bought as. The ID names no currency: the tenant has one,
// and the store sets what each storefront charges for the product.
func ProductID(price int32) string {
	return "episode_" + strconv.FormatInt(int64(price), 10)
}
