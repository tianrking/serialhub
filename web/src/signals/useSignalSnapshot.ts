import { useSyncExternalStore } from "react";
import type { SignalStore } from "./store";
const noopSubscribe = () => () => {};
export function useSignalSnapshot(store: SignalStore, enabled = true) { return useSyncExternalStore(enabled ? store.subscribe : noopSubscribe, store.getSnapshot); }
