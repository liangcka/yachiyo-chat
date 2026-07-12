type Setter = (value: boolean) => void;

export function useRegisterSW() {
  return {
    needRefresh: [false, (() => undefined) as Setter] as const,
    offlineReady: [false, (() => undefined) as Setter] as const,
    updateServiceWorker: async () => undefined,
  };
}
