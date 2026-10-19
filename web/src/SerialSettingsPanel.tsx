import { useEffect, useRef, useState } from "react";
import type { SerialSettings, SerialPortInfo } from "./api/types";

type Inspection = { settings: SerialSettings | null; ports: SerialPortInfo[] };
export default function SerialSettingsPanel({ online, canApply, busy, inspect, apply, sessionKey }: {
  online: boolean; canApply: boolean; busy: boolean; sessionKey: unknown;
  inspect(): Promise<Inspection | null>;
  apply(settings: SerialSettings): Promise<boolean>;
}) {
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
      if (value) { setSettings(value.settings); setPorts(value.ports); setMessage(`已读取当前参数；服务端发现 ${value.ports.length} 个串口`); }
    } catch (error) { if (current === generation.current) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (current === generation.current) setLoading(false); }
  };
  return <details className="hardware-controls serial-settings"><summary>串口参数与端口列表 <span>服务端设备</span></summary>
    <button type="button" className="ghost" disabled={!online || busy || loading} onClick={() => void load()}>{loading ? "正在读取…" : "读取参数与扫描端口"}</button>
    {settings && <div className="serial-settings-form">
      <label>波特率<input aria-label="设备波特率" type="number" list="baud-rates" min={1} max={4000000} value={settings.baud} disabled={busy} onChange={event => setSettings({ ...settings, baud: Math.trunc(Number(event.target.value)) })} /></label>
      <datalist id="baud-rates">{[300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600].map(baud => <option key={baud}>{baud}</option>)}</datalist>
      <label>数据位<select value={settings.databits} disabled={busy} onChange={event => setSettings({ ...settings, databits: Number(event.target.value) })}>{[5, 6, 7, 8].map(bits => <option key={bits}>{bits}</option>)}</select></label>
      <label>停止位<select value={settings.stopbits} disabled={busy} onChange={event => setSettings({ ...settings, stopbits: Number(event.target.value) })}><option>1</option><option>2</option></select></label>
      <label>奇偶校验<select value={settings.parity} disabled={busy} onChange={event => setSettings({ ...settings, parity: event.target.value as SerialSettings["parity"] })}><option value="none">无</option><option value="odd">奇</option><option value="even">偶</option></select></label>
      <label>流控<select value={settings.flow} disabled={busy} onChange={event => setSettings({ ...settings, flow: event.target.value as SerialSettings["flow"] })}><option value="none">无</option><option value="software">XON/XOFF</option><option value="hardware">RTS/CTS</option></select></label>
      <button type="button" disabled={!canApply || busy || !Number.isInteger(settings.baud) || settings.baud < 1 || settings.baud > 4000000} onClick={async () => {
        const current = generation.current;
        const success = await apply(settings);
        if (current === generation.current) setMessage(success ? "设备已确认新参数（本次进程内生效）" : "参数未确认，请检查日志并重新读取参数");
      }}>应用串口参数</button>
    </div>}
    {message && <p className="hint" role="status">{message}</p>}
    {!!ports.length && <ul className="port-inventory">{ports.map(port => <li key={port.path}><code>{port.path}</code><small>{port.kind}</small></li>)}</ul>}
    <p className="hint">调整需要服务端控制权限与有效租约；模拟设备不支持。参数不会写回配置文件。端口列表用于检查，切换物理设备请修改 Hub 配置并重启。</p>
  </details>;
}
