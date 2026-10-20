import type { RefObject } from "react";
import type { useHubConnection } from "../useHubConnection.ts";
export type HubConnection = ReturnType<typeof useHubConnection>;
export type TrafficRef = RefObject<{ rx: number; tx: number }>;
export type WorkspaceTab =
  | "monitor"
  | "signals"
  | "events"
  | "endpoints"
  | "protocol";
