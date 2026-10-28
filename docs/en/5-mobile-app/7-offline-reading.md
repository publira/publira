---
title: Offline reading
description: What the app keeps on the device for reading without a network, how it protects and limits it, and what it sends once the network returns.
published: 2026-10-28
---

The app keeps the episodes a reader opens so that they can be read again without a network, and lets the reader save a whole episode ahead of time. Nothing about it is set in the tenant console or the manifest: every tenant's app behaves the same way. This page is for the publisher's staff deciding whether that meets their expectations for protecting their content, and for staff answering a reader who asks why a saved episode stopped opening. What each part means for the stores' review is at the end.

## What a reader can save

An episode reaches the device in one of two ways:

- **By reading it.** Every episode the app opens is kept, with the pages the reader turned to, so an episode read halfway is kept with half its pages. The first page of the catalog and every series screen the reader opened are kept too.
- **With Save for offline** on the episode's row of the series screen, which fetches every page at once, or only the pages still missing from an episode read partway. The row then says **Saved on this device**.

The row offers the save on an episode the reader can open right now: a free one, or one their account opens, whether a purchase, a rental, a plan, or a ticket opened it. A paid episode is kept only for a signed-in reader, so a signed-out reader saves free episodes alone.

**Library** › **Downloads** lists what the device holds, by series: the space it takes against the cap, when each episode was saved, until when it opens offline where that has an end, and how many of its pages are saved when not all of them are. **Delete** removes one episode, and **Clear all** removes every episode saved on the device, those saved while another account was signed in included.

Without a network, the app opens what it kept: the first page of the catalog, the series screens, and the saved episodes. Search, the rankings, the recommendations, and anything else read across the whole catalog need the network.

The install decides, not the device. Every time the app opens an episode it asks the install first, and reads the saved copy only when the install cannot be reached. An answer from the install replaces the saved copy, and an answer that the episode is locked, unpublished, or gone deletes it from the device with its pages. A series the install no longer publishes takes every episode saved under it with it.

## Where it is kept and how it is protected

Saved episodes are kept in the app's private storage, which other apps cannot read and which is deleted with the app. Every page, and the index of what is saved, is encrypted under a random key the app creates the first time it needs one and keeps in the platform's credential store, the Keychain on iOS and the Keystore on Android, beside the reader's session. A page is kept as the image the reader was shown, encrypted again under that key; neither the reader's session nor the address the page was delivered from is written down.

A device with no credential store saves nothing, and reads online only. When the key can no longer be read, the app makes a new one, and the episodes saved under the old one are deleted: the reader saves them again.

The encryption keeps the saved pages unreadable to anyone who copies the app's files off the device without its key. It is not DRM. The reader who may open an episode holds the key that opens it, and the app does not stop someone who controls the device from taking the pages out of it, which no app can.

## Paid episodes: seven days without the install

A paid episode the reader saved opens offline for seven days after the app last opened it online. Opening it online again starts the seven days again; reading it offline does not. Once they have passed, opening it offline says **The saved copy of this episode has expired. Open it again while connected.**, and the episode is deleted from the device.

The seven days are how long the device trusts a grant it cannot check. Offline, the app cannot see a purchase refunded, a rental or a purchase's reading period run out, a plan lapse, or a ticket revoked. It ends a paid episode sooner only where it was told when the grant ends:

- An episode opened by a **Free if you wait** ticket closes when the ticket does.
- An episode open to everyone during a **Free reading period** closes when the period ends, for every reader.

Every other paid episode — a purchase, a rental, a plan, an access ticket issued by staff — keeps opening offline until its seven days are up, even when its grant ended sooner. A refund therefore closes a saved episode within seven days of the app last opening it online, and the next time the app opens it online it is locked and deleted from the device.

A paid episode opens only to the account it was saved for. Signing out closes it, and so does another account signing in on the same device; signing back in with the account it was saved for opens it again, within its seven days.

The seven days are counted on the device's clock, which the reader can change. A save confirmed at a time the clock has not reached yet is refused, so moving the clock forward and back again gains nothing; a clock kept set back keeps the episode open, since the app has no time source the reader cannot change.

A free episode has no owner and no seven days. It opens for anyone holding the device until it is deleted, removed by the cap, or found locked or gone the next time the app opens it online.

## The 512 MB cap

Saved pages take up to 512 MB on a device. The cap is set in the app, and neither the tenant nor the reader can change it. When a page takes the device over it, the app first deletes the pages no saved episode needs any more, then deletes whole episodes, starting with the one the app opened online longest ago, until the pages fit again. The reader is not told: the episode leaves **Downloads**, and its row offers **Save for offline** again. What the reader read in it is kept, as the next section describes.

A save that cannot be kept because the phone itself is full says **Could not keep “…” on this device. Free up space and try again.**

## Reading progress made offline

A signed-in reader's place in an episode, and the episodes they finish, are recorded on the device and sent to the install. When the install cannot be reached, they wait on the device, and the app sends them when it starts, when it comes back to the foreground, when the reader signs in, and after any request the install answers. Only the latest place in each episode waits, and a finish stays once made.

- What waits is sent only while the reader who made it is signed in, so another account signed in on the same device never records it as theirs. Signing out deletes what that reader left unsent.
- Deleting a download, or the cap removing it, keeps what the reader read in it: the finish and the place are still sent.
- Offline, an episode opens at the place recorded on the device. Online, the install's place wins, so a place left on the site opens in the app, except over a place still waiting to be sent.
- A signed-out reader's progress is recorded nowhere, online or not.

## The screenshot notice

When the reader takes a screenshot while an episode's pages are on screen, the app shows a notice over them: **These pages belong to** the tenant's name **and are for your personal use only.** The reader closes it with **Close**, and it shows once for each episode until the app is next started.

The notice is all it does. The screenshot is taken as usual, the reader keeps turning pages under the notice, and nothing about the screenshot is sent to the install. iOS reports screenshots on every version the app runs on, and Android from Android 14, so an older Android device shows no notice. A screen recording is not noticed.

## In the stores' review

- **App Privacy and Data safety.** Saved episodes and the places recorded on the device stay on it, and are not data the app collects in either store's sense. Progress sent once the network returns is the reading already listed in [What the app collects](./6-store-submission.md#what-the-app-collects), sent later. Nothing about a screenshot leaves the device.
- **Encryption.** App Store Connect asks whether the app uses encryption, which it does: HTTPS to the install, and the encryption of saved episodes described above. The app's `Info.plist` does not answer in advance, so App Store Connect asks for each build you upload, and the answer, and any export filing it calls for, are the publisher's.
- **The screenshot permission.** On Android 14 and later, the notice relies on the `DETECT_SCREEN_CAPTURE` permission, which Android grants at install without asking the reader. iOS needs no permission for it.
