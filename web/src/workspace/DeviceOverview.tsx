import { getFormattingLocale, t } from "../i18n/index.ts";
import Icon from "../Icon";
import type { ConsoleWorkspace } from "./useConsoleWorkspace.ts";

export default function DeviceOverview({
  serial,
  hub,
  logging,
}: Pick<ConsoleWorkspace, "serial" | "hub" | "logging">) {
  const { canWrite, busy, leaseToken, onLock, onUnlock } = serial;
  const { online, status, refreshMeta } = hub;
  const { pushLog } = logging;

  return (
    <section className="overview" aria-label={t("Device overview")}>
      <div className="overview-device">
        <span className={`device-indicator ${canWrite ? "ready" : ""}`}>
          <Icon name="terminal" size={23} />
        </span>
        <div>
          <small>{t("Device")}</small>
          <strong>
            {online ? status?.port.path : t("Waiting for connection")}
          </strong>
          <span>
            {online
              ? `${status?.port.baud.toLocaleString(getFormattingLocale())} baud · ${status?.port.connected ? t("Device open") : t("Device offline")}`
              : t("Choose a Hub to start debugging")}
          </span>
        </div>
        {online && status?.port.path.startsWith("mock:") && (
          <b className="simulation-label">MOCK</b>
        )}
      </div>
      <div>
        <small>{t("RX received")}</small>
        <strong>
          {online
            ? status?.stats.rx_bytes.toLocaleString(getFormattingLocale())
            : "—"}
          <span>{t("bytes")}</span>
        </strong>
      </div>
      <div>
        <small>{t("TX sent")}</small>
        <strong>
          {online
            ? status?.stats.tx_bytes.toLocaleString(getFormattingLocale())
            : "—"}
          <span>{t("bytes")}</span>
        </strong>
      </div>
      <div>
        <small>{t("Clients online")}</small>
        <strong>
          {online ? status?.clients.length : "—"}
          <span>{t("clients")}</span>
        </strong>
      </div>
      <div className={status?.stats.rx_drops ? "has-drops" : ""}>
        <small>{t("RX drops")}</small>
        <strong>
          {online
            ? status?.stats.rx_drops.toLocaleString(getFormattingLocale())
            : "—"}
          <span>{t("chunks")}</span>
        </strong>
      </div>
      <div className="lease-actions">
        <button
          type="button"
          disabled={!canWrite || busy}
          onClick={() => void onLock()}
        >
          {t("Acquire write lease")}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={!canWrite || busy || !leaseToken}
          onClick={() => void onUnlock()}
        >
          {t("Release lease")}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={!canWrite || busy}
          onClick={() =>
            void refreshMeta().catch((failure) =>
              pushLog({
                kind: "err",
                text: t("Status read failed: {p0}", {
                  p0: String(
                    failure instanceof Error
                      ? failure.message
                      : String(failure),
                  ),
                }),
              }),
            )
          }
        >
          {t("Refresh status")}
        </button>
      </div>
    </section>
  );
}
