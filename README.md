# Throttle

A focused, auto-hiding Windows usage island for monitoring the **Codex allowance included with a ChatGPT plan**.

[Download the latest Windows release](https://github.com/Parth-Jadhav-2004/Throttle/releases/latest)

## What it tracks

- Monthly Codex limit for free ChatGPT accounts
- 5-hour Codex limit, when the account reports that window
- Weekly Codex limit, when the account reports that window
- Remaining percentage and reset countdown
- ChatGPT plan type reported by Codex

Throttle uses the official local `codex app-server` protocol and its `account/rateLimits/read` method. It does **not** scrape ChatGPT, copy browser cookies, or ask for an API key.

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

3. Move the cursor to the exact top-center edge of a display to reveal the usage island.

Throttle starts hidden and remains available from the Windows notification area. It does not add itself to Windows startup.

If no account is connected, reveal the island and click **Connect Codex**. A terminal opens and starts the official `codex login` flow.

## Windows builds

Run `npm run dist` to create:

- `dist/portable/Throttle-0.1.4-x64-Portable.exe` — portable executable
- `dist/installer/Throttle-0.1.4-x64-Setup.exe` — Windows installer

## iPhone app and widgets

The separate [Throttle iOS repository](https://github.com/Parth-Jadhav-2004/Throttle-iOS)
provides a React Native dashboard, a small weekly-limit widget, a medium
weekly-and-5-hour widget, and a GitHub Actions unsigned IPA build.

The iPhone connects directly to this Windows app through **Tailscale Serve**.
There is no hosted relay or public usage endpoint.

### One-time setup

1. Install Tailscale on Windows and iPhone and sign into the same account.
2. In Throttle settings, click **Pair with Tailscale**.
3. Click **Enable iPhone Access** and scan the QR code with the iOS app.
4. Add **Throttle Usage** from the iOS widget gallery.

After pairing, usage refreshes whenever the laptop is awake, Throttle is
running, and both devices are connected to Tailscale. The widget retains its
last cached value while the laptop is offline. See the
[iOS README](https://github.com/Parth-Jadhav-2004/Throttle-iOS#readme) for
development and sideloading.

## Controls

- Touch the center 240 pixels of a monitor's exact top edge to reveal the fixed `420 × 220` usage island
- The island follows the cursor's monitor and ignores internal edges between vertically stacked displays
- Move outside the island to retract it after a short grace period; returning to it cancels dismissal
- Press `Esc` or use the upward chevron to retract immediately
- The hidden window is fully transparent and click-through, so it does not block the application underneath
- Automatic edge reveal is suppressed while a full-screen application covers that display
- The system tray menu provides Show, Hide, Refresh Usage, Check for Updates, and Quit
- Tray Show is a recovery path that bypasses the edge gesture without stealing focus
- Fixed top-center placement replaces the previous drag, resize, and remembered-position behavior
- Refresh button for an immediate usage update
- Adjustable whole-widget opacity from 35% to 100%
- Adjustable panel opacity from 30% to 100%
- Auto-refresh every 10 seconds, 30 seconds, 1 minute, or 5 minutes
- Compact settings view for appearance, refresh timing, and update checks

Settings are stored locally in Electron's application data folder.

## Privacy and security

- Authentication remains owned by the Codex CLI in the user's Codex home folder.
- The Windows widget never reads or stores Codex access tokens itself.
- Usage is requested from a local child process (`codex app-server --stdio`).
- Optional iPhone access binds to localhost and is exposed only inside the
  user's tailnet with a random read-only pairing token.
- The iOS app and widget store only that scoped pairing token, never the
  Codex or ChatGPT authentication session.
- Electron renderer isolation is enabled and Node integration is disabled.
- No analytics or third-party network code is included.

## Development

```text
npm test       # Node test suite
npm start      # run the island
npm run pack   # unpacked Windows app
npm run dist   # portable + NSIS builds
```

Test coverage includes dock geometry, transition guards, full-screen classification, malformed/missing payloads, reset formatting, settings boundaries, and JSONL protocol framing.

## Troubleshooting

- **Codex login required:** run `codex login`, then click refresh.
- **Only weekly limit is shown:** the account response currently has no 5-hour bucket. The island shows `N/A` rather than inventing data.
- **Only monthly limit is shown:** free ChatGPT accounts report a monthly window, so Throttle hides the 5-hour and weekly limits and shows only the monthly one.
- **Codex not found:** ensure `codex --version` works in a new terminal and restart Throttle.
- **Top edge does not reveal:** full-screen apps intentionally suppress the gesture. Use **Show Throttle** from the system tray to verify the app is running.
- **Stacked monitors:** a boundary with another display directly above it is not treated as a physical top edge.
- **Protocol error after a Codex update:** update this project and re-run tests; the app-server schema is version-specific.

## References

- [OpenAI Codex app-server documentation](https://developers.openai.com/codex/app-server/)
- [OpenAI Codex app-server protocol](https://github.com/openai/codex/tree/main/codex-rs/app-server)
