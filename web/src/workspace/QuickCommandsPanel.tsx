import { type CommandMode, type LineEnding } from "../commandUtils";
import { t } from "../i18n/index.ts";
import type { ConsoleWorkspace } from "./useConsoleWorkspace.ts";

export default function QuickCommandsPanel({
  quick,
  serial,
}: Pick<ConsoleWorkspace, "quick" | "serial">) {
  const {
    quickCommands,
    editingCommandId,
    quickName,
    setQuickName,
    quickMode,
    setQuickMode,
    quickPayload,
    setQuickPayload,
    quickLineEnding,
    setQuickLineEnding,
    resetQuickEditor,
    saveQuickCommand,
    editQuickCommand,
    deleteQuickCommand,
  } = quick;
  const { canWrite, busy, transmit } = serial;

  return (
    <section className="panel quick-panel">
      <div className="log-head">
        <div>
          <h2>{t("Shortcuts")}</h2>
          <p className="hint">
            {t(
              "Save common ASCII/Hex commands in this browser for one-click sending.",
            )}
          </p>
        </div>
        {editingCommandId && (
          <button type="button" className="ghost" onClick={resetQuickEditor}>
            {t("Cancel edit")}
          </button>
        )}
      </div>
      <div className="quick-editor">
        <label>
          {t("Name")}{" "}
          <input
            value={quickName}
            onChange={(e) => setQuickName(e.target.value)}
            placeholder={t("e.g. Read version")}
          />
        </label>
        <label>
          {t("Type")}{" "}
          <select
            value={quickMode}
            onChange={(e) => setQuickMode(e.target.value as CommandMode)}
          >
            <option value="text">{t("Plain text")}</option>
            <option value="hex">Hex</option>
          </select>
        </label>
        <label className="quick-payload">
          {t("Content")}{" "}
          <input
            value={quickPayload}
            dir={quickMode === "hex" ? "ltr" : "auto"}
            maxLength={65536}
            onChange={(e) => setQuickPayload(e.target.value)}
            placeholder={quickMode === "text" ? "AT+VERSION?" : "AA 55 01 00"}
          />
        </label>
        {quickMode === "text" && (
          <label>
            {t("Line ending")}{" "}
            <select
              value={quickLineEnding}
              onChange={(e) => setQuickLineEnding(e.target.value as LineEnding)}
            >
              <option value="none">{t("No line ending")}</option>
              <option value="lf">LF</option>
              <option value="cr">CR</option>
              <option value="crlf">CRLF</option>
            </select>
          </label>
        )}
        <button type="button" disabled={busy} onClick={saveQuickCommand}>
          {editingCommandId ? t("Update command") : t("Save command")}
        </button>
      </div>
      <div className="quick-list">
        {quickCommands.length === 0 && (
          <p className="muted">{t("No shortcuts saved yet.")}</p>
        )}
        {quickCommands.map((command) => (
          <div className="quick-item" key={command.id}>
            <div className="quick-item-main">
              <strong>{command.name}</strong>
              <span className="tag">
                {command.mode === "text" ? t("Plain text") : "Hex"}
              </span>
              <code>{command.payload}</code>
              {command.mode === "text" && (
                <span className="muted">{command.lineEnding}</span>
              )}
            </div>
            <div className="row">
              <button
                type="button"
                className="small"
                disabled={!canWrite || busy}
                onClick={() =>
                  void transmit(
                    command.mode,
                    command.payload,
                    command.lineEnding,
                  )
                }
              >
                {t("Send")}
              </button>
              <button
                type="button"
                className="ghost small"
                onClick={() => editQuickCommand(command)}
              >
                {t("Edit")}
              </button>
              <button
                type="button"
                className="ghost small"
                onClick={() => deleteQuickCommand(command)}
              >
                {t("Delete")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
