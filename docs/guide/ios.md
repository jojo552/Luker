# iOS

Luker runs on iPhone and iPad through an app that you sign with your own Apple ID. The app bundles the backend and opens the same interface as the desktop version, without a separate server.

## Why the app is not on the App Store

Luker is licensed AGPL-3.0. The App Store terms conflict with the license's requirement that users can freely copy, modify, and redistribute the software ([legal barrier to application stores](https://en.wikipedia.org/wiki/GNU_General_Public_License#Legal_barrier_to_application_stores)), so Luker does not distribute the app through the App Store. The iOS build is published as an unsigned IPA. You sign it with your own Apple ID.

## Requirements

- iPhone or iPad with iOS 16 or later.
- A computer for the initial AltStore or SideStore setup.
- An Apple ID. A free account works. A paid Apple Developer account extends the signing period from 7 days to 1 year.
- The unsigned IPA from GitHub Releases.

## Download

Download the latest iOS package from the [GitHub Releases page](https://github.com/funnycups/Luker/releases/latest). The file name ends with `-ios-unsigned.ipa`.

## Install

1. Install AltStore or SideStore on the iPhone or iPad. Follow the setup guide on [altstore.io](https://altstore.io/) or [sidestore.io](https://sidestore.io/). AltStore Classic uses AltServer on a computer. SideStore creates a pairing file during setup.
2. Save the IPA to the device.
3. Open the IPA in AltStore or SideStore, sign in with your Apple ID, and start signing.
4. Open Settings > General > VPN & Device Management and trust the developer certificate.
5. If iOS asks, open Settings > Privacy & Security > Developer Mode and turn it on, then restart the device.
6. Open Luker.

::: warning
A free Apple ID signature expires after 7 days, and the device can keep at most 3 self-signed apps. Re-sign the app before it expires. A paid Apple Developer account keeps the signature for 1 year.
:::

## First launch

Luker starts its local server and opens the interface. The first launch takes a little longer while the app prepares its local environment. Configure API connections and import character cards as you would on desktop.

The app runs on the device. After installation, you do not need a computer or a remote server.

## Background generation and notifications

Turn on **Background keep-alive** in User Settings to keep a generation running while Luker is in the background. iOS may suspend the app when it needs resources, so a generation is not guaranteed to finish.

Turn on **Show a notification when message generation finishes while Luker is in the background** to receive a local notification when a reply finishes. The system asks for notification permission when you turn on the setting. Notifications are sent only while Luker is running.

If startup fails or the app exits unexpectedly, Luker offers to export a diagnostics bundle. The bundle contains native logs, crash reports, the embedded service log, and the WebView console trail.

## Limitations

- Background generation is best effort. iOS may suspend the app when it needs resources.
- Updates come from GitHub Releases and are signed again. Use the same Apple ID and install over the existing app.
- If you need to change the Apple ID used for signing, [back up your data](/features/user-settings-additions#backup-migration-and-storage), delete the old app, and install the new one.

This refers to the Apple ID used to sign the app. The iCloud or App Store account signed in on the device does not affect updates.

## Use Luker in the browser

You can also use Luker without installing the app. Run Luker on a computer and open it in Safari:

1. Turn on network access on the computer:
   - On the same network — see [LAN Access](/guide/lan-access).
   - From outside your network — see [Remote Access](/guide/remote-access).
2. On the iPhone or iPad, open Safari and enter the host address. On a local network this looks like `http://192.168.1.23:8000`; through a proxy or tunnel, enter your domain.
3. Log in if authentication is enabled.

## Add to Home Screen

Luker installs as a home screen icon, so it opens in its own window instead of a browser tab.

1. Open Luker in Safari.
2. Tap the **Share** button.
3. Tap **Add to Home Screen**.
4. Name it, then tap **Add**.

The icon opens Luker in a standalone window, without Safari's address bar, and uses the Luker icon.

## Related pages

- [LAN Access](/guide/lan-access) — reach Luker from devices on the same network
- [Remote Access](/guide/remote-access) — reach Luker from outside your network
- [Android App](/guide/android) — the app for Android
- [HarmonyOS App](/guide/harmonyos) — the app for HarmonyOS
- [Desktop App](/guide/desktop) — the app for desktop
