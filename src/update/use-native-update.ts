import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { nativeUpdateService, type NativeUpdateSnapshot, type PrepareForNativeReload } from "./github-updates";

export interface NativeUpdateState extends NativeUpdateSnapshot {
  check(): Promise<void>;
  apply(): Promise<void>;
  dismiss(): void;
}

interface NativeUpdateOptions {
  blocked: boolean;
  prepareForReload?: PrepareForNativeReload;
}

export function useNativeUpdate({ blocked, prepareForReload }: NativeUpdateOptions): NativeUpdateState {
  const blockedRef = useRef(blocked);
  const prepareRef = useRef(prepareForReload);
  useLayoutEffect(() => {
    blockedRef.current = blocked;
    prepareRef.current = prepareForReload;
  }, [blocked, prepareForReload]);
  const state = useSyncExternalStore(nativeUpdateService.subscribe, nativeUpdateService.getSnapshot, nativeUpdateService.getSnapshot);
  useEffect(() => { nativeUpdateService.checkOnLaunch(); }, []);
  const apply = useCallback(() => nativeUpdateService.apply(
    () => blockedRef.current,
    async () => { await prepareRef.current?.(); },
  ), []);
  return { ...state, check: nativeUpdateService.check, apply, dismiss: nativeUpdateService.dismiss };
}
