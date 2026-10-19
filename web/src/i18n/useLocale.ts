import { useSyncExternalStore } from "react";
import { getLocale, subscribeLocale } from "./index";
export function useLocale() { return useSyncExternalStore(subscribeLocale, getLocale, getLocale); }
