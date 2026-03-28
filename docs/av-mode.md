# keeBLEr AV

**keeBLEr AV** extends the base keeBLEr with HDMI capture, audio passthrough, and video display modes.

## What it adds

- **HDMI capture** — see the target computer's screen in your browser via a USB capture card
- **Audio passthrough** — hear the target's audio with volume control
- **Video mode selection** — choose from detected resolutions (probed at startup)
- **Large / Fullscreen** — expand the video to fill the browser window

## Setup

### Capture card

Any USB HDMI capture card that works with `getUserMedia()` in Chrome. Tested with:

- **MacroSilicon USB3.0** (534d:2109) — [Amazon](https://www.amazon.com/dp/B092PX5XQ9)
  - MJPG: up to 1920x1080 @ 60fps
  - Browser label: "USB3. 0 capture"

Plug the capture card into the computer running the keeBLEr web app. Connect the target computer's HDMI output to the capture card's HDMI input.

### Accessing keeBLEr AV

- **GitHub Pages:** `https://shawnrancatore.github.io/keeBLEr/av/`
- **Docker:** `https://your-ip:8443/av/`

### Audio notes

Chrome applies voice processing (AGC, echo cancellation, noise suppression) to captured audio by default. keeBLEr AV disables all three for clean HDMI audio passthrough. The log shows:

- `Audio processing disabled: AGC=off EC=off NS=off` — clean passthrough
- `Audio processing ACTIVE: AGC=ON ...` — Chrome ignored the request; try reloading

### Video modes

On startup, keeBLEr AV probes the capture card for supported resolutions. The dropdown shows only modes the device actually supports. "Auto" tries 1080p60 first, then 720p60.

### Keyboard shortcuts

When not connected to a BLE device:

- **L** — toggle large mode
- **F** — toggle fullscreen

## Requirements

- HTTPS (for `getUserMedia` — provided by GitHub Pages or Docker)
- Chrome, Edge, or Brave (WebRTC video capture support)
- USB HDMI capture card
