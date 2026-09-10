import {
  NET_VERSION,
  extractAccountRoles,
  getUserIdFromPayload,
  getUsernameFromPayload,
  type AuthRolePayload,
  type AuthSnapshot,
} from "../auth.shared";
import { postJSON } from "../../../lib/api";

const AUTH_SESSION_CACHE_TTL_MS = 60 * 1000;

type AuthTokenResponse = AuthRolePayload & {
  accessToken?: string;
  ticket?: string;
  username?: string;
};

type AuthSessionRequest = {
  fallbackUsername?: string;
  hostname: string;
  pid: string;
  request: Request;
  token: string;
};

type CachedAuthSession = {
  expiresAt: number;
  promise?: Promise<AuthSnapshot>;
  snapshot?: AuthSnapshot;
};

type CacheState = typeof globalThis & {
  __tourAuthSessionCache?: Map<string, CachedAuthSession>;
};

function getCache(): Map<string, CachedAuthSession> {
  const state = globalThis as CacheState;
  state.__tourAuthSessionCache ??= new Map();
  return state.__tourAuthSessionCache;
}

function requestDeviceData(request: Request): string {
  return JSON.stringify({
    language: request.headers.get("accept-language")?.split(",")[0]?.trim() || "",
    platform: request.headers.get("sec-ch-ua-platform")?.replaceAll('"', "") || "",
    userAgent: request.headers.get("user-agent") || "",
  });
}

function cloneSnapshot(snapshot: AuthSnapshot): AuthSnapshot {
  return { ...snapshot, roles: [...snapshot.roles] };
}

async function fetchAuthSnapshot({ fallbackUsername, hostname, pid, request, token }: AuthSessionRequest): Promise<AuthSnapshot> {
  const response = await postJSON<AuthTokenResponse>(
    "/auth/logintoken",
    { token, version: NET_VERSION, deviceID: pid, deviceData: requestDeviceData(request), pid },
    { hostname },
  );
  const username = getUsernameFromPayload(response.username, fallbackUsername);
  return {
    roles: extractAccountRoles(response),
    status: "authenticated",
    userId: getUserIdFromPayload(response, username),
    username,
  };
}

export async function getCachedAuthSnapshot(request: AuthSessionRequest): Promise<AuthSnapshot> {
  const now = Date.now();
  const cache = getCache();
  const cached = cache.get(request.token);
  if (cached && cached.expiresAt > now) {
    if (cached.snapshot) return cloneSnapshot(cached.snapshot);
    if (cached.promise) return cloneSnapshot(await cached.promise);
  } else if (cached) {
    cache.delete(request.token);
  }

  const expiresAt = now + AUTH_SESSION_CACHE_TTL_MS;
  const promise = fetchAuthSnapshot(request);
  cache.set(request.token, { expiresAt, promise });
  try {
    const snapshot = await promise;
    cache.set(request.token, { expiresAt, snapshot: cloneSnapshot(snapshot) });
    return snapshot;
  } catch (error) {
    cache.delete(request.token);
    throw error;
  }
}
