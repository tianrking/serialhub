import { useState } from "react";
import { newCommandId, newProfileId } from "../commandUtils";
import { t } from "../i18n/index.ts";
import ProtocolInspectorPanel from "../ProtocolInspectorPanel";
import { protocolLabel } from "../protocolUtils";
import SerialToolsPanel from "../SerialToolsPanel";
import WaveformPanel from "../WaveformPanel";
import CommandComposer from "./CommandComposer";
import ConsoleLogPanel from "./ConsoleLogPanel";
import DeviceControls from "./DeviceControls";
import QuickCommandsPanel from "./QuickCommandsPanel";
import type { ConsoleWorkspace } from "./useConsoleWorkspace.ts";

export default function MonitorWorkspace({
  connection,
  quick,
  receiver,
  serial,
  hub,
  logging,
  copy,
  workspaceId,
  visible,
  onSignals,
}: Pick<
  ConsoleWorkspace,
  "connection" | "quick" | "receiver" | "serial" | "hub" | "logging"
> & {
  copy: (text: string) => Promise<void>;
  workspaceId: string;
  visible: boolean;
  onSignals: () => void;
}) {
  const { connectionProfiles, setConnectionProfiles } = connection;
  const { quickCommands, setQuickCommands } = quick;
  const {
    capture,
    streamProtocol,
    signalStore,
    protocolFrames,
    clearProtocolFrames,
  } = receiver;
  const { canWrite, busy, textEncoding, runJob } = serial;
  const { pushLog } = logging;
  const [dockTab, setDockTab] = useState("device");
  return (
    <div className="grid" hidden={!visible}>
      <CommandComposer serial={serial} />

      <aside className="workbench-dock" aria-label={t("Workspace tool panel")}>
        <div
          className="dock-tabs"
          role="tablist"
          aria-label={t("Workspace tools")}
        >
          {(
            [
              ["device", t("Device settings")],
              ["quick", t("Shortcuts")],
              ["tools", t("Toolkit")],
              ["protocol", t("Protocol frames")],
            ] as const
          ).map(([id, label], index, tabs) => (
            <button
              type="button"
              role="tab"
              key={id}
              id={`${workspaceId}-dock-tab-${id}`}
              aria-controls={`${workspaceId}-dock-${id}`}
              aria-selected={dockTab === id}
              tabIndex={dockTab === id ? 0 : -1}
              onClick={() => setDockTab(id)}
              onKeyDown={(event) => {
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : event.key === "ArrowRight"
                        ? (index + 1) % tabs.length
                        : event.key === "ArrowLeft"
                          ? (index + tabs.length - 1) % tabs.length
                          : -1;
                if (next >= 0) {
                  event.preventDefault();
                  setDockTab(tabs[next]![0]);
                  document
                    .getElementById(`${workspaceId}-dock-tab-${tabs[next]![0]}`)
                    ?.focus();
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="dock-content">
          <div
            role="tabpanel"
            id={`${workspaceId}-dock-device`}
            aria-labelledby={`${workspaceId}-dock-tab-device`}
            hidden={dockTab !== "device"}
          >
            <DeviceControls serial={serial} hub={hub} />
          </div>
          <div
            role="tabpanel"
            id={`${workspaceId}-dock-quick`}
            aria-labelledby={`${workspaceId}-dock-tab-quick`}
            hidden={dockTab !== "quick"}
          >
            <QuickCommandsPanel quick={quick} serial={serial} />
          </div>
          <div
            role="tabpanel"
            id={`${workspaceId}-dock-tools`}
            aria-labelledby={`${workspaceId}-dock-tab-tools`}
            hidden={dockTab !== "tools"}
          >
            <SerialToolsPanel
              canWrite={canWrite}
              busy={busy}
              capture={capture}
              runJob={runJob}
              commands={quickCommands}
              profiles={connectionProfiles}
              encoding={textEncoding}
              onCommandsChange={setQuickCommands}
              notify={(text, failure) =>
                pushLog({ kind: failure ? "err" : "sys", text })
              }
              onImport={(backup) => {
                setQuickCommands((previous) => [
                  ...previous,
                  ...backup.commands.map((command) => ({
                    ...command,
                    id: newCommandId(),
                  })),
                ]);
                setConnectionProfiles((previous) => [
                  ...previous,
                  ...backup.profiles.map((profile) => ({
                    ...profile,
                    id: newProfileId(),
                  })),
                ]);
                pushLog({
                  kind: "sys",
                  text: t(
                    "Appended {p0} commands and {p1} connection profiles",
                    {
                      p0: String(backup.commands.length),
                      p1: String(backup.profiles.length),
                    },
                  ),
                });
              }}
            />
          </div>
          <div
            role="tabpanel"
            id={`${workspaceId}-dock-protocol`}
            aria-labelledby={`${workspaceId}-dock-tab-protocol`}
            hidden={dockTab !== "protocol"}
          >
            <ProtocolInspectorPanel
              protocol={streamProtocol}
              frames={protocolFrames}
              onClear={clearProtocolFrames}
            />
            {["raw", "firewater", "justfloat", "binary", "image"].includes(
              streamProtocol,
            ) && (
              <p className="hint dock-empty">
                {t(
                  "Select NMEA, SLIP, COBS or Modbus in the terminal parser to inspect frames. Use Signal studio for numbers and images.",
                )}
              </p>
            )}
          </div>
        </div>
      </aside>
      <ConsoleLogPanel
        receiver={receiver}
        hub={hub}
        logging={logging}
        copy={copy}
      />

      <WaveformPanel
        connected={canWrite}
        store={signalStore}
        protocolLabel={protocolLabel(streamProtocol)}
        onOpen={onSignals}
      />
    </div>
  );
}
