import type { StreamHandlers } from "../api/wsStream.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionConfig } from "../api/types";
import { wsUrl } from "../api/types";
import { bytesToHex, bytesToText } from "../api/wsStream";
import { t } from "../i18n/index.ts";
import {
  parseCobs,
  parseModbusRtu,
  parseNmea0183,
  parseSlip,
  type ProtocolFrame,
  type StreamProtocol,
} from "../protocolUtils";
import { RawCapture } from "../serialTools";
import { SignalStore } from "../signals/store";
import type { PushLog } from "./consoleLogStore.ts";

/** RX decoding, parser remainders, acquisition and stream lifecycle. */
export function useReceiveStream(
  pushLog: PushLog,
  pausedRef: React.RefObject<boolean>,
  canWrite: boolean,
  epoch: number | undefined,
) {
  const [capture] = useState(() => new RawCapture());
  const trafficRef = useRef({ rx: 0, tx: 0 });
  const [receiveEncoding, setReceiveEncoding] = useState("utf-8");
  const receiveEncodingRef = useRef(receiveEncoding);
  receiveEncodingRef.current = receiveEncoding;
  const [streamProtocol, setStreamProtocol] = useState<StreamProtocol>("raw");
  const [signalStore] = useState(() => new SignalStore());
  const [protocolFrames, setProtocolFrames] = useState<ProtocolFrame[]>([]);
  const streamProtocolRef = useRef<StreamProtocol>(streamProtocol);
  const nmeaBufferRef = useRef("");
  const slipBufferRef = useRef<Uint8Array<ArrayBufferLike>>(new Uint8Array());
  const cobsBufferRef = useRef<Uint8Array<ArrayBufferLike>>(new Uint8Array());
  const modbusBufferRef = useRef<Uint8Array<ArrayBufferLike>>(new Uint8Array());
  const resetStreamParsers = useCallback(() => {
    nmeaBufferRef.current = "";
    slipBufferRef.current = new Uint8Array();
    cobsBufferRef.current = new Uint8Array();
    modbusBufferRef.current = new Uint8Array();
  }, []);
  const consumeProtocolBytes = useCallback((data: Uint8Array) => {
    const currentProtocol = streamProtocolRef.current;
    if (currentProtocol === "nmea0183") {
      const incoming = new TextDecoder().decode(data);
      const parsed = parseNmea0183(nmeaBufferRef.current, incoming);
      nmeaBufferRef.current = parsed.remainder;
      if (parsed.frames.length)
        setProtocolFrames((previous) =>
          [...previous, ...parsed.frames].slice(-100),
        );
      return;
    }
    if (currentProtocol === "slip") {
      const parsed = parseSlip(slipBufferRef.current, data);
      slipBufferRef.current = parsed.remainder;
      if (parsed.frames.length)
        setProtocolFrames((previous) =>
          [...previous, ...parsed.frames].slice(-100),
        );
      return;
    }
    if (currentProtocol === "cobs") {
      const parsed = parseCobs(cobsBufferRef.current, data);
      cobsBufferRef.current = parsed.remainder;
      if (parsed.frames.length)
        setProtocolFrames((previous) =>
          [...previous, ...parsed.frames].slice(-100),
        );
      return;
    }
    if (currentProtocol === "modbusrtu") {
      const parsed = parseModbusRtu(modbusBufferRef.current, data);
      modbusBufferRef.current = parsed.remainder;
      if (parsed.frames.length)
        setProtocolFrames((previous) =>
          [...previous, ...parsed.frames].slice(-100),
        );
    }
  }, []);
  useEffect(() => {
    streamProtocolRef.current = streamProtocol;
    signalStore.setProtocol(streamProtocol);
    resetStreamParsers();
    setProtocolFrames([]);
  }, [streamProtocol, resetStreamParsers, signalStore]);

  const prepareStream = useCallback(
    (
      cfg: ConnectionConfig,
    ): Required<
      Pick<StreamHandlers, "onOpen" | "onClose" | "onServerError" | "onBytes">
    > => {
      trafficRef.current = { rx: 0, tx: 0 };
      let decoderEncoding = receiveEncodingRef.current;
      let textDecoder = new TextDecoder(decoderEncoding);
      return {
        onOpen: () => {
          decoderEncoding = receiveEncodingRef.current;
          textDecoder = new TextDecoder(decoderEncoding);
          resetStreamParsers();
          signalStore.open();
          setProtocolFrames([]);
          pushLog({
            kind: "sys",
            text: t("Live stream connected {p0}", { p0: String(wsUrl(cfg)) }),
          });
        },
        onClose: () => {
          capture.stop(t("Stream interrupted; recording stopped"));
          signalStore.close();
          pushLog({
            kind: "err",
            text: t(
              "Stream interrupted; reconnecting. Automatic sending stopped. The first packet may contain history.",
            ),
          });
        },
        onServerError: (message) =>
          pushLog({ kind: "err", text: `Hub：${message}` }),
        onBytes: (data, meta) => {
          trafficRef.current.rx += data.byteLength;
          capture.add(data, meta.isHistoryHint);
          signalStore.feed(data, meta.isHistoryHint);
          if (decoderEncoding !== receiveEncodingRef.current) {
            decoderEncoding = receiveEncodingRef.current;
            textDecoder = new TextDecoder(decoderEncoding);
          }
          if (pausedRef.current) {
            textDecoder = new TextDecoder(receiveEncodingRef.current);
            resetStreamParsers();
            return;
          }
          consumeProtocolBytes(data);
          pushLog({
            kind: "rx",
            text: `${meta.isHistoryHint ? `${t("[may contain history]")} ` : ""}${bytesToText(data, textDecoder).replace(/\n/g, "\\n")}`,
            hex: bytesToHex(data),
          });
        },
      };
    },
    [
      pushLog,
      capture,
      signalStore,
      pausedRef,
      resetStreamParsers,
      consumeProtocolBytes,
    ],
  );

  const stopReceiving = useCallback(
    (reason: string) => {
      capture.stop(reason);
      signalStore.close(reason);
    },
    [capture, signalStore],
  );
  useEffect(() => {
    if (!canWrite)
      capture.stop(t("Device or stream offline; recording stopped"));
  }, [canWrite, capture]);
  useEffect(() => {
    capture.stop(t("Device connection changed; recording stopped"));
    if (signalStore.getSnapshot().source === "live")
      signalStore.clear(t("Device connection changed"));
  }, [epoch, capture, signalStore]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (capture.active) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => {
      window.removeEventListener("beforeunload", guard);
      capture.stop(t("Page closed"));
      signalStore.dispose();
    };
  }, [capture, signalStore]);

  const clearProtocolFrames = useCallback(() => setProtocolFrames([]), []);
  return {
    capture,
    trafficRef,
    receiveEncoding,
    setReceiveEncoding,
    streamProtocol,
    setStreamProtocol,
    signalStore,
    protocolFrames,
    clearProtocolFrames,
    prepareStream,
    stopReceiving,
  };
}
