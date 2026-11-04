# Security

## Reporting a vulnerability

Please open a private security advisory on GitHub if the issue could expose
credentials, local files or microphone data. For normal bugs, use the issue
tracker.

## Data handling

- The plugin records only after the user presses the fish-ear button.
- Audio is held in browser memory, sent to the local DSH Host, written to a
  system temporary WAV for analysis, and deleted after the request settles.
- Audio is not uploaded to a third-party service by this plugin.
- The enhanced mode starts a local Python worker only when configured.

Do not include credentials, personal audio, or private conversation transcripts
in a public issue.
