import { t } from "../i18n/index.ts";
import Icon from "../Icon";
import WorkspaceDialog from "../WorkspaceDialog";
import type { ConsoleWorkspace } from "./useConsoleWorkspace.ts";

export default function ConnectionPanel({
  connection,
  hub,
  lifecycle,
}: Pick<ConsoleWorkspace, "connection" | "hub" | "lifecycle">) {
  const {
    hostInput,
    setHostInput,
    portInput,
    setPortInput,
    protocolInput,
    setProtocolInput,
    connectionProfiles,
    selectedProfileId,
    profileName,
    setProfileName,
    apiTokenInput,
    setApiTokenInput,
    saveConnectionProfile,
    loadConnectionProfile,
    deleteConnectionProfile,
  } = connection;
  const { phase, online, status, error } = hub;
  const { connect, disconnect } = lifecycle;

  return (
    <section className="panel connect">
      <div className="connection-heading">
        <h2>
          <Icon name="layers" size={16} /> {t("Connection profiles")}
        </h2>
        <span>
          {online
            ? status?.port.path.startsWith("mock:")
              ? t("Mock device · no hardware required")
              : t("Device session")
            : t("Local Hub or HTTPS reverse proxy")}
        </span>
      </div>
      <div className="row">
        <label>
          {t("Host")}{" "}
          <input
            value={hostInput}
            onChange={(e) => setHostInput(e.target.value)}
            placeholder="127.0.0.1"
          />
        </label>
        <label>
          {t("Port")}{" "}
          <input
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            placeholder="8787"
            className="port"
          />
        </label>
        <label>
          {t("Protocol")}{" "}
          <select
            aria-label={t("Connection protocol")}
            value={protocolInput}
            onChange={(event) =>
              setProtocolInput(event.target.value as "http" | "https")
            }
          >
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
          </select>
        </label>
        <label>
          {t("Access token (optional)")}{" "}
          <input
            type="password"
            autoComplete="off"
            value={apiTokenInput}
            onChange={(e) => setApiTokenInput(e.target.value)}
            placeholder={t("Used only for this session")}
          />
        </label>
        <button
          type="button"
          disabled={phase === "connecting"}
          onClick={() => void connect()}
        >
          {phase === "connecting"
            ? t("Connecting to Hub…")
            : online
              ? t("Reconnect")
              : t("Connect to Hub")}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={phase === "idle"}
          onClick={disconnect}
        >
          {t("Disconnect")}
        </button>
      </div>
      <WorkspaceDialog
        label={t("Connection profiles")}
        className="profile-settings"
      >
        <p className="hint">{t("Saved in this browser without tokens.")}</p>
        <div className="row profile-row">
          <label>
            {t("Connection profile")}{" "}
            <select
              value={selectedProfileId}
              onChange={(e) => loadConnectionProfile(e.target.value)}
            >
              <option value="">{t("Select a saved profile")}</option>
              {connectionProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} · {profile.host}:{profile.port}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Profile name")}{" "}
            <input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder={t("e.g. Local Hub")}
            />
          </label>
          <button
            type="button"
            className="ghost"
            onClick={saveConnectionProfile}
          >
            {t("Save profile")}
          </button>
          <button
            type="button"
            className="ghost"
            disabled={!selectedProfileId}
            onClick={deleteConnectionProfile}
          >
            {t("Delete profile")}
          </button>
        </div>
      </WorkspaceDialog>
      {!online && !error && (
        <p className="connection-help">
          {t("First time? On the device host, run")}{" "}
          <code>serialhub share mock:demo</code> {t("to try mock loopback.")}
        </p>
      )}
      {error && (
        <p className="error connection-error" role="alert">
          {error}
          <span>
            {t(
              "Check the address, token and Hub, then reconnect. Writes are never retried automatically.",
            )}
          </span>
        </p>
      )}
    </section>
  );
}
