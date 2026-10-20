import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hubApi } from "../api/client";
import {
  appendHexChecksum,
  checksumLabel,
  type HexChecksum,
} from "../checksumUtils";
import {
  appendLineEnding,
  type CommandMode,
  type LineEnding,
} from "../commandUtils";
import { t, translate } from "../i18n/index.ts";
import { useLocale } from "../i18n/useLocale";
import {
  abortableDelay,
  commandBytes,
  fullHex,
  type RunSerialJob,
  type TextEncoding,
} from "../serialTools";
import type { PushLog } from "./consoleLogStore.ts";
import type { HubConnection, TrafficRef } from "./types.ts";

import {
  SerialOperationGate,
  type SerialOperation,
} from "./serialOperationGate.ts";
const CLIENT_NAME = "web-ui";

/** The only owner of TX admission, jobs, leases and send drafts. */
export function useSerialTransmission(
  hub: HubConnection,
  pushLog: PushLog,
  trafficRef: TrafficRef,
) {
  const { activeSession, isCurrent, refreshMeta, status, online, phase } = hub;
  const canWrite =
    online && phase === "connected" && status?.port.connected === true;
  const locale = useLocale();
  const jobRef = useRef<AbortController | null>(null);
  const [jobLabel, setJobLabel] = useState("");
  const [textEncoding, setTextEncoding] = useState<TextEncoding>("utf-8");
  const [sendText, setSendText] = useState("");
  const [sendHistory, setSendHistory] = useState<
    {
      mode: CommandMode;
      payload: string;
      ending: LineEnding;
      checksum: HexChecksum;
      encoding: TextEncoding;
      start: number;
      end: number;
    }[]
  >([]);
  const [sendMode, setSendMode] = useState<CommandMode>("text");
  const [sendHex, setSendHex] = useState("");
  const [hexChecksum, setHexChecksum] = useState<HexChecksum>("none");
  const [checksumStart, setChecksumStart] = useState(1);
  const [checksumEnd, setChecksumEnd] = useState(0);
  const [lineEnding, setLineEnding] = useState<LineEnding>("lf");
  const [autoSend, setAutoSend] = useState(false);
  const [autoIntervalMs, setAutoIntervalMs] = useState(1000);
  const [autoMode, setAutoMode] = useState<CommandMode>("text");
  const [breakDurationMs, setBreakDurationMs] = useState(100);
  const [busy, setBusy] = useState(false);
  const [leaseToken, setLeaseToken] = useState<string | null>(null);
  const [leaseExpiresAt, setLeaseExpiresAt] = useState(0);
  const [leaseRemaining, setLeaseRemaining] = useState(0);

  const [gate] = useState(() => new SerialOperationGate(isCurrent));
  const invalidateOperations = useCallback(
    (reason: string) => {
      const uncertain = gate.invalidate(new Error(reason));
      jobRef.current?.abort(new Error(reason));
      jobRef.current = null;
      setJobLabel("");
      setBusy(false);
      setAutoSend(false);
      setLeaseToken(null);
      setLeaseExpiresAt(0);
      if (uncertain)
        pushLog({
          kind: "err",
          text: `${reason} · ${t(
            "Session ended. An in-flight operation may have reached the device. Check events before retrying.",
          )}`,
        });
    },
    [gate, pushLog],
  );
  useEffect(() => {
    if (!canWrite) invalidateOperations(t("Device or live stream offline"));
  }, [canWrite, invalidateOperations]);
  useEffect(() => {
    invalidateOperations(t("Device connection epoch changed"));
  }, [status?.port.epoch, invalidateOperations]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (jobRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => {
      window.removeEventListener("beforeunload", guard);
      jobRef.current?.abort(new Error(t("Page closed")));
      jobRef.current = null;
      gate.invalidate(new Error(t("Page closed")));
    };
  }, [gate]);
  const beginOperation = useCallback(() => {
    const session = activeSession();
    const operation = gate.begin(
      session,
      canWrite && session?.deviceEpoch === status?.port.epoch,
    );
    if (operation) setBusy(true);
    return operation;
  }, [activeSession, canWrite, gate, status?.port.epoch]);
  const isCurrentOperation = useCallback(
    (operation: SerialOperation) => gate.isCurrent(operation),
    [gate],
  );
  const endOperation = useCallback(
    (operation: SerialOperation) => {
      if (gate.finish(operation)) setBusy(false);
    },
    [gate],
  );
  useEffect(() => {
    if (!leaseToken) {
      setLeaseRemaining(0);
      return;
    }
    const update = () => {
      const remaining = Math.max(0, leaseExpiresAt - Date.now());
      setLeaseRemaining(remaining);
      if (!remaining) setLeaseToken(null);
    };
    update();
    const timer = setInterval(update, 200);
    return () => clearInterval(timer);
  }, [leaseToken, leaseExpiresAt]);
  const transmit = useCallback(
    async (
      mode: CommandMode,
      payload: string,
      ending: LineEnding,
      checksum: HexChecksum = "none",
    ): Promise<boolean> => {
      if (!payload.length || (mode === "hex" && !payload.trim())) return false;
      const operation = beginOperation();
      if (!operation) return false;
      const session = operation.session;
      try {
        const bytes = commandBytes(
          {
            id: "current",
            name: t("Current command"),
            mode,
            payload,
            lineEnding: ending,
          },
          textEncoding,
          checksum,
          { start: checksumStart - 1, end: checksumEnd || undefined },
        );
        if (bytes.length > 65536)
          throw new Error(
            t("Commands are limited to 65,536 bytes; use file transfer"),
          );
        const wire = fullHex(bytes);
        const response = await hubApi.writeHex(session.cfg, wire, {
          as_client: CLIENT_NAME,
          lease_token: leaseToken ?? undefined,
          bearer_token: session.bearerToken,
          signal: operation.signal,
        });
        if (!isCurrentOperation(operation)) return false;
        if (!response.ok || response.bytes !== bytes.length)
          throw new Error(
            response.error ||
              t("Write length not fully acknowledged; sending stopped"),
          );
        trafficRef.current.tx += response.bytes;
        setSendHistory((previous) =>
          [
            {
              mode,
              payload,
              ending,
              checksum,
              encoding: textEncoding,
              start: checksumStart,
              end: checksumEnd,
            },
            ...previous.filter(
              (item) =>
                item.mode !== mode ||
                item.payload !== payload ||
                item.ending !== ending ||
                item.checksum !== checksum ||
                item.encoding !== textEncoding,
            ),
          ].slice(0, 20),
        );
        const display =
          mode === "text" ? appendLineEnding(payload, ending) : wire;
        pushLog({
          kind: "tx",
          text: t("Host acknowledged {p0} bytes · {p1}{p2}", {
            p0: String(response.bytes),
            p1: String(display.replace(/\r/g, "\\r").replace(/\n/g, "\\n")),
            p2: String(
              checksum !== "none" ? ` · ${checksumLabel(checksum)}` : "",
            ),
          }),
        });
        return true;
      } catch (failure) {
        if (isCurrentOperation(operation)) {
          setAutoSend(false);
          pushLog({
            kind: "err",
            text: t("Write not acknowledged: {p0}", {
              p0: String(
                failure instanceof Error ? failure.message : String(failure),
              ),
            }),
          });
        }
        return false;
      } finally {
        endOperation(operation);
      }
    },
    [
      beginOperation,
      endOperation,
      isCurrentOperation,
      leaseToken,
      pushLog,
      textEncoding,
      checksumStart,
      checksumEnd,
      trafficRef,
    ],
  );
  const runJob: RunSerialJob = async (name, task) => {
    const operation = beginOperation();
    if (!operation) return;
    const session = operation.session;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, operation.signal]);
    jobRef.current = controller;
    setAutoSend(false);
    setJobLabel(name);
    // Freeze the lease and connection for the entire job. Never retry a chunk.
    const lease = leaseToken ?? undefined;
    let renewAt = 0;
    const maintainLease = async () => {
      signal.throwIfAborted();
      if (!lease || Date.now() < renewAt) return;
      const response = await hubApi.lock(
        session.cfg,
        CLIENT_NAME,
        lease,
        session.bearerToken,
        operation.signal,
      );
      signal.throwIfAborted();
      if (
        !isCurrentOperation(operation) ||
        !response.ok ||
        !response.lock ||
        response.lock.lease_token !== lease
      ) {
        throw new Error(
          response.error || t("Existing write lease renewal failed"),
        );
      }
      renewAt = Date.now() + Math.max(1, response.lock.expires_ms / 2);
      setLeaseToken(lease);
      setLeaseExpiresAt(Date.now() + response.lock.expires_ms);
    };
    try {
      await task({
        signal,
        pause: async (ms) => {
          const until = performance.now() + ms;
          do {
            await maintainLease();
            const remaining = Math.max(0, until - performance.now());
            await abortableDelay(
              Math.min(
                remaining,
                lease ? Math.max(1, renewAt - Date.now()) : remaining,
              ),
              signal,
            );
          } while (performance.now() < until);
        },
        write: async (bytes) => {
          await maintainLease();
          signal.throwIfAborted();
          if (
            !isCurrentOperation(operation) ||
            !session.streamOpen ||
            !session.deviceConnected
          )
            throw new Error(t("Device or live stream offline"));
          if (!bytes.length || bytes.length > 65536)
            throw new Error(t("Send blocks must contain 1–65,536 bytes"));
          // A user stop waits for this ACK: aborting HTTP does not undo serial TX.
          const response = await hubApi.writeHex(session.cfg, fullHex(bytes), {
            as_client: CLIENT_NAME,
            lease_token: lease,
            bearer_token: session.bearerToken,
            signal: operation.signal,
          });
          if (!response.ok || response.bytes !== bytes.length)
            throw new Error(
              response.error || t("Write length not fully acknowledged"),
            );
          if (isCurrentOperation(operation))
            trafficRef.current.tx += response.bytes;
        },
      });
      if (isCurrentOperation(operation))
        pushLog({
          kind: "sys",
          text: t("{p0} · completed", { p0: String(name) }),
        });
    } catch (failure) {
      if (isCurrentOperation(operation))
        pushLog({
          kind: "err",
          text: t(
            "{p0} · stopped: {p1}. Confirmed bytes cannot be undone; check the ledger for unconfirmed writes.",
            {
              p0: String(name),
              p1: String(
                failure instanceof Error ? failure.message : String(failure),
              ),
            },
          ),
        });
    } finally {
      if (jobRef.current === controller) {
        jobRef.current = null;
        setJobLabel("");
      }
      endOperation(operation);
    }
  };
  const applySerial = async (
    settings: import("../api/types").SerialSettings,
  ) => {
    const operation = beginOperation();
    if (!operation) return false;
    const session = operation.session;
    try {
      if (!leaseToken) throw new Error(t("Acquire a write lease first"));
      const response = await hubApi.configureSerial(
        session.cfg,
        settings,
        CLIENT_NAME,
        leaseToken,
        session.bearerToken,
        operation.signal,
      );
      if (!response.ok)
        throw new Error(
          response.error || t("Serial settings not acknowledged"),
        );
      if (!isCurrentOperation(operation)) return false;
      pushLog({
        kind: "sys",
        text: t(
          "Serial settings acknowledged: {p0} / {p1} / {p2} / {p3} / {p4}",
          {
            p0: String(settings.baud),
            p1: String(settings.databits),
            p2: String(settings.parity),
            p3: String(settings.stopbits),
            p4: String(settings.flow),
          },
        ),
      });
      await refreshMeta();
      return true;
    } catch (failure) {
      if (isCurrentOperation(operation))
        pushLog({
          kind: "err",
          text: t("Settings update failed: {p0}", {
            p0: String(
              failure instanceof Error ? failure.message : String(failure),
            ),
          }),
        });
      return false;
    } finally {
      endOperation(operation);
    }
  };
  const onLock = async () => {
    const operation = beginOperation();
    if (!operation) return;
    const session = operation.session;
    try {
      const response = await hubApi.lock(
        session.cfg,
        CLIENT_NAME,
        leaseToken ?? undefined,
        session.bearerToken,
        operation.signal,
      );
      if (!isCurrentOperation(operation)) return;
      if (!response.ok || !response.lock)
        throw new Error(
          response.error || t("Server did not return a write lease"),
        );
      setLeaseToken(response.lock.lease_token);
      setLeaseExpiresAt(Date.now() + response.lock.expires_ms);
      pushLog({
        kind: "sys",
        text: t("Write lease acquired · {p0} ms", {
          p0: String(response.lock.expires_ms),
        }),
      });
      await refreshMeta();
    } catch (failure) {
      if (isCurrentOperation(operation)) {
        setLeaseToken(null);
        pushLog({
          kind: "err",
          text: t("Cannot acquire lease: {p0}", {
            p0: String(
              failure instanceof Error ? failure.message : String(failure),
            ),
          }),
        });
      }
    } finally {
      endOperation(operation);
    }
  };
  const onUnlock = async () => {
    if (!leaseToken) return;
    const operation = beginOperation();
    if (!operation) return;
    const session = operation.session;
    try {
      const response = await hubApi.unlock(
        session.cfg,
        leaseToken,
        session.bearerToken,
        operation.signal,
      );
      if (!isCurrentOperation(operation)) return;
      if (!response.ok)
        throw new Error(response.error || t("Lease release failed"));
      setLeaseToken(null);
      pushLog({ kind: "sys", text: t("Write lease released") });
      await refreshMeta();
    } catch (failure) {
      if (isCurrentOperation(operation))
        pushLog({
          kind: "err",
          text: t("Release failed: {p0}", {
            p0: String(
              failure instanceof Error ? failure.message : String(failure),
            ),
          }),
        });
    } finally {
      endOperation(operation);
    }
  };
  const onControl = async (
    body:
      | { op: "dtr" | "rts"; level: boolean }
      | { op: "break"; duration_ms: number },
  ) => {
    if (!leaseToken || status?.port.path.startsWith("mock:")) return;
    const operation = beginOperation();
    if (!operation) return;
    const session = operation.session;
    try {
      const response = await hubApi.control(
        session.cfg,
        { ...body, as_client: CLIENT_NAME, lease_token: leaseToken },
        session.bearerToken,
        operation.signal,
      );
      if (!isCurrentOperation(operation)) return;
      if (!response.ok)
        throw new Error(response.error || t("Control operation failed"));
      pushLog({
        kind: "sys",
        text:
          body.op === "break"
            ? t("BREAK {p0} ms acknowledged", { p0: String(body.duration_ms) })
            : t("{p0} {p1} acknowledged", {
                p0: String(body.op.toUpperCase()),
                p1: String(body.level ? "ON" : "OFF"),
              }),
      });
    } catch (failure) {
      if (isCurrentOperation(operation))
        pushLog({
          kind: "err",
          text: t("Control failed: {p0}", {
            p0: String(
              failure instanceof Error ? failure.message : String(failure),
            ),
          }),
        });
    } finally {
      endOperation(operation);
    }
  };
  const inspectSerial = async () => {
    const session = activeSession();
    if (!session) return null;
    const epoch = session.deviceEpoch;
    const [settings, ports] = await Promise.all([
      hubApi.serialSettings(session.cfg, session.bearerToken, session.signal),
      hubApi.serialPorts(session.cfg, session.bearerToken, session.signal),
    ]);
    return isCurrent(session) && session.deviceEpoch === epoch
      ? { settings: settings.settings, ports: ports.ports }
      : null;
  };
  const onSendText = () => void transmit("text", sendText, lineEnding);
  const onSendHex = () => void transmit("hex", sendHex, "none", hexChecksum);
  const hexPreview = useMemo(() => {
    if (!sendHex.trim()) return { text: "", invalid: false };
    try {
      return {
        text: appendHexChecksum(sendHex, hexChecksum, {
          start: checksumStart - 1,
          end: checksumEnd || undefined,
        }),
        invalid: false,
      };
    } catch (e) {
      return {
        text: translate(locale, "Error: {p0}", {
          p0: e instanceof Error ? e.message : String(e),
        }),
        invalid: true,
      };
    }
  }, [hexChecksum, sendHex, checksumStart, checksumEnd, locale]);
  useEffect(() => {
    if (
      !autoSend ||
      !canWrite ||
      autoIntervalMs < 50 ||
      !Number.isFinite(autoIntervalMs)
    )
      return;
    const timer = window.setInterval(() => {
      if (busy) return;
      const payload = autoMode === "text" ? sendText : sendHex;
      void transmit(
        autoMode,
        payload,
        autoMode === "text" ? lineEnding : "none",
        autoMode === "hex" ? hexChecksum : "none",
      );
    }, autoIntervalMs);
    return () => window.clearInterval(timer);
  }, [
    autoIntervalMs,
    autoMode,
    autoSend,
    busy,
    hexChecksum,
    lineEnding,
    canWrite,
    sendHex,
    sendText,
    transmit,
  ]);

  const stopJob = () => jobRef.current?.abort(new Error(t("Stopped by user")));
  return {
    stopJob,
    canWrite,
    busy,
    jobLabel,
    leaseToken,
    leaseRemaining,
    textEncoding,
    setTextEncoding,
    sendText,
    setSendText,
    sendHistory,
    sendMode,
    setSendMode,
    sendHex,
    setSendHex,
    hexChecksum,
    setHexChecksum,
    checksumStart,
    setChecksumStart,
    checksumEnd,
    setChecksumEnd,
    lineEnding,
    setLineEnding,
    autoSend,
    setAutoSend,
    autoIntervalMs,
    setAutoIntervalMs,
    autoMode,
    setAutoMode,
    breakDurationMs,
    setBreakDurationMs,
    transmit,
    runJob,
    inspectSerial,
    applySerial,
    onSendText,
    onSendHex,
    hexPreview,
    onLock,
    onUnlock,
    onControl,
    invalidateOperations,
  };
}
