import type { ConnectionConfig } from "./api/types";

export type DeviceSession = {
  id: string;
  name: string;
  path: string;
  baud: number;
  connected: boolean;
  detail: string;
  clients: number;
  rx_bytes: number;
  tx_bytes: number;
};

export function desktopConnection(id: string): ConnectionConfig {
  return {
    host: location.hostname,
    port: Number(location.port) || (location.protocol === "https:" ? 443 : 80),
    protocol: location.protocol === "https:" ? "https" : "http",
    basePath: `/sessions/${id}`,
  };
}
