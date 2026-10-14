# Throttle

A Windows system-tray app for monitoring **Claude Code**, **Codex**, **Cursor**, and **Google Antigravity CLI** usage limits.

[Download the latest Windows release](https://github.com/Parth-Jadhav-2004/Throttle/releases/latest)

## What it tracks

- Claude Code 5-hour and weekly utilization, from the local Claude session
- Cursor included-usage percentage, from the local Cursor IDE session
- Monthly Codex limit for free ChatGPT accounts
- 5-hour and weekly Codex limits, when the account reports those windows
- Antigravity model quota, from the local `agy` CLI session

It also tracks spend, priced from the [LiteLLM](https://github.com/BerriAI/litellm) model price list:

- Claude Code and Codex spend and tokens, read from their local session logs (`~/.claude/projects`, `~/.codex/sessions`)
- Cursor spend and tokens, from Cursor's own usage-events API

### Taskbar strip

Throttle draws a live strip on the Windows taskbar, just left of the notification area, much like OpenUsage's menu bar item. Each provider shows its logo and two stacked values, which turn amber or red as a limit gets close. Left-click the strip to open the popup above it, and right-click it for the tray menu.

Choose **Text**, **Bars**, or **Off** in **Settings → Taskbar** or in the tray menu's **Taskbar Display** submenu. Each provider's Customize page can hide it from the strip, and stars pick which two metrics it shows.

Windows 11 doesn't deliver mouse input to windows embedded in the taskbar. To make the strip clickable, Throttle runs a low-level mouse hook on a background thread. The hook only handles clicks inside the strip and passes every other mouse event through untouched. The strip is skipped on vertical taskbars.

### Popup

Click the strip or the tray icon, or press the global shortcut (**Ctrl + Alt + U** by default), to open the popup.

- **Total Spend** card: a donut chart with the total in the centre and a ranked legend. Switch between **Cost**, **Rate** (per million tokens), and **Tokens**, and between **Today**, **Yesterday**, and **30 Days**. The info icon explains the numbers, and the share icon copies a screenshot of the card.
- **Provider sections** show the plan next to the provider name. Each limit has a bar with an even-pace tick and a live reset countdown, plus a pace note:
  - green while you're on course to finish the window with room to spare
  - amber when the projection lands in the last 10%
  - red, with a flame icon and a projected run-out time, when you'll hit the limit before it resets
- **Spend rows** under Claude, Codex, and Cursor show Today, Yesterday, and Last 30 Days, along with a 30-day usage trend chart.
- **Footer**: the version, a "Next update in…" countdown, and an **Options** menu with Customize, Settings, Share Screenshot, Refresh All, Check for Updates, Report an Issue, About, and Quit.

The tray icon draws your two starred (or most-used) limits as mini bars, or shows the Throttle logo.

### Alerts

Desktop notifications warn you when a limit will run out before it resets, when you're almost out (10% or less left), or when it's cutting close. Each alert fires once per reset window, only when the state changes. Each alert type can be turned on or off in **Settings → Alerts**.

### Local API

While Throttle is running, it serves a read-only JSON API on `http://127.0.0.1:6736`:

- `/v1/limits` and `/v1/limits/<provider>`
- `/v1/usage` and `/v1/usage/<provider>`

It only accepts loopback `Host` headers and sends no CORS headers, so web pages can't read it. You can turn it off in **Settings → General**.

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
- **Right-click a card** to refresh that provider, star a metric for the taskbar, move or hide a metric, hide the provider, copy a screenshot, or jump to its Customize page
- **Expand a card** with its caret ("N more") for on-demand metrics, last-updated time, errors, and quick links to the provider's usage and status pages
- **Customize** turns providers on or off and drags them into any order. Each provider's page splits metrics into **Always visible** and **On demand**, stars up to two for the taskbar, and hides the rest. **Ctrl + Z** undoes layout changes.
- **Settings** covers:
  - appearance: theme (System, Dark, Light), compact density, reduced animations, transparency
  - taskbar: the strip style and the tray icon style
  - usage: used/left and countdown/clock defaults, 12/24-hour time, always-on pacing, the Total Spend card
  - alerts
  - general: launch at login, the global shortcut, refresh interval, hiding from screen sharing, the local API
  - iPhone pairing
  - resetting all settings
- A **welcome screen** on first launch turns on the providers already signed in on this PC
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
- No analytics are included. Throttle only calls each enabled provider's own usage API, and it fetches the LiteLLM price list from GitHub once a day.
- **Hide from screen sharing** hides only the popup from screen capture; the taskbar strip stays visible.

## Development

```text
npm test       # Node test suite
npm start      # run Throttle
npm run pack   # unpacked Windows app
npm run dist   # portable + NSIS builds
```

`npx electron . --screenshot=out.png --view=settings` renders the popup (`dashboard`, `customize`, `settings`, `about`, or `welcome`) to a PNG and quits (add `--screenshot-delay=8000` if it comes out blank), which is handy for checking UI changes.

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
