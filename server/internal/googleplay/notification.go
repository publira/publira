package googleplay

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
)

// Product types a voided purchase notification names.
const (
	VoidedProductTypeSubscription = 1
	VoidedProductTypeOneTime      = 2
)

// ErrMalformedNotification reports a push that cannot be read as a real-time
// developer notification.
var ErrMalformedNotification = errors.New("googleplay: the notification is malformed")

// DeveloperNotification is a real-time developer notification, as the data of
// the Pub/Sub message Google Play publishes carries it. Exactly one of its
// notifications is set.
type DeveloperNotification struct {
	PackageName                string                      `json:"packageName"`
	SubscriptionNotification   *SubscriptionNotification   `json:"subscriptionNotification"`
	VoidedPurchaseNotification *VoidedPurchaseNotification `json:"voidedPurchaseNotification"`
	TestNotification           *struct{}                   `json:"testNotification"`
}

// SubscriptionNotification says that the subscription a purchase token names
// changed. Its type says how, which the subscription itself says too.
type SubscriptionNotification struct {
	NotificationType int    `json:"notificationType"`
	PurchaseToken    string `json:"purchaseToken"`
}

// VoidedPurchaseNotification says that Google Play refunded, canceled, or
// charged back a purchase.
type VoidedPurchaseNotification struct {
	PurchaseToken string `json:"purchaseToken"`
	OrderID       string `json:"orderId"`
	ProductType   int    `json:"productType"`
}

// Push is the body of a Cloud Pub/Sub push.
type Push struct {
	MessageID    string
	Notification DeveloperNotification
}

// ParsePush reads the body Cloud Pub/Sub pushes, and the notification its
// message carries.
func ParsePush(body []byte) (Push, error) {
	var envelope struct {
		Message struct {
			Data      string `json:"data"`
			MessageID string `json:"messageId"`
		} `json:"message"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return Push{}, fmt.Errorf("%w: %v", ErrMalformedNotification, err)
	}
	data, err := base64.StdEncoding.DecodeString(envelope.Message.Data)
	if err != nil {
		return Push{}, fmt.Errorf("%w: message data: %v", ErrMalformedNotification, err)
	}
	var notification DeveloperNotification
	if err := json.Unmarshal(data, &notification); err != nil {
		return Push{}, fmt.Errorf("%w: %v", ErrMalformedNotification, err)
	}
	if notification.PackageName == "" {
		return Push{}, fmt.Errorf("%w: names no app", ErrMalformedNotification)
	}
	return Push{MessageID: envelope.Message.MessageID, Notification: notification}, nil
}
