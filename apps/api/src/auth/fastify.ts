import type { Role } from "@kitchen-ops/shared";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";
import { AUTH_BASE_PATH, type Auth } from "./auth";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare module "fastify" {
  interface FastifyContextConfig {
    /** Reachable without signing in. Routes are locked unless they say this. */
    public?: boolean;
    /** Roles allowed on this route. Omitted: any signed-in user. */
    roles?: readonly Role[];
  }
  interface FastifyRequest {
    /** The signed-in user, set by the auth hook on every non-public route. */
    user: CurrentUser | null;
  }
}

/**
 * Mounts Better Auth at /api/auth/* and locks every other route by default:
 * no session → 401; owner without 2FA → 403 two_factor_required; role not allowed → 403.
 * Called on the root instance so the hook covers every route.
 */
export function registerAuth(app: FastifyInstance, auth: Auth) {
  app.decorateRequest("user", null);

  app.addHook("onRequest", async (request, reply) => {
    const { config } = request.routeOptions;
    if (config.public) return;

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!session) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const { id, email, name, role, twoFactorEnabled } = session.user;
    // Spec: 2FA is required for owners. Until it is on, they can only set it up (/api/auth/*).
    if (role === "owner" && !twoFactorEnabled) {
      return reply.code(403).send({ error: "two_factor_required" });
    }
    if (config.roles && !config.roles.includes(role)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    request.user = { id, email, name, role };
  });

  // Official Fastify integration: turn the request into a Fetch Request for Better Auth.
  app.route({
    method: ["GET", "POST"],
    url: `${AUTH_BASE_PATH}/*`,
    config: { public: true },
    async handler(request, reply) {
      const url = new URL(request.url, auth.options.baseURL);
      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers: fromNodeHeaders(request.headers),
          ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        }),
      );
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        // Several cookies arrive as one comma-joined header; send them separately.
        if (key === "set-cookie") return;
        reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header("set-cookie", cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}
