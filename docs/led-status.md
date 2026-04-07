# keeBLEr LED Status Guide

The keeBLEr firmware drives a single status LED to convey what the device is
doing at a glance. On boards with a WS2812-class addressable RGB LED (e.g. the
**ESP32-S3 SuperMini**) the indication is fully colour-coded; on boards with a
plain GPIO LED (e.g. **XIAO ESP32S3**) the same state machine collapses to
on/off.

## Colour semantics

The colours are deliberate, not arbitrary:

| Channel | Meaning |
|---|---|
| **Blue**    | BLE state (advertising / connected to a central) |
| **Green**   | WiFi state (STA associated, or AP with a client connected) |
| **Cyan**    | BLE *and* WiFi (the natural mix of blue + green) |
| **Magenta** | A 5-second heartbeat overlay that fires whenever the host has actually mounted the USB HID composite device |
| **Red**     | Failure state — either a fatal init error (slow blink) or a transient operation failure (double-blink) |
| **Yellow**  | Bad WiFi credentials (double-blink) |
| **White**   | A successful operation (double-blink) |

Once you internalise *blue = BLE, green = WiFi, cyan = both*, the rest of the
state machine is intuitive.

## Three layers

The renderer composes the LED colour from three independent layers, in
order of increasing priority. Higher layers override lower ones for the
duration that they are active.

```
   ┌────────────────────────────────────────┐
   │   3. HID heartbeat (magenta, 5 s)      │  highest priority (overlay)
   ├────────────────────────────────────────┤
   │   2. Transient indication              │
   │      (WORKING / SUCCESS / FAIL / etc.) │
   ├────────────────────────────────────────┤
   │   1. Base colour                       │  lowest priority
   │      (driven by BLE/WiFi/AP flags)     │
   └────────────────────────────────────────┘
```

A FreeRTOS task runs in the background at 50 ms (20 fps) and recomposes
the LED on every tick from the *current* state, so the LED can never be
more than 50 ms stale relative to what the firmware actually thinks is
true. The base layer flags themselves are refreshed every 200 ms by the
main loop, so the absolute upper bound on stale rendering is ~250 ms.

### Layer 1 — Base colour (link state)

| Situation | Colour |
|---|---|
| **Idle** — no BLE, no WiFi | Blue blink, ~1 Hz (100 ms on, 900 ms off) |
| **BLE connected**, no WiFi | Solid blue |
| **BLE + WiFi AP active, no client yet** | Solid blue base, with a cyan flash followed by a yellow flash 500 ms later, repeating every 1 s |
| **BLE + WiFi AP, client connected** | Solid cyan |
| **BLE + WiFi STA connected** | Solid cyan |
| **WiFi STA connected**, BLE dropped | Solid green |
| **WiFi AP, client connected**, no BLE | Solid green |
| **WiFi AP listening**, no client, no BLE | Solid green base, with a cyan flash at the start of every second |
| **Fatal error** at boot (e.g. HID bridge init failed) | Slow red blink, ~2 Hz |

The base layer is recomputed every iteration of `main.c`'s main loop from
fresh reads of `kb_ble_is_connected()`, `kb_wifi_get_state()`, and
`kb_wifi_get_ap_client_count()`. It cannot get out of sync with reality —
if BLE drops, the next tick reflects it.

### Layer 2 — Transient indications

These are short overlays the firmware fires when it starts, finishes, or
fails an operation. They temporarily replace the base colour, then revert.

| Indication | Colour | Duration | When fired |
|---|---|---|---|
| `WORKING`    | Soft spinning red → green → blue cycle, ~450 ms per full rotation | Loops until cleared (or ~30 s safety watchdog) | A WiFi scan or connect operation has started |
| `SUCCESS`    | Double white blink | ~400 ms (one-shot) | Operation succeeded — scan returned, STA got an IP |
| `FAIL_AUTH`  | Double yellow blink | ~400 ms (one-shot) | WiFi connect failed with an auth-related reason code (wrong password, EAPOL timeout, etc.) |
| `FAIL`       | Double red blink | ~400 ms (one-shot) | Any other operation failure (no AP found, set\_config failed, init failed) |

After a one-shot indication finishes, the LED reverts to whatever the
*current* base layer is — which may have changed in the meantime if BLE
was dropped while the operation was running.

#### Watchdog

`WORKING` is the only indication that can stay active for more than half
a second. If something goes wrong and the operation never reports back
(driver hang, weird AP behaviour), a 30-second watchdog inside
`led_status.c:compose()` automatically promotes `WORKING` to `FAIL`, so
the LED can never get permanently stuck in the spinner.

### Layer 3 — HID heartbeat overlay

When the USB host has actually mounted the keeBLEr's HID composite
device, a brief (~80 ms) magenta flash is overlaid on top of whatever
the other two layers produced, every 5 seconds. This tells you the host
is wired up and ready to receive HID reports — independent of BLE or
WiFi.

If the host unplugs, unmounts, or sleeps the device, the heartbeat
stops on the next tick.

## At-a-glance reference

If the LED is...

- **Pulsing slow blue** → Idle, no client. Open the keeBLEr web app and click Connect BLE.
- **Solid blue** → BLE connected. The web app is talking to the device.
- **Solid blue with cyan/yellow flashes** → BLE + AP mode active, waiting for someone to join the AP.
- **Solid cyan** → BLE + WiFi (either AP-with-client or STA-connected). Everything is up.
- **Solid green** → WiFi only — BLE has dropped, but WiFi is still up.
- **Solid green with a cyan blip per second** → AP listening, no BLE.
- **Spinning RGB at low intensity** → The firmware is actively scanning or connecting WiFi.
- **Double white blink** → Last operation succeeded.
- **Double yellow blink** → Last WiFi connect failed: bad credentials.
- **Double red blink** → Last WiFi operation failed for some other reason.
- **Slow red blink (~2 Hz)** → Fatal init error. Power-cycle the board and check serial logs.
- **Magenta blip every 5 seconds (overlaid)** → Host has the HID device mounted and is ready to receive reports.

## Boards with no RGB LED

Boards using a plain GPIO LED (XIAO, DevKitC-1 in its current config) or
no LED at all (QT Py without NeoPixel power, generic) all run the same
state machine — the renderer just collapses any non-zero colour to "on"
on the GPIO. So you'll see the *blink patterns* but not the colours.
The semantics are the same; you just lose the colour cues.

## Implementation pointers

- `firmware/main/led_status.h` — public API: `led_status_init()`,
  `led_status_set_link()`, `led_status_set_hid_mounted()`,
  `led_status_indicate()`.
- `firmware/main/led_status.c` — renderer task, base/indication/heartbeat
  composition, three hardware backends (NONE / GPIO / WS2812).
- `firmware/main/board_config.h` — per-board `BOARD_LED_TYPE`,
  `BOARD_LED_PIN`, and `BOARD_LED_PIXEL_RGB` (set on the SuperMini whose
  WS2812 clone uses RGB byte order on the wire instead of GRB).
- `firmware/main/wifi_proxy.c` — calls `led_status_indicate(WORKING)` /
  `(SUCCESS|FAIL|FAIL_AUTH)` from the scan and connect paths, and
  maintains the AP-client count consumed by the base layer.
- `firmware/main/main.c` — the main loop calls
  `led_status_set_link(...)` and `led_status_set_hid_mounted(...)` every
  ~200 ms with fresh state, so the base layer is always current.
