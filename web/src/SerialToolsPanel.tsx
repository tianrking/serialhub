import { useEffect, useState } from "react";
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
    void runJob(`发送文件 · ${source.name}`, async context => {
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
      if (!sequence.length || sequence.some(row => !row.bytes.length || row.bytes.length > 65536)) throw new Error("请选择非空指令，单条指令最多 65,536 bytes");
      const count = rounds;
      void runJob(`轮发 · ${sequence.length} 条 × ${count || "持续"} 轮`, async context => {
        for (let round = 1; count === 0 || round <= count; round++) {
          for (let index = 0; index < sequence.length; index++) {
            const row = sequence[index];
            await context.write(row.bytes);
            setSequenceProgress(`第 ${round} 轮 · ${index + 1}/${sequence.length} · ${row.name}`);
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
    <div className="tool-heading"><div><span className="eyebrow">SERIAL TOOLKIT</span><h2>调试工具箱</h2></div><span className="tag">文件 · 多条发送 · 配置</span></div>
    <div className="tool-tabs" role="tablist" aria-label="调试工具">
      {[["files", "文件收发"], ["sequence", "多条轮发"], ["convert", "编码转换"], ["backup", "配置迁移"]].map(([id, label]) =>
        <button type="button" role="tab" aria-selected={tab === id} aria-controls={`tool-${id}`} id={`tab-${id}`} tabIndex={tab === id ? 0 : -1}
          key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id!)}
          onKeyDown={event => { const ids = ["files", "sequence", "convert", "backup"]; if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault(); const next = ids[(ids.indexOf(tab) + (event.key === "ArrowRight" ? 1 : 3)) % 4]!; setTab(next); document.getElementById(`tab-${next}`)?.focus();
          } }}>{label}</button>)}
    </div>
    {tab === "files" && <div className="tool-columns" role="tabpanel" id="tool-files" aria-labelledby="tab-files">
      <div className="tool-card"><h3>发送文件 <span>原始字节</span></h3><p className="hint">不转换编码、不追加行尾。逐块确认，最多 64 MiB。任务期间续期现有租约，失败即停止。</p>
        <label className="file-picker">选择发送文件<input aria-label="选择发送文件" type="file" disabled={busy} onChange={event => {
          setFile(event.target.files?.[0] ?? null); setSent(0);
        }} /></label>
        {file && <p className={file.size > MAX_SEND_FILE_BYTES ? "error" : "file-info"}>{file.name} · {file.size.toLocaleString()} bytes{file.size > MAX_SEND_FILE_BYTES ? " · 超出 64 MiB 上限" : ""}</p>}
        <div className="row"><label>每块字节<select aria-label="文件每块字节" disabled={busy} value={chunkSize} onChange={event => setChunkSize(Number(event.target.value))}>
          {[64, 256, 1024, 4096].map(size => <option key={size}>{size}</option>)}</select></label>
          <label>块间隔 (ms)<input aria-label="文件块间隔" type="number" min={0} max={60000} disabled={busy} value={interval} onChange={event => setIntervalMs(Math.min(60000, Math.max(0, Number(event.target.value) || 0)))} /></label>
          <button type="button" disabled={!canWrite || busy || !file?.size || file.size > MAX_SEND_FILE_BYTES} onClick={sendFile}>发送文件</button></div>
        <progress aria-label="文件发送进度" max={file?.size || 1} value={sent} /><span className="hint">已确认 {sent.toLocaleString()} / {(file?.size ?? 0).toLocaleString()} bytes</span>
      </div>
      <div className="tool-card"><h3>原始接收录制 <span className={capture.active ? "recording" : ""}>{capture.active ? "● REC" : "BIN"}</span></h3>
        <p className="hint">保存本页收到的完整字节，独立于暂停显示和日志过滤。最多 16 MiB，断流自动停止。</p>
        <div className="capture-size">{capture.bytes.toLocaleString()} <small>bytes</small></div><p className="capture-reason">{capture.reason}</p>
        <div className="row"><button type="button" disabled={!canWrite || capture.active} onClick={() => {
          if (capture.bytes) { notify("请先下载上一段录制，再开始新录制", true); return; }
          capture.start(); repaint(value => value + 1);
        }}>开始录制</button><button type="button" className="ghost" disabled={!capture.active} onClick={() => { capture.stop(); repaint(value => value + 1); }}>停止录制</button>
        <button type="button" className="ghost" disabled={!capture.bytes || capture.active} onClick={() => downloadBlob(`serialhub-rx-${Date.now()}.bin`, capture.blob())}>下载接收文件</button>
        <button type="button" className="ghost" disabled={capture.active || !capture.bytes} onClick={() => { capture.start(); capture.stop("已清除，可开始新录制"); repaint(value => value + 1); }}>清除录制</button></div>
        <p className="hint">录制保存在内存中，关闭页面前请下载。它不保证慢客户端分发期间的数据完整性，完整性请核对事件账本。</p>
      </div>
    </div>}
    {tab === "sequence" && <div role="tabpanel" id="tool-sequence" aria-labelledby="tab-sequence">
      <div className="row sequence-toolbar"><label>循环轮数（0 = 持续）<input aria-label="循环轮数" type="number" min={0} max={100000} value={rounds} disabled={busy} onChange={event => setRounds(Math.min(100000, Math.max(0, Math.trunc(Number(event.target.value) || 0))))} /></label>
        <button type="button" disabled={!canWrite || busy || !commands.length} onClick={sendSequence}>开始轮发</button><span className="hint">{sequenceProgress || `按下方顺序发送 · 文本编码 ${encoding.toUpperCase()}`}</span></div>
      <div className="sequence-list">{!commands.length && <p className="muted">先在快捷指令中保存命令，再选择轮发顺序。</p>}
      {commands.map((command, index) => <div className="sequence-row" key={command.id}>
        <label className="check"><input type="checkbox" aria-label={`轮发 ${command.name}`} checked={command.enabled !== false} disabled={busy} onChange={event => props.onCommandsChange(commands.map(row => row.id === command.id ? { ...row, enabled: event.target.checked } : row))} /><span>{String(index + 1).padStart(2, "0")}</span></label>
        <div className="sequence-command"><strong>{command.name}</strong><code>{command.payload}</code></div><span className="tag">{command.mode.toUpperCase()}</span>
        <label>发送后延时 (ms)<input aria-label={`${command.name} 延时`} type="number" min={50} max={60000} value={command.delayMs ?? 1000} disabled={busy} onChange={event => props.onCommandsChange(commands.map(row => row.id === command.id ? { ...row, delayMs: Math.min(60000, Math.max(50, Number(event.target.value) || 50)) } : row))} /></label>
        <div className="row"><button type="button" className="ghost small" aria-label={`上移 ${command.name}`} disabled={busy || index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" className="ghost small" aria-label={`下移 ${command.name}`} disabled={busy || index === commands.length - 1} onClick={() => move(index, 1)}>↓</button></div>
      </div>)}</div><p className="hint">开始时固定内容与顺序；每条确认后再计时。任务期间续期现有租约，失效时停止，不会重新抢占；写入失败、设备离线或断流都会停止，重连不会续发。</p>
    </div>}
    {tab === "convert" && <div role="tabpanel" id="tool-convert" aria-labelledby="tab-convert" className="tool-columns">
      <div><label className="block">转换输入<textarea aria-label="转换输入" rows={4} maxLength={65536} value={conversion} onChange={event => setConversion(event.target.value)} placeholder="文本或 41 54 0d 0a" /></label><div className="row">
        <button type="button" className="ghost" onClick={() => { try { setConverted(fullHex(encodeText(conversion, encoding))); } catch (error) { report(error); } }}>文本 → HEX</button>
        <button type="button" className="ghost" onClick={() => { try { setConverted(decodeText(hexBytes(conversion), encoding)); } catch (error) { report(error); } }}>HEX → 文本</button></div></div>
      <label className="block">转换结果 · {encoding.toUpperCase()}<textarea aria-label="转换结果" rows={6} value={converted} readOnly /><span className="hint">转换不会发送数据。不可表示的字符会报错。</span></label>
    </div>}
    {tab === "backup" && <div role="tabpanel" id="tool-backup" aria-labelledby="tab-backup" className="tool-columns">
      <div><h3>带走你的调试配置</h3><p className="hint">导出 {commands.length} 条快捷指令、{profiles.length} 个 Hub 连接。不包含令牌、租约或录制文件。</p>
        <button type="button" className="ghost" onClick={() => downloadBlob(`serialhub-workspace-${Date.now()}.json`, new Blob([workspaceBackup(commands, profiles)], { type: "application/json" }))}>导出工作区配置</button></div>
      <div><label className="file-picker">导入配置文件<input aria-label="导入配置文件" type="file" accept=".json,application/json" disabled={busy} onChange={async event => {
        setPendingImport(null);
        const source = event.target.files?.[0]; event.target.value = ""; if (!source) return;
        try { if (source.size > 1024 * 1024) throw new Error("配置文件不能超过 1 MiB"); setPendingImport(parseWorkspaceBackup(await source.text())); } catch (error) { report(error); }
      }} /></label>
      {pendingImport && <div className="import-preview"><strong>预览：{pendingImport.commands.length} 条指令 · {pendingImport.profiles.length} 个连接</strong><p>追加到当前工作区；现有配置保留。</p>
        <div className="row"><button type="button" disabled={busy || commands.length + pendingImport.commands.length > 200 || profiles.length + pendingImport.profiles.length > 50} onClick={() => { props.onImport(pendingImport); setPendingImport(null); }}>确认追加导入</button><button type="button" className="ghost" onClick={() => setPendingImport(null)}>取消导入</button></div>
        {(commands.length + pendingImport.commands.length > 200 || profiles.length + pendingImport.profiles.length > 50) && <p className="error">超出容量，请先删除部分现有配置。</p>}</div>}</div>
    </div>}
  </section>;
}
