import { type HexChecksum } from "../checksumUtils";
import { type CommandMode, type LineEnding } from "../commandUtils";
import { t } from "../i18n/index.ts";
import Icon from "../Icon";
import { type TextEncoding } from "../serialTools";
import type { ConsoleWorkspace } from "./useConsoleWorkspace.ts";

export default function CommandComposer({
  serial,
}: Pick<ConsoleWorkspace, "serial">) {
  const {
    canWrite,
    busy,
    textEncoding,
    setTextEncoding,
    sendText,
    setSendText,
    sendHistory,
    sendMode,
    setSendMode,
    sendHex,
    setSendHex,
    hexChecksum,
    setHexChecksum,
    checksumStart,
    setChecksumStart,
    checksumEnd,
    setChecksumEnd,
    lineEnding,
    setLineEnding,
    autoSend,
    setAutoSend,
    autoIntervalMs,
    setAutoIntervalMs,
    autoMode,
    setAutoMode,
    onSendText,
    onSendHex,
    hexPreview,
  } = serial;

  return (
    <section className="panel composer-panel">
      <div className="composer-heading">
        <h2>{t("Send command")}</h2>
        <span>{t("Host write acknowledgement")}</span>
      </div>
      {sendHistory.length > 0 && (
        <label className="send-history">
          {t("Recent sends")}{" "}
          <select
            aria-label={t("Recent sends")}
            value=""
            onChange={(event) => {
              const item = sendHistory[Number(event.target.value)];
              if (!item) return;
              setSendMode(item.mode);
              setTextEncoding(item.encoding);
              setLineEnding(item.ending);
              setHexChecksum(item.checksum);
              setChecksumStart(item.start);
              setChecksumEnd(item.end);
              if (item.mode === "text") setSendText(item.payload);
              else setSendHex(item.payload);
            }}
          >
            <option value="">{t("Load history (does not send)")}</option>
            {sendHistory.map((item, index) => (
              <option key={index} value={index}>
                {item.mode.toUpperCase()} · {item.payload.slice(0, 35)}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="segmented" role="group" aria-label={t("Send format")}>
        <button
          type="button"
          className={sendMode === "text" ? "active" : ""}
          aria-pressed={sendMode === "text"}
          onClick={() => setSendMode("text")}
        >
          {t("Text")}
        </button>
        <button
          type="button"
          className={sendMode === "hex" ? "active" : ""}
          aria-pressed={sendMode === "hex"}
          onClick={() => setSendMode("hex")}
        >
          {t("HEX bytes")}
        </button>
      </div>
      <div hidden={sendMode !== "text"}>
        <label className="block">
          {t("Message")}{" "}
          <textarea
            dir="auto"
            rows={3}
            maxLength={65536}
            value={sendText}
            onChange={(e) => setSendText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                onSendText();
              }
            }}
            placeholder={t("e.g. AT or a device command")}
          />
        </label>
        <div className="row composer-options">
          <label>
            {t("Text encoding")}{" "}
            <select
              aria-label={t("Send text encoding")}
              value={textEncoding}
              onChange={(event) =>
                setTextEncoding(event.target.value as TextEncoding)
              }
            >
              <option value="utf-8">UTF-8</option>
              <option value="gbk">{t("GBK / ANSI Chinese")}</option>
              <option value="ascii">{t("ASCII (strict)")}</option>
            </select>
          </label>
          <label>
            {t("Line ending")}{" "}
            <select
              value={lineEnding}
              onChange={(e) => setLineEnding(e.target.value as LineEnding)}
            >
              <option value="none">{t("No line ending")}</option>
              <option value="lf">LF (\\n)</option>
              <option value="cr">CR (\\r)</option>
              <option value="crlf">CRLF (\\r\\n)</option>
            </select>
          </label>
          <span className="hint inline-hint">
            {t("Ctrl/⌘ + Enter to send")}
          </span>
        </div>
        <button
          type="button"
          className="send-button"
          disabled={!canWrite || busy || !sendText.length}
          onClick={() => void onSendText()}
        >
          {t("Send text")}
        </button>
      </div>
      <div hidden={sendMode !== "hex"}>
        <label className="block">
          {t("Hexadecimal")}{" "}
          <input
            className="hex-send-input"
            value={sendHex}
            dir="ltr"
            maxLength={196608}
            onChange={(e) => setSendHex(e.target.value)}
            placeholder="41 54 0d 0a"
          />
        </label>
        <div className="row composer-options">
          <label>
            {t("Checksum")}{" "}
            <select
              value={hexChecksum}
              onChange={(e) => setHexChecksum(e.target.value as HexChecksum)}
            >
              <option value="none">{t("No checksum")}</option>
              <option value="sum8">SUM8</option>
              <option value="sum16">SUM16 (Lo/Hi)</option>
              <option value="crc32">CRC32/ISO-HDLC (Lo/Hi)</option>
              <option value="xor8">XOR8</option>
              <option value="crc16-modbus">CRC16-Modbus (Lo/Hi)</option>
              <option value="crc16-ccitt">CRC16-CCITT (Hi/Lo)</option>
            </select>
          </label>
          {hexChecksum !== "none" && (
            <div className="checksum-range">
              <label>
                {t("Checksum start byte")}{" "}
                <input
                  aria-label={t("Checksum start byte")}
                  type="number"
                  min={1}
                  value={checksumStart}
                  onChange={(event) =>
                    setChecksumStart(
                      Math.max(1, Math.trunc(Number(event.target.value) || 1)),
                    )
                  }
                />
              </label>
              <label>
                {t("End byte (0 = last)")}{" "}
                <input
                  aria-label={t("Checksum end byte")}
                  type="number"
                  min={0}
                  value={checksumEnd}
                  onChange={(event) =>
                    setChecksumEnd(
                      Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                    )
                  }
                />
              </label>
              <small>{t("One-based, inclusive range")}</small>
            </div>
          )}
          {hexPreview.text && (
            <span
              className={`hint inline-hint ${hexPreview.invalid ? "error" : ""}`}
            >
              {t("Send preview:")} <code dir="ltr">{hexPreview.text}</code>
            </span>
          )}
        </div>
        <button
          type="button"
          className="send-button"
          disabled={!canWrite || busy || !sendHex.trim() || hexPreview.invalid}
          onClick={() => void onSendHex()}
        >
          {t("Send Hex")}
        </button>
      </div>
      <details className="auto-send-settings">
        <summary>
          {t("Scheduled sending")}{" "}
          <span>{t("Stops on stream loss or write failure")}</span>
        </summary>
        <div className="row auto-send-row">
          <label className="check">
            <input
              type="checkbox"
              checked={autoSend}
              onChange={(e) => setAutoSend(e.target.checked)}
              disabled={!canWrite || (busy && !autoSend)}
            />{" "}
            {t("Repeat current content")}
          </label>
          <label>
            {t("Mode")}{" "}
            <select
              value={autoMode}
              onChange={(e) => setAutoMode(e.target.value as CommandMode)}
            >
              <option value="text">{t("Plain text")}</option>
              <option value="hex">Hex</option>
            </select>
          </label>
          <label>
            {t("Interval (ms)")}{" "}
            <input
              className="interval-input"
              type="number"
              min={50}
              max={86400000}
              step={50}
              value={autoIntervalMs}
              onChange={(e) =>
                setAutoIntervalMs(
                  Math.min(
                    86400000,
                    Math.max(50, Number(e.target.value) || 50),
                  ),
                )
              }
            />
          </label>
        </div>
      </details>
      <p className="composer-note">
        <Icon name="shield" size={14} />{" "}
        {t("Shared TX arbitration; a host ACK is not a device response.")}
      </p>
    </section>
  );
}
