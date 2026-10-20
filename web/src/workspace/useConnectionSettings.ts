import { useEffect, useState } from "react";
import type { ConnectionConfig } from "../api/types";
import { validateConnection } from "../api/types";
import {
  CONNECTION_PROFILES_STORAGE_KEY,
  loadConnectionProfiles,
  newProfileId,
  type ConnectionProfile,
} from "../commandUtils";
import { t } from "../i18n/index.ts";
import type { PushLog } from "./consoleLogStore.ts";

const STORAGE_KEY = "ohmyserial.web.conn";
function defaultConn(): ConnectionConfig {
  // 同源：由 hub 提供 http://127.0.0.1:8787/ 時自動連同一主機埠
  if (typeof window !== "undefined") {
    const host = window.location.hostname || "127.0.0.1";
    const portStr = window.location.port;
    const port = portStr
      ? Number(portStr)
      : window.location.protocol === "https:"
        ? 443
        : 80;
    // Vite 開發伺服器 → 仍連預設 hub
    if (port === 5173 || port === 4173) {
      return { host: "127.0.0.1", port: 8787 };
    }
    if (host) {
      return {
        host,
        port: port || 8787,
        protocol: window.location.protocol === "https:" ? "https" : "http",
      };
    }
  }
  return { host: "127.0.0.1", port: 8787 };
}

function loadConn(): ConnectionConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return validateConnection(JSON.parse(raw) as ConnectionConfig);
  } catch {
    /* ignore */
  }
  return defaultConn();
}

/** Connection form and saved profiles; credentials stay in session memory. */
export function useConnectionSettings(
  managedConnection: ConnectionConfig | undefined,
  pushLog: PushLog,
) {
  const [conn, setConn] = useState<ConnectionConfig>(
    () => managedConnection ?? loadConn(),
  );
  const [hostInput, setHostInput] = useState(conn.host);
  const [portInput, setPortInput] = useState(String(conn.port));
  const [protocolInput, setProtocolInput] = useState<"http" | "https">(
    conn.protocol ?? "http",
  );
  const [connectionProfiles, setConnectionProfiles] = useState<
    ConnectionProfile[]
  >(loadConnectionProfiles);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [profileName, setProfileName] = useState("");
  const [apiTokenInput, setApiTokenInput] = useState("");
  const inputBearerToken = apiTokenInput.trim() || undefined;
  useEffect(() => {
    try {
      localStorage.setItem(
        CONNECTION_PROFILES_STORAGE_KEY,
        JSON.stringify(connectionProfiles),
      );
    } catch {
      // Keep profiles usable in memory when storage is unavailable.
    }
  }, [connectionProfiles]);
  const saveConnectionProfile = () => {
    const name = profileName.trim();
    const host = hostInput.trim();
    const port = Number(portInput);
    if (!name || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
      pushLog({
        kind: "err",
        text: t("A profile needs a name, host and valid port"),
      });
      return;
    }
    const profile: ConnectionProfile = {
      id: selectedProfileId || newProfileId(),
      name,
      host,
      port,
      protocol: protocolInput,
    };
    setConnectionProfiles((previous) =>
      [profile, ...previous.filter((item) => item.id !== profile.id)].slice(
        0,
        50,
      ),
    );
    setSelectedProfileId(profile.id);
    setProfileName(profile.name);
    pushLog({
      kind: "sys",
      text: t("Connection profile saved: {p0}", { p0: String(profile.name) }),
    });
  };
  const loadConnectionProfile = (id: string) => {
    setSelectedProfileId(id);
    const profile = connectionProfiles.find((item) => item.id === id);
    if (!profile) return;
    setProfileName(profile.name);
    setHostInput(profile.host);
    setPortInput(String(profile.port));
    setProtocolInput(profile.protocol ?? "http");
    pushLog({
      kind: "sys",
      text: t("Connection profile loaded: {p0}", { p0: String(profile.name) }),
    });
  };
  const deleteConnectionProfile = () => {
    if (!selectedProfileId) return;
    const profile = connectionProfiles.find(
      (item) => item.id === selectedProfileId,
    );
    setConnectionProfiles((previous) =>
      previous.filter((item) => item.id !== selectedProfileId),
    );
    setSelectedProfileId("");
    setProfileName("");
    if (profile)
      pushLog({
        kind: "sys",
        text: t("Connection profile deleted: {p0}", {
          p0: String(profile.name),
        }),
      });
  };

  return {
    conn,
    setConn,
    hostInput,
    setHostInput,
    portInput,
    setPortInput,
    protocolInput,
    setProtocolInput,
    connectionProfiles,
    setConnectionProfiles,
    selectedProfileId,
    profileName,
    setProfileName,
    apiTokenInput,
    setApiTokenInput,
    inputBearerToken,
    saveConnectionProfile,
    loadConnectionProfile,
    deleteConnectionProfile,
  };
}
