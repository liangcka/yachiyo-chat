import { useCallback, useEffect, useEffectEvent, useState } from "react";
import type { SessionService } from "./app-services";

export type AuthenticationState = "checking" | "authenticated" | "unauthenticated";

export interface AuthenticationOptions {
  session: SessionService;
  isOnline: boolean;
  /** 会话确认有效后、进入已认证态之前加载依赖登录的设置；须自行吞掉错误。 */
  loadAuthenticatedState: () => Promise<void>;
  onCheckFailed: () => void;
}

export interface Authentication {
  state: AuthenticationState;
  /** 访问码错误时抛出，由门禁界面展示。 */
  authenticate(accessCode: string): Promise<void>;
  signOut(): Promise<void>;
  /** 服务端判定会话过期时退回门禁，不触发网络请求。 */
  expire(): void;
}

/**
 * 访问门禁状态机：离线启动直接放行以保证本地历史可读，
 * 每次恢复在线都会重新校验会话。
 */
export function useAuthentication({
  session,
  isOnline,
  loadAuthenticatedState,
  onCheckFailed,
}: AuthenticationOptions): Authentication {
  const [state, setState] = useState<AuthenticationState>(() =>
    navigator.onLine ? "checking" : "authenticated",
  );
  const loadAfterCheck = useEffectEvent(loadAuthenticatedState);
  const reportCheckFailure = useEffectEvent(onCheckFailed);

  useEffect(() => {
    if (!isOnline) {
      const timeout = setTimeout(() => {
        setState((current) => (current === "checking" ? "authenticated" : current));
      }, 0);
      return () => clearTimeout(timeout);
    }
    const abortController = new AbortController();
    let cancelled = false;
    void session
      .check(abortController.signal)
      .then(async (authenticated) => {
        if (authenticated) await loadAfterCheck();
        if (!cancelled) setState(authenticated ? "authenticated" : "unauthenticated");
      })
      .catch(() => {
        if (cancelled) return;
        setState("unauthenticated");
        reportCheckFailure();
      });
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [isOnline, session]);

  const authenticate = useCallback(async (accessCode: string) => {
    await session.authenticate(accessCode);
    await loadAuthenticatedState();
    setState("authenticated");
  }, [loadAuthenticatedState, session]);

  const signOut = useCallback(async () => {
    await session.signOut();
    setState("unauthenticated");
  }, [session]);

  const expire = useCallback(() => setState("unauthenticated"), []);

  return { state, authenticate, signOut, expire };
}
