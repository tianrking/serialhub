import { t } from "./i18n/index.ts";
import { useEffect, useId, useRef, useState } from "react";
import type { SerialSettings, SerialPortInfo } from "./api/types";

type Inspection = { settings: SerialSettings | null; ports: SerialPortInfo[] };
export default function SerialSettingsPanel({ online, canApply, busy, inspect, apply, sessionKey }: {
  online: boolean; canApply: boolean; busy: boolean; sessionKey: unknown;
  inspect(): Promise<Inspection | null>;
  apply(settings: SerialSettings): Promise<boolean>;
}) {
  const baudListId = useId();
  const [settings, setSettings] = useState<SerialSettings | null>(null);
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  // The generation guards requests, not a DOM node; invalidate them on unmount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { generation.current++; setSettings(null); setPorts([]); setMessage(""); setLoading(false); return () => { generation.current++; }; }, [sessionKey]);
  const load = async () => {
    const current = ++generation.current;
    setLoading(true); setMessage("");
    try { const value = await inspect(); if (current !== generation.current) return;
      if (value) { setSettings(value.settings); setPorts(value.ports); setMessage(t("Settings loaded; server found {p0} serial ports", { p0: String(value.ports.length) })); }
    } catch (error) { if (current === generation.current) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (current === generation.current) setLoading(false); }
  };
  return <details className="hardware-controls serial-settings"><summary>{t("Serial settings & port list")} <span>{t("Devices on the server")}</span></summary>
    <button type="button" className="ghost" disabled={!online || busy || loading} onClick={() => void load()}>{loading ? t("Reading settings…") : t("Read settings & scan ports")}</button>
    {settings && <div className="serial-settings-form">
      <label>{t("Baud rate")} <input aria-label={t("Device baud rate")} type="number" list={baudListId} min={1} max={4000000} value={settings.baud} disabled={busy} onChange={event => setSettings({ ...settings, baud: Math.trunc(Number(event.target.value)) })} /></label>
      <datalist id={baudListId}>{[300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600].map(baud => <option key={baud}>{baud}</option>)}</datalist>
      <label>{t("Data bits")} <select value={settings.databits} disabled={busy} onChange={event => setSettings({ ...settings, databits: Number(event.target.value) })}>{[5, 6, 7, 8].map(bits => <option key={bits}>{bits}</option>)}</select></label>
      <label>{t("Stop bits")} <select value={settings.stopbits} disabled={busy} onChange={event => setSettings({ ...settings, stopbits: Number(event.target.value) })}><option>1</option><option>2</option></select></label>
      <label>{t("Parity")} <select value={settings.parity} disabled={busy} onChange={event => setSettings({ ...settings, parity: event.target.value as SerialSettings["parity"] })}><option value="none">{t("None")}</option><option value="odd">{t("Odd")}</option><option value="even">{t("Even")}</option></select></label>
      <label>{t("Flow control")} <select value={settings.flow} disabled={busy} onChange={event => setSettings({ ...settings, flow: event.target.value as SerialSettings["flow"] })}><option value="none">{t("None")}</option><option value="software">XON/XOFF</option><option value="hardware">RTS/CTS</option></select></label>
      <button type="button" disabled={!canApply || busy || !Number.isInteger(settings.baud) || settings.baud < 1 || settings.baud > 4000000} onClick={async () => {
        const current = generation.current;
        const success = await apply(settings);
        if (current === generation.current) setMessage(success ? t("Device acknowledged new settings (this process only)") : t("Settings not acknowledged; inspect logs and read settings again"));
      }}>{t("Apply serial settings")}</button>
    </div>}
    {message && <p className="hint" role="status">{message}</p>}
    {!!ports.length && <ul className="port-inventory">{ports.map(port => <li key={port.path}><code>{port.path}</code><small>{port.kind}</small></li>)}</ul>}
    <p className="hint">{t("Requires control permission and a valid lease; mock devices are unsupported. Settings are not saved to TOML. To change the physical port, edit the Hub profile and restart.")}</p>
  </details>;
}
