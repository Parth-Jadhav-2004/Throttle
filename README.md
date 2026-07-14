# Throttle

A focused, always-on-top Windows widget for monitoring the **Codex allowance included with a ChatGPT plan**.

[Download the latest Windows release](https://github.com/Parth-Jadhav-2004/Throttle/releases/latest)

## What it tracks

- 5-hour Codex limit, when the account reports that window
- Weekly Codex limit, when the account reports that window
- Remaining percentage and reset countdown
- ChatGPT plan type reported by Codex

The widget uses the official local `codex app-server` protocol and its `account/rateLimits/read` method. It does **not** scrape ChatGPT, copy browser cookies, or ask for an API key.

> Important: this tracks Codex rate-limit windows attached to your ChatGPT subscription. It cannot track every general ChatGPT model/message cap because OpenAI does not expose those caps through this Codex method.

## Run

1. Install the Codex CLI and sign in with ChatGPT:
   ```text
   codex login
   ```
2. From this folder:
   ```text
   npm install
   npm start
   ```
3. Drag the top bar to move the widget. Use the slider to change opacity.

If no account is connected, click **Connect ChatGPT / Codex**. A terminal opens and starts the official `codex login` flow.

## Windows builds

Run `npm run dist` to create:

- `dist/portable/Throttle-0.1.2-x64-Portable.exe` — portable executable
- `dist/installer/Throttle-0.1.2-x64-Setup.exe` — Windows installer

## Controls

- Drag anywhere on the dark widget card or surrounding transparent surface to reposition it
- Resize from any edge or corner between `190 × 190` and the full `360 × 590` layout
- Responsive layouts: full controls at maximum size, a condensed dashboard at intermediate sizes, and percentage meters only at minimum size
- The full `360 × 590` layout is used every time the app starts; the widget remembers its screen position
- Invalid off-screen saved coordinates are rejected if the monitor arrangement changes
- Uses Electron's `screen-saver` always-on-top level and reasserts it after blur/show/restore, so normal browsers and desktop apps cannot cover it
- Refresh button for an immediate usage update
- Update button that checks GitHub and opens the newest release when available
- Adjustable whole-widget opacity from 35% to 100%
- Adjustable dark panel/grid opacity from 30% to 100%
- Auto-refresh every 10 seconds, 30 seconds, 1 minute, or 5 minutes
- Minimize and close controls appear subtly in the top-right corner

Settings are stored locally in Electron's application data folder.

## Privacy and security

- Authentication remains owned by the Codex CLI in the user's Codex home folder.
- The widget never reads or stores access tokens itself.
- Usage is requested from a local child process (`codex app-server --stdio`).
- Electron renderer isolation is enabled and Node integration is disabled.
- No analytics or third-party network code is included.

## Development

```text
npm test       # Node test suite
npm start      # run the widget
npm run pack   # unpacked Windows app
npm run dist   # portable + NSIS builds
```

Test coverage includes window classification, malformed/missing payloads, reset formatting, settings boundaries, and JSONL protocol framing.

## Troubleshooting

- **Codex login required:** run `codex login`, then click refresh.
- **Only weekly limit is shown:** the account response currently has no 5-hour bucket. The widget shows `N/A` rather than inventing data.
- **Codex not found:** ensure `codex --version` works in a new terminal and restart the widget.
- **Protocol error after a Codex update:** update this project and re-run tests; the app-server schema is version-specific.

## References

- [OpenAI Codex app-server documentation](https://developers.openai.com/codex/app-server/)
- [OpenAI Codex app-server protocol](https://github.com/openai/codex/tree/main/codex-rs/app-server)
