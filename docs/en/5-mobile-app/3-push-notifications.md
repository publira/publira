---
title: Push notifications
description: Set up the Firebase project a tenant's app receives push notifications through, and give the tenant console the credentials to send with.
published: 2026-10-06
---

The app tells a reader on their phone when a new episode is published of a series they follow, or credited to an author they follow, and a tap opens that episode. The install sends the notification to Firebase Cloud Messaging, which delivers it to Android phones itself and to iPhones through Apple's push service. Three things have to name the same Firebase project for that to work:

1. **The app**, which is built with the project's values and registers each phone with it.
2. **Apple**, whose push key the project relays iPhone notifications with.
3. **The tenant console**, which holds the project's service account key that `publira worker` sends with.

Use one Firebase project per tenant app. A project belongs to whoever builds the app, so a publisher can own theirs outright.

## Create the Firebase project

In the [Firebase console](https://console.firebase.google.com/), add a project for the tenant's app. Google Analytics is not needed and can be turned off.

Then add two apps to the project, from its **Project settings** › **General**:

- **An Android app**, with the manifest's `android.applicationId` as its package name. Download the `google-services.json` it offers.
- **An Apple app**, with the manifest's `ios.bundleIdentifier` as its bundle ID. Download the `GoogleService-Info.plist` it offers.

The Firebase console then asks you to add each file to the app's source code and to change its build files. Skip those steps: the Publira app takes the same values from the build command instead, so the repository stays free of any one tenant's project.

## Give the build the project's values

Copy seven values out of the two files into the file the build reads, `~/example-reader/firebase.json` in [Building and signing](./2-building.md#push-notifications):

```json
{
  "PUBLIRA_FIREBASE_PROJECT_ID": "example-reader",
  "PUBLIRA_FIREBASE_MESSAGING_SENDER_ID": "123456789012",
  "PUBLIRA_FIREBASE_ANDROID_API_KEY": "AIza...",
  "PUBLIRA_FIREBASE_ANDROID_APP_ID": "1:123456789012:android:0123456789abcdef",
  "PUBLIRA_FIREBASE_IOS_API_KEY": "AIza...",
  "PUBLIRA_FIREBASE_IOS_APP_ID": "1:123456789012:ios:0123456789abcdef",
  "PUBLIRA_FIREBASE_IOS_BUNDLE_ID": "com.example.reader"
}
```

| Value | In `google-services.json` | In `GoogleService-Info.plist` |
| --- | --- | --- |
| `PUBLIRA_FIREBASE_PROJECT_ID` | `project_info.project_id` | `PROJECT_ID` |
| `PUBLIRA_FIREBASE_MESSAGING_SENDER_ID` | `project_info.project_number` | `GCM_SENDER_ID` |
| `PUBLIRA_FIREBASE_ANDROID_API_KEY` | `current_key` under the Android app's `api_key` |  |
| `PUBLIRA_FIREBASE_ANDROID_APP_ID` | `mobilesdk_app_id` under the Android app's `client_info` |  |
| `PUBLIRA_FIREBASE_IOS_API_KEY` |  | `API_KEY` |
| `PUBLIRA_FIREBASE_IOS_APP_ID` |  | `GOOGLE_APP_ID` |
| `PUBLIRA_FIREBASE_IOS_BUNDLE_ID` |  | `BUNDLE_ID` |

These values are not secrets: every copy of the app carries them. A build without the project ID or the sender ID has no push notifications at all, and a build missing one platform's pair has none on that platform.

## Give Firebase Apple's push key

Firebase cannot reach an iPhone until it holds a key for Apple's push service. One key serves every app of the Apple Developer team, so a team that already has one reuses it.

1. On the Apple Developer website, under **Certificates, Identifiers & Profiles** › **Keys**, create a key with **Apple Push Notifications service (APNs)** enabled.
2. Download the `.p8` file. Apple offers it only once; keep it in your secret store. Note the key's Key ID.
3. In the Firebase console, open **Project settings** › **Cloud Messaging**, and under the Apple app's configuration upload the `.p8` file as the APNs authentication key, with its Key ID and the team's Team ID.

The app itself already asks iOS for push notifications in both the development and the production environment, so there is nothing to turn on in Xcode.

## Give the tenant console the sending credentials

`publira worker` sends each notification as a service account of the Firebase project, so the tenant console needs that account's key.

1. In the Firebase console, open **Project settings** › **Service accounts** and choose **Generate new private key**. A JSON file is downloaded.
2. In the tenant console, open **Integrations** › **Mobile push**.
3. Enter the **Firebase project ID**, the same `PUBLIRA_FIREBASE_PROJECT_ID` the app was built with, and choose the downloaded file as the **Service account key file**.
4. Choose **Save the credentials**.

The console refuses a key from another project than the one entered, since the app would never receive what it sent. The key is write-only: the page shows the service account it belongs to and when it was saved, never the key, and saving a new file replaces it. Delete the downloaded file once it is saved.

If the console answers that the API server has no encryption key, the install was started without `PUBLIRA_SECRET_ENCRYPTION_KEYS`. The operator sets it as [Installing](../2-deployments/2-installing.md#generate-the-secrets) describes, and the key can be saved once `publira server` has restarted with it.

Until a key is saved, the app receives no push notifications. Email and the in-app notification inbox are delivered either way.

## Check that a notification arrives

Try it on a physical phone: Firebase does not deliver to the iOS simulator. Install the release build, through TestFlight on an iPhone or the release APK on Android, then:

1. Sign in to the app as a reader, open **Account**, turn on **New episode notifications**, and allow notifications when the phone asks.
2. Follow a series in the app.
3. Publish a new episode of that series from the tenant console.

The notification arrives once `publira worker` has sent it, and tapping it opens the episode. The app asks the phone for permission only when a reader turns the switch on, never at launch, so a reader who has not turned it on receives nothing.

Next: [App links](./4-app-links.md).
