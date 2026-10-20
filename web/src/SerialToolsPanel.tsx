import CopyButton from "./Clipboard";
import { t, getFormattingLocale, localizeStatus } from "./i18n/index.ts";
import { useEffect, useId, useState } from "react";
import type { QuickCommand, ConnectionProfile } from "./commandUtils";
import { commandBytes, downloadBlob, encodeText, decodeText, fullHex, hexBytes, MAX_SEND_FILE_BYTES,
  parseWorkspaceBackup, workspaceBackup, type RawCapture, type RunSerialJob, type TextEncoding,
  type WorkspaceBackup } from "./serialTools";

type Props = {
  canWrite: boolean; busy: boolean; capture: RawCapture; runJob: RunSerialJob;
  commands: QuickCommand[]; profiles: ConnectionProfile[]; encoding: TextEncoding;
  onCommandsChange(commands: QuickCommand[]): void;
  onImport(backup: WorkspaceBackup): void;
  notify(message: string, error?: boolean): void;
};
export default function SerialToolsPanel(props: Props) {
  const toolsId = useId();
  const { canWrite, busy, capture, runJob, commands, profiles, encoding, notify } = props;
  const [tab, setTab] = useState("files");
  const [file, setFile] = useState<File | null>(null);
  const [chunkSize, setChunkSize] = useState(1024);
  const [interval, setIntervalMs] = useState(50);
  const [sent, setSent] = useState(0);
  const [rounds, setRounds] = useState(1);
  const [sequenceProgress, setSequenceProgress] = useState("");
  const [conversion, setConversion] = useState("");
  const [converted, setConverted] = useState("");
  const [pendingImport, setPendingImport] = useState<WorkspaceBackup | null>(null);
  const [, repaint] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => repaint(value => value + 1), 250); return () => clearInterval(timer); }, []);
  const report = (error: unknown) => notify(error instanceof Error ? error.message : String(error), true);

  const sendFile = () => {
    if (!file || file.size < 1 || file.size > MAX_SEND_FILE_BYTES) return;
    const source = file, size = chunkSize, gap = interval;
    setSent(0);
    void runJob(t("File transfer · {p0}", { p0: String(source.name) }), async context => {
      for (let offset = 0; offset < source.size; offset += size) {
        context.signal.throwIfAborted();
        const bytes = new Uint8Array(await source.slice(offset, offset + size).arrayBuffer());
        await context.write(bytes);
        setSent(offset + bytes.length);
        if (offset + size < source.size) await context.pause(gap);
      }
    });
  };
  const sendSequence = () => {
    try {
      // Validate every row before sending any byte. Freeze the job's contents.
      const sequence = commands.filter(command => command.enabled !== false).map(command => ({
        name: command.name, bytes: commandBytes(command, encoding), delay: command.delayMs ?? 1000,
      }));
      if (!sequence.length || sequence.some(row => !row.bytes.length || row.bytes.length > 65536)) throw new Error(t("Select nonempty commands; maximum 65,536 bytes per command"));
      const count = rounds;
      void runJob(t("Sequence · {p0} commands × {p1} rounds", { p0: String(sequence.length), p1: String(count || t("Continuous")) }), async context => {
        for (let round = 1; count === 0 || round <= count; round++) {
          for (let index = 0; index < sequence.length; index++) {
            const row = sequence[index];
            await context.write(row.bytes);
            setSequenceProgress(t("Round {p0} · {p1}/{p2} · {p3}", { p0: String(round), p1: String(index + 1), p2: String(sequence.length), p3: String(row.name) }));
            if (index < sequence.length - 1 || count === 0 || round < count) await context.pause(row.delay);
          }
        }
      });
    } catch (error) { report(error); }
  };
  const move = (index: number, delta: number) => {
    const next = [...commands];
    [next[index], next[index + delta]] = [next[index + delta]!, next[index]!];
    props.onCommandsChange(next);
  };
  return <section className="panel serial-tools-panel">
    <div className="tool-heading"><div><span className="eyebrow">{t("SERIAL TOOLKIT")}</span><h2>{t("Serial toolkit")}</h2></div><span className="tag">{t("Files · sequences · profiles")}</span></div>
    <div className="tool-tabs" role="tablist" aria-label={t("Debugging tools")}>
      {[["files", t("Files")], ["sequence", t("Sequences")], ["convert", t("Encoding")], ["backup", t("Backup")]].map(([id, label]) =>
        <button type="button" role="tab" aria-selected={tab === id} aria-controls={`${toolsId}-tool-${id}`} id={`${toolsId}-tab-${id}`} tabIndex={tab === id ? 0 : -1}
          key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id!)}
          onKeyDown={event => { const ids = ["files", "sequence", "convert", "backup"]; if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault(); const next = ids[(ids.indexOf(tab) + (event.key === "ArrowRight" ? 1 : 3)) % 4]!; setTab(next); document.getElementById(`${toolsId}-tab-${next}`)?.focus();
          } }}>{label}</button>)}
    </div>
    {tab === "files" && <div className="tool-columns" role="tabpanel" id={`${toolsId}-tool-files`} aria-labelledby={`${toolsId}-tab-files`}>
      <div className="tool-card"><h3>{t("Send file")} <span>{t("Raw bytes")}</span></h3><p className="hint">{t("No encoding conversion or added line endings. Acknowledged blocks, up to 64 MiB. Renews the existing lease; stops on failure.")}</p>
        <label className="file-picker">{t("Choose file to send")} <input aria-label={t("Choose file to send")} type="file" disabled={busy} onChange={event => {
          setFile(event.target.files?.[0] ?? null); setSent(0);
        }} /></label>
        {file && <p className={file.size > MAX_SEND_FILE_BYTES ? "error" : "file-info"}>{file.name} · {file.size.toLocaleString(getFormattingLocale())} {t("bytes")} {file.size > MAX_SEND_FILE_BYTES ? t("· exceeds the 64 MiB limit") : ""}</p>}
        <div className="row"><label>{t("Block size")} <select aria-label={t("File block size")} disabled={busy} value={chunkSize} onChange={event => setChunkSize(Number(event.target.value))}>
          {[64, 256, 1024, 4096].map(size => <option key={size}>{size}</option>)}</select></label>
          <label>{t("Block delay (ms)")} <input aria-label={t("File block delay")} type="number" min={0} max={60000} disabled={busy} value={interval} onChange={event => setIntervalMs(Math.min(60000, Math.max(0, Number(event.target.value) || 0)))} /></label>
          <button type="button" disabled={!canWrite || busy || !file?.size || file.size > MAX_SEND_FILE_BYTES} onClick={sendFile}>{t("Send file")}</button></div>
        <progress aria-label={t("File send progress")} max={file?.size || 1} value={sent} /><span className="hint">{t("Acknowledged")} {sent.toLocaleString(getFormattingLocale())} / {(file?.size ?? 0).toLocaleString(getFormattingLocale())} {t("bytes")}</span>
      </div>
      <div className="tool-card"><h3>{t("Raw RX recording")} <span className={capture.active ? "recording" : ""}>{capture.active ? "● REC" : "BIN"}</span></h3>
        <p className="hint">{t("Save full received bytes independently of display pause and filters. Up to 16 MiB; stops on stream loss.")}</p>
        <div className="capture-size">{capture.bytes.toLocaleString(getFormattingLocale())} <small>{t("bytes")}</small></div><p className="capture-reason">{localizeStatus(capture.reason)}</p>
        <div className="row"><button type="button" disabled={!canWrite || capture.active} onClick={() => {
          if (capture.bytes) { notify(t("Download the previous recording before starting another"), true); return; }
          capture.start(); repaint(value => value + 1);
        }}>{t("Start recording")}</button><button type="button" className="ghost" disabled={!capture.active} onClick={() => { capture.stop(); repaint(value => value + 1); }}>{t("Stop recording")}</button>
        <button type="button" className="ghost" disabled={!capture.bytes || capture.active} onClick={() => downloadBlob(`serialhub-rx-${Date.now()}.bin`, capture.blob())}>{t("Download RX file")}</button>
        <button type="button" className="ghost" disabled={capture.active || !capture.bytes} onClick={() => { capture.start(); capture.stop(t("Cleared; ready for a new recording")); repaint(value => value + 1); }}>{t("Clear recording")}</button></div>
        <p className="hint">{t("Recording is held in memory; download before closing. Slow-client drops may cause gaps. Check the event ledger for completeness.")}</p>
      </div>
    </div>}
    {tab === "sequence" && <div role="tabpanel" id={`${toolsId}-tool-sequence`} aria-labelledby={`${toolsId}-tab-sequence`}>
      <div className="row sequence-toolbar"><label>{t("Rounds (0 = continuous)")} <input aria-label={t("Sequence rounds")} type="number" min={0} max={100000} value={rounds} disabled={busy} onChange={event => setRounds(Math.min(100000, Math.max(0, Math.trunc(Number(event.target.value) || 0))))} /></label>
        <button type="button" disabled={!canWrite || busy || !commands.length} onClick={sendSequence}>{t("Start sequence")}</button><span className="hint">{sequenceProgress || t("Sends in the order below · text encoding {p0}", { p0: String(encoding.toUpperCase()) })}</span></div>
      <div className="sequence-list">{!commands.length && <p className="muted">{t("Save shortcuts first, then choose the sequence order.")}</p>}
      {commands.map((command, index) => <div className="sequence-row" key={command.id}>
        <label className="check"><input type="checkbox" aria-label={t("Sequence {p0}", { p0: String(command.name) })} checked={command.enabled !== false} disabled={busy} onChange={event => props.onCommandsChange(commands.map(row => row.id === command.id ? { ...row, enabled: event.target.checked } : row))} /><span>{String(index + 1).padStart(2, "0")}</span></label>
        <div className="sequence-command"><strong>{command.name}</strong><code>{command.payload}</code></div><span className="tag">{command.mode.toUpperCase()}</span>
        <label>{t("Delay after send (ms)")} <input aria-label={t("{p0} delay", { p0: String(command.name) })} type="number" min={50} max={60000} value={command.delayMs ?? 1000} disabled={busy} onChange={event => props.onCommandsChange(commands.map(row => row.id === command.id ? { ...row, delayMs: Math.min(60000, Math.max(50, Number(event.target.value) || 50)) } : row))} /></label>
        <div className="row"><button type="button" className="ghost small" aria-label={t("Move {p0} up", { p0: String(command.name) })} disabled={busy || index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" className="ghost small" aria-label={t("Move {p0} down", { p0: String(command.name) })} disabled={busy || index === commands.length - 1} onClick={() => move(index, 1)}>↓</button></div>
      </div>)}</div><p className="hint">{t("Content and order are fixed at start. Delays begin after each ACK. Renews only the existing lease; stops on expiry, write failure, device or stream loss. Reconnection never resumes sending.")}</p>
    </div>}
    {tab === "convert" && <div role="tabpanel" id={`${toolsId}-tool-convert`} aria-labelledby={`${toolsId}-tab-convert`} className="tool-columns">
      <div><label className="block">{t("Conversion input")} <textarea aria-label={t("Conversion input")} rows={4} maxLength={65536} value={conversion} onChange={event => setConversion(event.target.value)} placeholder={t("Text or 41 54 0d 0a")} /></label><div className="row">
        <button type="button" className="ghost" onClick={() => { try { setConverted(fullHex(encodeText(conversion, encoding))); } catch (error) { report(error); } }}>{t("Text → HEX")}</button>
        <button type="button" className="ghost" onClick={() => { try { setConverted(decodeText(hexBytes(conversion), encoding)); } catch (error) { report(error); } }}>{t("HEX → Text")}</button></div></div>
      <label className="block">{t("Conversion result ·")} {encoding.toUpperCase()}<textarea aria-label={t("Conversion result")} rows={6} value={converted} readOnly /><CopyButton label="Copy result" text={converted} disabled={!converted} /><span className="hint">{t("Conversion does not send data. Unsupported characters cause an error.")}</span></label>
    </div>}
    {tab === "backup" && <div role="tabpanel" id={`${toolsId}-tool-backup`} aria-labelledby={`${toolsId}-tab-backup`} className="tool-columns">
      <div><h3>{t("Take your debugging setup with you")}</h3><p className="hint">{t("Export")} {commands.length} {t("shortcuts and")} {profiles.length} {t("Hub profiles. Tokens, leases and recordings are excluded.")}</p>
        <button type="button" className="ghost" onClick={() => downloadBlob(`serialhub-workspace-${Date.now()}.json`, new Blob([workspaceBackup(commands, profiles)], { type: "application/json" }))}>{t("Export workspace settings")}</button></div>
      <div><label className="file-picker">{t("Import settings file")} <input aria-label={t("Import settings file")} type="file" accept=".json,application/json" disabled={busy} onChange={async event => {
        setPendingImport(null);
        const source = event.target.files?.[0]; event.target.value = ""; if (!source) return;
        try { if (source.size > 1024 * 1024) throw new Error(t("Settings file must not exceed 1 MiB")); setPendingImport(parseWorkspaceBackup(await source.text())); } catch (error) { report(error); }
      }} /></label>
      {pendingImport && <div className="import-preview"><strong>{t("Preview:")} {pendingImport.commands.length} {t("commands ·")} {pendingImport.profiles.length} {t("connections")}</strong><p>{t("Append to this workspace; existing settings stay.")}</p>
        <div className="row"><button type="button" disabled={busy || commands.length + pendingImport.commands.length > 200 || profiles.length + pendingImport.profiles.length > 50} onClick={() => { props.onImport(pendingImport); setPendingImport(null); }}>{t("Confirm append import")}</button><button type="button" className="ghost" onClick={() => setPendingImport(null)}>{t("Cancel import")}</button></div>
        {(commands.length + pendingImport.commands.length > 200 || profiles.length + pendingImport.profiles.length > 50) && <p className="error">{t("Capacity exceeded; remove some existing settings first.")}</p>}</div>}</div>
    </div>}
  </section>;
}
