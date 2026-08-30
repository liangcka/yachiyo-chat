import { RelaySession } from "./relay-session";

export interface Env {
  RELAY_SESSION: DurableObjectNamespace<RelaySession>;
}

export { RelaySession };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Identify device / user session:
    // If device header is present on websocket, use that ID.
    // Otherwise use default desktop session or subdomain.
    const deviceId = request.headers.get("x-device-id") || "default-device";

    const id = env.RELAY_SESSION.idFromName(deviceId);
    const stub = env.RELAY_SESSION.get(id);

    return stub.fetch(request);
  },
};
