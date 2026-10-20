# Multi-port workspace

Available in v0.4.0 source/candidate builds. Published v0.2.3 does not include this mode.

Open devices in the manager, then select **Multi-port workspace**. It is also
available in the single-device selector and the SerialHub application menu.
Each panel follows one existing device session: it never opens another physical
owner. All panels subscribe at the same time, including panels on other pages.

## Everyday use

- Choose 2, 4 or 6 panels per page. Short desktop windows automatically show two
  panels so send controls remain accessible; the saved larger layout returns
  when space permits. Narrow screens scroll inside the workspace.
- Each panel has device identity, baud, physical/stream state, recent RX, a Text/Hex
  send buffer and a visible destination. Ctrl/Command+Enter sends only from the
  focused panel's composer. There is no implicit broadcast send.
- **Focus panel** expands one panel; **Restore grid** returns to the same page.
  **Open full workspace** provides the existing scope, protocols, file tools and
  device controls. Panel drafts and recent acquisition survive these switches.
- Pause a panel or all displays to inspect a snapshot. Reception continues into
  bounded memory; resume displays the retained recent data. Clear affects this
  display, not the physical device, other subscribers or the event ledger.
- Text RX uses a streaming decoder with newline assembly across WebSocket packets;
  UTF-8 and GBK receive modes are available; a change applies to subsequent data.
  Hex shows byte previews independently.
  Send encoding and line ending are per panel; Hex sends exact atomic bytes.
- Filter and export the displayed log. Export uses the current display/filter,
  including a paused snapshot. Device payloads are never translated or executed
  as HTML. Six interface languages, including Arabic RTL, are supported.
- **Panel tools** provides receive/transmit encodings and write lease controls.
  Leases expire unless explicitly renewed. Another holder blocks sending; a race
  is still rejected by the backend and displayed without automatic retry.
- Closing a device is a separate, confirmed action in Panel tools. It closes that
  owner's clients. Removing a device unmounts its panel and cancels its requests;
  a new session for the same port starts with a new identity and empty draft.

## Reliability and limits

This mode is a recent-log display, not a full raw recorder. Each panel keeps at
most 400 text entries and 400 Hex previews; individual text lines are limited to
2,048 UTF-16 code units and Hex previews to 128 bytes per RX chunk. Truncation is
marked. Rendering is batched at 100 ms, hidden panels avoid RX-driven React updates,
and paused snapshots are immutable. The backend's own queues/ledger are separately
bounded. Watch RX drop counters and validate device sequence numbers/CRC for
loss-sensitive work. Use the full workspace's recording/export tools for captures.

Acquisition starts when this browser first opens multi-port mode. Before that,
older evidence is available through the existing event ledger, subject to its
retention limits. Closing/reloading the browser loses panel drafts/recent display;
closing the page also stops its browser-side jobs. Device owners keep running
until explicitly closed or the application exits.

A previously visited full workspace retains its own subscription, drafts and
explicit jobs. Multi-port panels add lightweight subscriptions to the same owner;
there can be two browser subscriptions for a device visited in both views. This
never creates duplicate physical-port owners. Do not assume switching a view
cancels a timed job deliberately started in the full workspace.

Every send waits for a host write/flush result, which is not a device protocol
acknowledgement. Replies are shared RX; they are not privately routed back to the
sender. Use a lease for coordinated request/response and implement device framing.
Connection/epoch changes invalidate in-flight UI results; commands are not replayed.

The original manager still controls inventory and LAN pairing. Pairing revocation
and application shutdown close panel streams through the existing session gates.
Mock/browser/PTY checks do not certify a physical adapter, driver or long-duration
hardware run. See `HARDWARE_CHECK.zh-CN.md` for Windows acceptance.
