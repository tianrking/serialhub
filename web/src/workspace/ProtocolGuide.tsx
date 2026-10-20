import { httpBase, wsUrl } from "../api/types";
import CopyButton from "../Clipboard";
import { t } from "../i18n/index.ts";
import type { ConsoleWorkspace } from "./useConsoleWorkspace.ts";

export default function ProtocolGuide({
  connection,
}: Pick<ConsoleWorkspace, "connection">) {
  const { conn } = connection;

  return (
    <section className="panel protocol auxiliary-workspace">
      <h2>{t("Protocol essentials")}</h2>
      <p>
        {t("Full documentation in the repository:")}{" "}
        <code>web/PROTOCOL.zh-TW.md</code>
      </p>
      <div className="protocol-columns">
        <section>
          <h3>HTTP</h3>
          <CopyButton label="Copy API address" text={httpBase(conn)} />
          <code className="protocol-address">{httpBase(conn)}</code>
          <ul>
            <li>
              <code>GET /v1/health</code> {t("— health check")}
            </li>
            <li>
              <code>GET /v1/status</code>{" "}
              {t("— port, lease, counters and clients")}
            </li>
            <li>
              <code>GET /v1/endpoints</code> {t("— shared endpoint list")}
            </li>
            <li>
              <code>POST /v1/write</code> —{" "}
              <code>{`{"text":"...","newline":true,"as_client":"web-ui"}`}</code>{" "}
              {t("or")} <code>hex</code>
            </li>
            <li>
              <code>POST /v1/lock</code> · <code>DELETE /v1/lock</code>
            </li>
          </ul>
        </section>
        <section>
          <h3>
            WebSocket <code>/v1/stream</code>
          </h3>
          <CopyButton label="Copy stream address" text={wsUrl(conn)} />
          <code className="protocol-address">{wsUrl(conn)}</code>
          <ul>
            <li>
              <strong>{t("Downstream binary")}</strong>{" "}
              {t(": raw device RX bytes (first packet may include history)")}
            </li>
            <li>
              <strong>{t("Upstream text")}</strong> {t(": sent as TX; without")}{" "}
              <code>\n</code> {t("the Hub appends a line ending")}
            </li>
            <li>
              <strong>{t("Upstream binary")}</strong>{" "}
              {t(": forwarded unchanged through the TX policy")}
            </li>
            <li>
              {t("For acknowledged writes, use HTTP")} <code>/v1/write</code>{" "}
              {t("(returns ok/error)")}
            </li>
          </ul>
        </section>
      </div>
      <h3>{t("Usage notes")}</h3>
      <ul>
        <li>
          {t(
            "One physical port supports multiple PTY/TCP/WS clients; RX is broadcast to all readers",
          )}
        </li>
        <li>{t("TX defaults to line queues to prevent interleaved bytes")}</li>
        <li>
          {t("An HTTPS page may be blocked from using local ws:// connections")}
        </li>
      </ul>
    </section>
  );
}
