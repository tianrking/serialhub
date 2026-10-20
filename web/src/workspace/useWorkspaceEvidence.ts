import { useCallback, useEffect, useRef, useState } from "react";
import { hubApi } from "../api/client";
import type { LedgerEvent, LedgerStatus } from "../api/types";
import { t } from "../i18n/index.ts";
import type { PushLog } from "./consoleLogStore.ts";
import { downloadTextFile } from "./download.ts";
import type { HubConnection } from "./types.ts";

const RECENT_EVENT_LIMIT = 200;

/** Session-scoped event and metric reads, exports and cancellation. */
export function useWorkspaceEvidence(
  hub: HubConnection,
  enabled: boolean,
  pushLog: PushLog,
) {
  const [ledgerStatus, setLedgerStatus] = useState<LedgerStatus | null>(null);
  const [ledgerEvents, setLedgerEvents] = useState<LedgerEvent[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const ledgerAbortRef = useRef<AbortController | null>(null);
  const [metricsText, setMetricsText] = useState("");
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const metricsAbortRef = useRef<AbortController | null>(null);
  const { activeSession, isCurrent, online } = hub;
  const refreshLedger = useCallback(async () => {
    const session = activeSession();
    if (!session || !isCurrent(session)) return;
    const { cfg, bearerToken } = session;
    ledgerAbortRef.current?.abort();
    const controller = new AbortController();
    ledgerAbortRef.current = controller;
    setLedgerLoading(true);
    setLedgerError(null);
    try {
      // The status high-water mark is required before asking for a stable
      // recent window, so this dependency is intentionally sequential.
      const nextStatus = await hubApi.eventsStatus(
        cfg,
        bearerToken,
        AbortSignal.any([controller.signal, session.signal]),
      );
      if (
        !Number.isSafeInteger(nextStatus.newest_seq) ||
        nextStatus.newest_seq < 0
      ) {
        throw new Error(
          t("Event sequence exceeds the browser's safe integer range"),
        );
      }
      const oldestCursor = Math.max(
        0,
        (nextStatus.oldest_available_seq ?? 1) - 1,
      );
      const recentCursor = Math.max(
        0,
        nextStatus.newest_seq - RECENT_EVENT_LIMIT,
      );
      const response = await hubApi.events(
        cfg,
        {
          afterSeq: Math.max(oldestCursor, recentCursor),
          throughSeq: nextStatus.newest_seq,
          limit: RECENT_EVENT_LIMIT,
        },
        bearerToken,
        AbortSignal.any([controller.signal, session.signal]),
      );
      if (response.session_id !== nextStatus.session_id) {
        throw new Error(t("Ledger session changed; refresh the status"));
      }
      if (!isCurrent(session) || controller.signal.aborted) return;
      setLedgerStatus(nextStatus);
      setLedgerEvents(response.page.events);
    } catch (ledgerFailure) {
      if (
        isCurrent(session) &&
        !controller.signal.aborted &&
        !(
          ledgerFailure instanceof DOMException &&
          ledgerFailure.name === "AbortError"
        )
      ) {
        setLedgerError(
          t("Cannot read the event ledger: {p0}", {
            p0: String(
              ledgerFailure instanceof Error
                ? ledgerFailure.message
                : String(ledgerFailure),
            ),
          }),
        );
      }
    } finally {
      if (ledgerAbortRef.current === controller) {
        ledgerAbortRef.current = null;
        setLedgerLoading(false);
      }
    }
  }, [activeSession, isCurrent]);
  const refreshMetrics = useCallback(async () => {
    const session = activeSession();
    if (!session || !isCurrent(session)) return;
    const { cfg, bearerToken } = session;
    metricsAbortRef.current?.abort();
    const controller = new AbortController();
    metricsAbortRef.current = controller;
    setMetricsLoading(true);
    setMetricsError(null);
    try {
      const text = await hubApi.metrics(
        cfg,
        bearerToken,
        AbortSignal.any([controller.signal, session.signal]),
      );
      if (isCurrent(session) && !controller.signal.aborted)
        setMetricsText(text);
    } catch (metricsFailure) {
      if (
        isCurrent(session) &&
        !controller.signal.aborted &&
        !(
          metricsFailure instanceof DOMException &&
          metricsFailure.name === "AbortError"
        )
      ) {
        setMetricsError(
          metricsFailure instanceof Error
            ? metricsFailure.message
            : String(metricsFailure),
        );
      }
    } finally {
      if (metricsAbortRef.current === controller) {
        metricsAbortRef.current = null;
        setMetricsLoading(false);
      }
    }
  }, [activeSession, isCurrent]);
  useEffect(() => {
    if (!enabled || !online) return;
    const session = activeSession();
    if (!session) return;
    void refreshLedger();
    void refreshMetrics();
    return () => {
      ledgerAbortRef.current?.abort();
      metricsAbortRef.current?.abort();
    };
  }, [enabled, online, activeSession, refreshLedger, refreshMetrics]);
  const exportLedger = async () => {
    const session = activeSession();
    if (!session || !isCurrent(session)) return;
    try {
      const ndjson = await hubApi.eventsExport(
        session.cfg,
        session.bearerToken,
        session.signal,
      );
      if (!isCurrent(session)) return;
      downloadTextFile(
        `serialhub-events-${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson`,
        ndjson,
        "application/x-ndjson;charset=utf-8",
      );
      pushLog({
        kind: "sys",
        text: t("Exported {p0} event records", {
          p0: String(ndjson.split("\n").filter(Boolean).length),
        }),
      });
    } catch (exportFailure) {
      if (isCurrent(session))
        pushLog({
          kind: "err",
          text: t("Event export failed: {p0}", {
            p0: String(
              exportFailure instanceof Error
                ? exportFailure.message
                : String(exportFailure),
            ),
          }),
        });
    }
  };
  const exportMetrics = () => {
    downloadTextFile(
      `serialhub-metrics-${new Date().toISOString().replace(/[:.]/g, "-")}.prom`,
      metricsText,
      "text/plain;charset=utf-8",
    );
  };

  const resetEvidence = useCallback(() => {
    ledgerAbortRef.current?.abort();
    ledgerAbortRef.current = null;
    metricsAbortRef.current?.abort();
    metricsAbortRef.current = null;
    setLedgerStatus(null);
    setLedgerEvents([]);
    setLedgerError(null);
    setLedgerLoading(false);
    setMetricsText("");
    setMetricsError(null);
    setMetricsLoading(false);
  }, []);
  useEffect(
    () => () => {
      ledgerAbortRef.current?.abort();
      ledgerAbortRef.current = null;
      metricsAbortRef.current?.abort();
      metricsAbortRef.current = null;
    },
    [],
  );

  return {
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
    resetEvidence,
  };
}
