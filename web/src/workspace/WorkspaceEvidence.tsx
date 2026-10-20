import EventLedgerPanel from "../EventLedgerPanel";
import MetricsPanel from "../MetricsPanel";
import type { ConsoleWorkspace } from "./useConsoleWorkspace.ts";

export default function WorkspaceEvidence({
  evidence,
  hub,
}: Pick<ConsoleWorkspace, "evidence" | "hub">) {
  const {
    ledgerStatus,
    ledgerEvents,
    ledgerLoading,
    ledgerError,
    metricsText,
    metricsLoading,
    metricsError,
    refreshLedger,
    refreshMetrics,
    exportLedger,
    exportMetrics,
  } = evidence;
  const { online } = hub;

  return (
    <div className="auxiliary-workspace events-workspace">
      <EventLedgerPanel
        status={ledgerStatus}
        events={ledgerEvents}
        loading={ledgerLoading}
        error={ledgerError}
        online={online}
        onRefresh={() => void refreshLedger()}
        onExport={() => void exportLedger()}
      />
      <MetricsPanel
        text={metricsText}
        loading={metricsLoading}
        error={metricsError}
        online={online}
        onRefresh={() => void refreshMetrics()}
        onExport={exportMetrics}
      />
    </div>
  );
}
