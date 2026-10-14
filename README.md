# Throttle

A Windows system-tray app for monitoring **Claude Code**, **Codex**, **Cursor**, and **Google Antigravity CLI** usage limits.

[Download the latest Windows release](https://github.com/Parth-Jadhav-2004/Throttle/releases/latest)

## What it tracks

- Claude Code 5-hour and weekly utilization, from the local Claude session
- Cursor included-usage percentage, from the local Cursor IDE session
- Monthly Codex limit for free ChatGPT accounts
- 5-hour and weekly Codex limits, when the account reports those windows
- Antigravity model quota, from the local `agy` CLI session

Click the Throttle icon in the Windows notification area (or press the global shortcut, **Ctrl + Alt + U** by default) to open the usage popup. Each provider gets a card with a bar per limit, a live reset countdown, and a pace verdict: green while you're on course to finish the window with room to spare, amber when the projection lands in the last 10%, and red with a projected run-out time when you'll hit the limit before it resets. The tray icon itself draws your two starred (or most-used) limits as mini bars.

Throttle uses the official local `codex app-server` protocol and its `account/rateLimits/read` method. It does **not** scrape ChatGPT, copy browser cookies, or ask for an API key.

Claude usage is read from the local Claude Code session in `~/.claude/.credentials.json` and requested from Anthropic's usage endpoint. Cursor usage reads the local Cursor IDE session from `state.vscdb` and asks Cursor's dashboard API for the current billing-cycle limits. Antigravity quota is read through the local `agy` credential and the same Cloud Code quota flow used by its `/usage` panel. Throttle does **not** copy those sessions into its own settings.

> Important: Codex tracking covers rate-limit windows attached to your ChatGPT subscription. It cannot track every general ChatGPT model/message cap because OpenAI does not expose those caps through this Codex method.

## Run

1. Sign in to the tools you want to watch:

   ```text
   agy
   claude auth login
   codex login
   ```

   Cursor must already be signed in on this computer.

2. From this folder:

   ```text
   npm install
   npm start
   ```

Throttle lives in the Windows notification area. Turn on **Launch at login** in Settings if you want it to start with Windows.

If a service is signed out, its card shows a sign-in button that starts the matching login flow.

## Windows builds

Run `npm run dist` to create:

- `dist/portable/Throttle-0.2.0-x64-Portable.exe` — portable executable
- `dist/installer/Throttle-0.2.0-x64-Setup.exe` — Windows installer

## iPhone app and widgets

The separate [Throttle iOS repository](https://github.com/Parth-Jadhav-2004/Throttle-iOS)
provides a React Native dashboard, a small weekly-limit widget, a medium
weekly-and-5-hour widget, and a GitHub Actions unsigned IPA build.

The iPhone connects directly to this Windows app through **Tailscale Serve**.
There is no hosted relay or public usage endpoint.

### One-time setup

1. Install Tailscale on Windows and iPhone and sign into the same account.
2. In Throttle, open **Settings → iPhone widget** and click **Pair**.
3. Click **Enable iPhone Access** and scan the QR code with the iOS app.
4. Add **Throttle Usage** from the iOS widget gallery.

After pairing, usage refreshes whenever the laptop is awake, Throttle is
running, and both devices are connected to Tailscale. The widget retains its
last cached value while the laptop is offline. See the
[iOS README](https://github.com/Parth-Jadhav-2004/Throttle-iOS#readme) for
development and sideloading.

## Controls

- **Left-click the tray icon** or press the global shortcut to toggle the popup; it closes when it loses focus or on **Esc**
- **Click a value** (`52% left`) to flip between used and left everywhere, and **click a reset time** to flip between a countdown and a clock time; hovering previews the other reading
- **Hover a bar** for the pace projection at reset
- **Right-click a card** to refresh that provider, star a metric for the tray icon, hide a metric or provider, or jump to its Customize page
- **Expand a card** with its caret for extra metrics, last-updated time, errors, and quick links to the provider's usage and status pages
- **Customize** turns providers on or off, drags them into any order, and stars or hides individual metrics
- **Settings** covers theme (System, Dark, Light), the tray icon style, used/left and countdown/clock defaults, 12/24-hour time, always-on pacing, launch at login, the global shortcut, refresh interval, iPhone pairing, and updates
- **Ctrl + R** refreshes everything, **Ctrl + ,** opens Settings
- The footer shows a live "Next update in…" countdown; click it to refresh now
- Last known values are cached on disk and shown instantly at launch. A failed refresh keeps them on screen with a warning badge instead of wiping the card.
- Right-clicking the tray icon gives Open, Refresh, Customize, Settings, Check for Updates, and Quit

Settings and the usage cache are stored locally in Electron's application data folder.

## Privacy and security

- Codex authentication remains owned by the Codex CLI in the user's Codex home folder.
- Throttle never reads or stores Codex access tokens itself.
- Codex usage is requested from a local child process (`codex app-server --stdio`).
- Claude usage reads the local Claude Code session and, when the access token is expired, refreshes it in place in Claude's credentials file so the CLI stays in sync. Tokens are not copied into Throttle settings.
- Cursor usage reads the IDE's local session read-only and does not save Cursor tokens. Tokens are used only in memory to query Cursor's usage API.
- Antigravity usage reads the `agy` credential through the operating system keyring and uses it only to request quota. The credential is not copied into Throttle settings.
- Optional iPhone access binds to localhost and is exposed only inside the
  user's tailnet with a random read-only pairing token.
- The iOS app and widget store only that scoped pairing token, never the
  Codex, Claude, or ChatGPT authentication session.
- Electron renderer isolation is enabled and Node integration is disabled.
- No analytics are included. Extra network calls are Claude's usage API and Cursor's usage API, and only for services enabled in settings.

## Development

```text
npm test       # Node test suite
npm start      # run Throttle
npm run pack   # unpacked Windows app
npm run dist   # portable + NSIS builds
```

`npx electron . --screenshot=out.png --view=settings` renders the popup (`dashboard`, `customize`, or `settings`) to a PNG and quits, which is handy for checking UI changes.

Test coverage includes pace projection, reset and value formatting, popup placement for every taskbar edge, malformed/missing payloads, settings boundaries, provider credentials, and JSONL protocol framing.

## Troubleshooting

- **Codex login required:** run `codex login`, then click **Try again** on the Codex card.
- **Claude login required:** run `claude auth login`, then click **Try again** on the Claude card.
- **Cursor login required:** open the Cursor app, sign in, then refresh. Throttle uses the same local session Cursor already stored.
- **Antigravity login required:** run `agy` and complete its browser sign-in, then refresh from the tray.
- **Only a monthly Codex number is shown:** free ChatGPT accounts report a monthly window.
- **Codex not found:** ensure `codex --version` works in a new terminal and restart Throttle.
- **Claude not found:** ensure `claude --version` works in a new terminal and restart Throttle.
- **Can't find the tray icon:** Windows may tuck it into the overflow (^) area. Drag it onto the taskbar to keep it visible, or use the global shortcut.

## References

- [OpenAI Codex app-server documentation](https://developers.openai.com/codex/app-server/)
- [OpenAI Codex app-server protocol](https://github.com/openai/codex/tree/main/codex-rs/app-server)
