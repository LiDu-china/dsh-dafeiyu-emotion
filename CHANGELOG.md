# Changelog

## 0.2.2

- Fixed a duplicate-send race between auto-send and the manual send button.
- Cancelled stale deliveries when the session changes or the component unmounts.
- Stopped overwriting a busy composer when `insertText` is refused; send failures now keep the analysis for retry.
- Added a cancel action and timeout while waiting for microphone permission.
- Made prosody extraction yield to the UI thread instead of blocking on long recordings.
- Corrected the base64 request-body limit and mapped validation failures to 400/413 instead of 500.
- Pinned speech-provider readiness checks to the provider actually used for transcription.
- Reported missing enhanced backends in health and preserved the real worker failure reason.
- Added regression tests for delivery gating, shortcut availability and the analyze handler.

## 0.2.1

- Added a native DSH voice shortcut, configurable from DSH keyboard settings.
- The shortcut starts recording when idle and stops/analyzes recording on a second press.
- Refreshed the project icon and README key visual with the blue whale-girl character artwork.

## 0.2.0

- Added a lightweight mode using DSH Voice Input and browser-side prosody analysis.
- Added optional DSH `speechToText` integration for portable marketplace installs.
- Kept the VoiceSense/emotion2vec enhanced backend for high-accuracy local analysis.
- Added bilingual README, icon, preview artwork and MIT license.
- Added a more natural emotion-aware prompt with confidence and tone cues.
- Verified the desktop install and warm analysis path on DSH Desktop 0.2.1-rc.2.

## 0.1.0

- Initial local plugin: fish-ear microphone, local WAV capture, VoiceSense bridge, emotion prompt and auto-send.
