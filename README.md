# Throttle

A focused, always-on-top Windows dock for monitoring **Claude Code**, **Cursor**, **Codex**, and **Google Antigravity CLI** usage.

[Download the latest Windows release](https://github.com/Parth-Jadhav-2004/Throttle/releases/latest)

## What it tracks

- Claude Code 5-hour and weekly utilization, from the local Claude session
- Cursor included-usage percentage, from the local Cursor IDE session
- Monthly Codex limit for free ChatGPT accounts
- 5-hour and weekly Codex limits, when the account reports those windows
- Antigravity model quota, from the local `agy` CLI session

Each visible service shows a logo, a ring for how much of that allowance is used, and the used percentage underneath. A small tab remains on the right edge; touch that edge to reveal the panel, then move away to retract it. Open **Settings** from the tray to turn Claude, Cursor, Codex, or Antigravity on or off.

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

Throttle retracts into the right edge of the display and reveals from the centered edge hotspot. It is also available from the Windows notification area. It does not add itself to Windows startup.

If a service is disconnected, click its logo on the dock to start the matching login flow. Open **Settings** from the tray to hide any service you do not want on the dock.

## Windows builds

Run `npm run dist` to create:

- `dist/portable/Throttle-0.1.5-x64-Portable.exe` — portable executable
- `dist/installer/Throttle-0.1.5-x64-Setup.exe` — Windows installer

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

- Touch the center of a display's exact right edge to reveal the attached black usage panel
- Move outside the panel to retract it after a short grace period
- The tapered top and bottom edges join the screen border instead of forming a floating capsule
- Each visible logo has a usage ring and a used-percentage label underneath
- Settings is a separate window, opened from the tray, with on/off toggles for Claude, Cursor, Codex, and Antigravity
- Click a disconnected logo to start that service's login flow
- The dock hides while a full-screen application covers that display
- The system tray menu provides Settings, Refresh Usage, Check for Updates, and Quit
- Adjustable whole-dock opacity from 35% to 100%
- Auto-refresh every 10 seconds, 30 seconds, 1 minute, or 5 minutes

Settings are stored locally in Electron's application data folder.

## Privacy and security

- Codex authentication remains owned by the Codex CLI in the user's Codex home folder.
- The Windows dock never reads or stores Codex access tokens itself.
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
npm start      # run the dock
npm run pack   # unpacked Windows app
npm run dist   # portable + NSIS builds
```

Test coverage includes dock geometry, full-screen classification, malformed/missing payloads, reset formatting, settings boundaries, Claude credentials, and JSONL protocol framing.

## Troubleshooting

- **Codex login required:** run `codex login`, then click the Codex logo or refresh from the tray.
- **Claude login required:** run `claude auth login`, then click the Claude logo or refresh from the tray.
- **Cursor login required:** open the Cursor app, sign in, then refresh. Throttle uses the same local session Cursor already stored.
- **Antigravity login required:** run `agy` and complete its browser sign-in, then refresh from the tray.
- **Only a monthly Codex number is shown:** free ChatGPT accounts report a monthly window.
- **Codex not found:** ensure `codex --version` works in a new terminal and restart Throttle.
- **Claude not found:** ensure `claude --version` works in a new terminal and restart Throttle.
- **The dock disappeared:** full-screen apps intentionally hide it. Leave full screen, or use **Settings** from the system tray to confirm Throttle is running.

## References

- [OpenAI Codex app-server documentation](https://developers.openai.com/codex/app-server/)
- [OpenAI Codex app-server protocol](https://github.com/openai/codex/tree/main/codex-rs/app-server)
