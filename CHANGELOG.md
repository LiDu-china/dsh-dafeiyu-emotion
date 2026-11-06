# Changelog

## 0.3.2

- Added `ttsOnlyAfterVoice` (default `true`): spoken replies are limited to assistant messages within two minutes of a voice input, so normal coding chats do not read every answer aloud.
- Added the matching settings toggle.

## 0.3.1

- Added spoken assistant replies. The host now forwards `assistant/message` text over `/plugins/dsh-dafeiyu-emotion/events`; the client plays it with TTS.
- Added local Piper TTS (`zh_CN-huayan-medium`) as the default engine, with Edge TTS as an optional online engine and browser `speechSynthesis` as the final fallback.
- Added `ttsEnabled`, `ttsEngine`, `ttsVoice`, `ttsRate`, `ttsPitch` and `ttsPiperModel` settings, including a voice selector and model path field.
- Added `POST /plugins/dsh-dafeiyu-emotion/tts`, returning WAV for Piper and MP3 for Edge.
- Edge TTS failures and missing Piper models fall back to local browser speech instead of breaking the reply.
- Added TTS handler, assistant-text extraction, SSE broadcast and markdown-cleaning tests.

## 0.3.0

- Added `empathyStyle` with four reply strategies: gentle, direct, humorous and concise. The choice is persisted and injected into the emotion-aware prompt.
- Added an in-composer emotion timeline for analyses with multiple segments; hovering a segment shows its text, emotion and confidence.
- Added privacy/runtime status to the settings panel and `/health`: last emotion, last audio size, model load time, worker PID and last temp cleanup time.
- Added local-only `GET /plugins/dsh-dafeiyu-emotion/context` so other plugins can read the latest emotion context.
- Settings now resolve the real `entry.ns` from `settings.describe()` instead of assuming the npm package name.
- Settings writes now carry the settings revision and return 409 on a concurrent-window conflict.
- Removed the hard `settings` inject; settings are resolved dynamically after the host is up.
- Moved Python discovery to the first worker start, removing the synchronous filesystem stat from `apply`.
- An explicit empty `backendRoot` now clears the environment fallback, so the UI can disable the enhanced backend.
- Shortcut resolution now prefers the most recently used fish-ear instead of the last mounted one.
- Narrow sidebar fields wrap instead of squeezing controls.
- Removed test scripts from the published npm tarball.

## 0.2.10

- Removed `settings` from the hard inject list. A hard `settings` dependency can deadlock host startup while the settings service is still building plugin `Config` projections.
- Settings are now resolved with `ctx.inject(['settings'], ...)` after the host is up; `/config` is read-only until then and becomes writable when the service arrives.
- Added a regression assertion that `settings` is not a hard dependency.

## 0.2.9

- Fixed the host startup timeout: `apply` synchronously called `settings.describe()` while the host was still mounting plugins, which could deadlock startup for 60 seconds.
- `apply` now uses the patch config only; settings are read/written through `/config` after the host is up.
- Added cycle/depth guards to `plainConfig()` so an unexpected volatile-ref cycle cannot hang startup or a settings request.
- Added a regression test where `settings.describe()` throws if called during `apply`.

## 0.2.8

- Fixed `backendRoot` showing as `[object Object]` on the settings page. DSH projects volatile `Config` fields as `{ get() }` refs; `readSettings()` and `resolveOptions()` now unwrap them before path/string/number handling.
- Added `plainConfig` regression coverage so a volatile ref can never be stringified into a fake path again.

## 0.2.7

- Fixed a host activation failure: `apply` read `ctx.settings` while the plugin only declared `webServer`. Cordis throws `cannot get property "settings" without inject`, so the whole host plugin failed to mount and `/plugins/dsh-dafeiyu-emotion/config` returned 404.
- Added `settings` to the declared inject list so the host can mount and register the health, analyze and config routes.
- Added a regression assertion that both `webServer` and `settings` are declared dependencies.

## 0.2.6

- Fixed a blocking `Config` validation error: the 12 MiB `maxAudioBytes` default violated the old 1 MiB step relative to the 256 KiB minimum. Removed the schema step so the shipped default and the settings inputs validate.
- Added `scripts/test-config-schema.mjs`, which now parses `Config({})` and the shipped defaults before release.
- Settings changes now apply live: saving `enabled` or `language` broadcasts to the mounted fish-ear, hides it when disabled, and stops the native shortcut from starting a recording.
- Added request-scoped cancellation. Cancelling a queued request no longer kills the worker serving another session; `close()` invalidates queued work.
- Added visible keyboard focus to the three numeric settings inputs.
- `statusCopy` now shows “已停用” instead of “已就绪” when the plugin is disabled.
- Numeric config patches now require real integers instead of accepting booleans, `null`, or numeric strings.
- Removed the undeclared `settings.plugin.item` slot registration; the supported slots are `plugins.bundle.config` and `settings.plugins.tab`.
- Marked `Config` fields volatile at construction instead of mutating the exported schema.
- Weakened the auto-send success copy so a host that silently refuses `submit()` does not produce a false “delivered” claim.

## 0.2.5

- Exported the Schemastery `Config` schema so DSH can persist setting changes from the panel.
- Marked every config field volatile, matching the DSH settings service contract.
- 0.2.4 shipped the settings UI; on hosts that require a registered volatile schema, saving failed. 0.2.5 added the schema but its 1 MiB step rejected the 12 MiB default; install 0.2.6 instead.

## 0.2.4

- Added a full settings card for DSH's plugin settings, with live status for lightweight and enhanced modes.
- Added a "情绪耳朵" tab for `dsh-better-sidebar` so the same panel can be pinned in the right sidebar.
- Settings now cover enable/disable, recognition language, VoiceSense directory, Python path, recording limit, startup timeout and request timeout.
- Added `GET/PATCH /plugins/dsh-dafeiyu-emotion/config` with local-only access, strict field validation and live backend restart when paths or timeouts change.
- Refreshed the fish-ear trigger and settings panel with a calmer whale-blue visual system, visible focus states and reduced-motion support.
- Added config-handler regression tests (validation, read-only hosts, status codes and runtime updates).

## 0.2.3

- Documentation-only release: npm and the 1024Store entry now serve the corrected install notes for the 0.2.2 bug-fix release.
- No runtime behavior changed from 0.2.2.

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
