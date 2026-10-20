import { t } from "../i18n/index.ts";
import Icon from "../Icon";
import SerialSettingsPanel from "../SerialSettingsPanel";
import type { ConsoleWorkspace } from "./useConsoleWorkspace.ts";

export default function DeviceControls({
  serial,
  hub,
}: Pick<ConsoleWorkspace, "serial" | "hub">) {
  const {
    canWrite,
    busy,
    leaseToken,
    leaseRemaining,
    breakDurationMs,
    setBreakDurationMs,
    inspectSerial,
    applySerial,
    onControl,
  } = serial;
  const { online, status, activeSession } = hub;

  return (
    <section className="panel device-panel">
      <h2>
        <Icon name="shield" size={17} /> {t("Device & write permissions")}
      </h2>
      {status ? (
        <dl className="kv">
          <dt>{t("Device path")}</dt>
          <dd>
            {status.port.path}{" "}
            <span className={status.port.connected ? "tag ok" : "tag off"}>
              {status.port.connected ? t("Open") : t("Disconnected")}
            </span>
          </dd>
          <dt>{t("Baud rate")}</dt>
          <dd>{status.port.baud}</dd>
          <dt>{t("Connection details")}</dt>
          <dd>{status.port.detail}</dd>
          <dt>{t("TX mode")}</dt>
          <dd>
            <code>{status.tx_mode}</code>
          </dd>
          <dt>{t("Write lease")}</dt>
          <dd>
            {status.lock_owner
              ? t("{p0} ({p1} ms remaining)", {
                  p0: String(status.lock_owner),
                  p1: String(status.lock_expires_ms ?? "?"),
                })
              : t("Not held")}
          </dd>
          <dt>{t("Statistics")}</dt>
          <dd>
            RX {status.stats.rx_bytes} · TX {status.stats.tx_bytes} · drop{" "}
            {status.stats.rx_drops} · deny {status.stats.tx_denies}
          </dd>
          <dt>{t("Client count")}</dt>
          <dd>{status.clients.length}</dd>
        </dl>
      ) : (
        <p className="muted">{t("Not connected yet")}</p>
      )}
      <SerialSettingsPanel
        online={online}
        busy={busy}
        canApply={
          canWrite && !!leaseToken && !status?.port.path.startsWith("mock:")
        }
        inspect={inspectSerial}
        apply={applySerial}
        sessionKey={activeSession()}
      />
      {leaseToken && (
        <p className="lease-countdown" role="status">
          {t("This page holds the lease · remaining")}{" "}
          {(leaseRemaining / 1000).toFixed(1)} {t("seconds")}
        </p>
      )}
      <details className="hardware-controls">
        <summary>
          {t("Hardware control lines")}{" "}
          <span>
            {status?.port.path.startsWith("mock:")
              ? t("Unsupported by mock devices")
              : t("Requires server permission and a valid lease")}
          </span>
        </summary>
        <div className="row control-row">
          <button
            type="button"
            className="ghost"
            disabled={
              !canWrite ||
              busy ||
              !leaseToken ||
              status?.port.path.startsWith("mock:")
            }
            onClick={() => void onControl({ op: "dtr", level: true })}
          >
            DTR ON
          </button>
          <button
            type="button"
            className="ghost"
            disabled={
              !canWrite ||
              busy ||
              !leaseToken ||
              status?.port.path.startsWith("mock:")
            }
            onClick={() => void onControl({ op: "dtr", level: false })}
          >
            DTR OFF
          </button>
          <button
            type="button"
            className="ghost"
            disabled={
              !canWrite ||
              busy ||
              !leaseToken ||
              status?.port.path.startsWith("mock:")
            }
            onClick={() => void onControl({ op: "rts", level: true })}
          >
            RTS ON
          </button>
          <button
            type="button"
            className="ghost"
            disabled={
              !canWrite ||
              busy ||
              !leaseToken ||
              status?.port.path.startsWith("mock:")
            }
            onClick={() => void onControl({ op: "rts", level: false })}
          >
            RTS OFF
          </button>
          <label>
            BREAK (ms)
            <input
              className="interval-input"
              type="number"
              min={1}
              max={1000}
              value={breakDurationMs}
              onChange={(e) =>
                setBreakDurationMs(
                  Math.min(1000, Math.max(1, Number(e.target.value) || 1)),
                )
              }
            />
          </label>
          <button
            type="button"
            className="ghost"
            disabled={
              !canWrite ||
              busy ||
              !leaseToken ||
              status?.port.path.startsWith("mock:")
            }
            onClick={() =>
              void onControl({ op: "break", duration_ms: breakDurationMs })
            }
          >
            {t("Send BREAK")}
          </button>
        </div>
      </details>
    </section>
  );
}
