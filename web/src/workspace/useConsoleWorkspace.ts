import { useCallback, useEffect, useRef } from "react";
import type { ConnectionConfig } from "../api/types.ts";
import { t } from "../i18n/index.ts";
import { useHubConnection } from "../useHubConnection.ts";
import { useConnectionSettings } from "./useConnectionSettings.ts";
import { useConsoleLog } from "./useConsoleLog.ts";
import { useQuickCommands } from "./useQuickCommands.ts";
import { useReceiveStream } from "./useReceiveStream.ts";
import { useSerialTransmission } from "./useSerialTransmission.ts";
import { useWorkspaceEvidence } from "./useWorkspaceEvidence.ts";

export function useConsoleWorkspace(
  managedConnection: ConnectionConfig | undefined,
  eventsVisible: boolean,
) {
  const hub = useHubConnection();
  const logging = useConsoleLog();
  const connection = useConnectionSettings(managedConnection, logging.pushLog);
  const receiver = useReceiveStream(
    logging.pushLog,
    logging.pausedRef,
    hub.online &&
      hub.phase === "connected" &&
      hub.status?.port.connected === true,
    hub.status?.port.epoch,
  );
  const serial = useSerialTransmission(
    hub,
    logging.pushLog,
    receiver.trafficRef,
  );
  const quick = useQuickCommands(logging.pushLog);
  const evidence = useWorkspaceEvidence(hub, eventsVisible, logging.pushLog);
  const { disconnect: stopConnection, connect: startConnection } = hub;
  const { invalidateOperations } = serial;
  const { prepareStream, stopReceiving } = receiver;
  const { resetEvidence } = evidence;
  const { hostInput, portInput, protocolInput, inputBearerToken, setConn } =
    connection;
  const disconnect = useCallback(() => {
    invalidateOperations(t("Session disconnected"));
    stopReceiving(t("Session disconnected; recording stopped"));
    stopConnection();
    resetEvidence();
  }, [invalidateOperations, stopReceiving, stopConnection, resetEvidence]);
  const connect = useCallback(async () => {
    disconnect();
    const cfg: ConnectionConfig = managedConnection ?? {
      host: hostInput.trim(),
      port: Number(portInput),
      protocol: protocolInput,
    };
    const handlers = prepareStream(cfg);
    const connected = await startConnection(cfg, inputBearerToken, {
      ...handlers,
      onClose: () => {
        invalidateOperations(t("Live stream interrupted"));
        handlers.onClose();
      },
    });
    if (!connected) return;
    setConn(cfg);
    try {
      if (!managedConnection)
        localStorage.setItem("ohmyserial.web.conn", JSON.stringify(cfg));
    } catch {
      /* Memory-only still works. */
    }
  }, [
    managedConnection,
    disconnect,
    hostInput,
    portInput,
    protocolInput,
    inputBearerToken,
    prepareStream,
    startConnection,
    setConn,
    invalidateOperations,
  ]);
  const managedConnect = useRef(connect);
  managedConnect.current = connect;
  useEffect(() => {
    if (!managedConnection) return;
    void managedConnect.current();
    return disconnect;
  }, [managedConnection, disconnect]);
  return {
    hub,
    logging,
    connection,
    receiver,
    serial,
    quick,
    evidence,
    lifecycle: { connect, disconnect },
  };
}
export type ConsoleWorkspace = ReturnType<typeof useConsoleWorkspace>;
