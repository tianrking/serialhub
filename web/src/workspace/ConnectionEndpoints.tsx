import { httpBase } from "../api/types";
import { t } from "../i18n/index.ts";
import type { ConsoleWorkspace } from "./useConsoleWorkspace.ts";

export default function ConnectionEndpoints({
  connection,
  hub,
  copy,
}: Pick<ConsoleWorkspace, "connection" | "hub"> & {
  copy: (text: string) => Promise<void>;
}) {
  const { conn } = connection;
  const { status, endpoints } = hub;
  const endpointAddress = (address: string) =>
    address.startsWith("/sessions/")
      ? new URL(address, httpBase(conn)).href.replace(/^http/, "ws")
      : address;
  return (
    <section className="panel auxiliary-workspace">
      <h2>{t("Shared endpoints (one physical port → multiple clients)")}</h2>
      <p className="hint">
        {t(
          "Serial applications use PTY paths; scripts use TCP; agents and this page use WebSocket.",
        )}
      </p>
      <table>
        <thead>
          <tr>
            <th>{t("Endpoint type")}</th>
            <th>{t("Endpoint name")}</th>
            <th>{t("Address")}</th>
            <th>{t("Read/write")}</th>
            <th>{t("Description")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {endpoints.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                {t("No data; connect first")}
              </td>
            </tr>
          )}
          {endpoints.map((ep) => (
            <tr key={`${ep.kind}-${ep.name}-${ep.address}`}>
              <td>
                <span className="tag">{ep.kind}</span>
              </td>
              <td>{ep.name}</td>
              <td>
                <code>{endpointAddress(ep.address)}</code>
              </td>
              <td>
                {ep.can_read ? "R" : "-"}/{ep.can_write ? "W" : "-"}
              </td>
              <td className="note">{ep.note}</td>
              <td>
                <button
                  type="button"
                  className="ghost small"
                  onClick={() => void copy(endpointAddress(ep.address))}
                >
                  {t("Copy")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{t("Current fan-out clients")}</h3>
      <table>
        <thead>
          <tr>
            <th>{t("Endpoint name")}</th>
            <th>{t("Endpoint type")}</th>
            <th>{t("Read/write")}</th>
            <th>id</th>
          </tr>
        </thead>
        <tbody>
          {(status?.clients ?? []).map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.kind}</td>
              <td>
                {c.can_read ? "R" : "-"}/{c.can_write ? "W" : "-"}
              </td>
              <td>
                <code className="small">{c.id}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
