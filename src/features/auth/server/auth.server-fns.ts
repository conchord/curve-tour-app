import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import {
  ACCESS_TOKEN_KEY,
  PID_STORAGE_KEY,
  USERNAME_STORAGE_KEY,
  canAdminTour,
  getAnonymousAuthSnapshot,
  type AuthSnapshot,
} from "../auth.shared";
import { readCookieValue } from "../../../lib/cookies";
import { getCachedAuthSnapshot } from "./auth-session-cache.server";

export const getInitialAuth = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuthSnapshot> => {
    const request = getRequest();
    const cookies = request.headers.get("cookie") || undefined;
    const token = readCookieValue(cookies, ACCESS_TOKEN_KEY);
    if (!token) return getAnonymousAuthSnapshot();
    try {
      const snapshot = await getCachedAuthSnapshot({
        fallbackUsername: readCookieValue(cookies, USERNAME_STORAGE_KEY),
        hostname: new URL(request.url).hostname,
        pid: readCookieValue(cookies, PID_STORAGE_KEY) || "",
        request,
        token,
      });
      return canAdminTour(snapshot.roles) ? snapshot : getAnonymousAuthSnapshot();
    } catch {
      return getAnonymousAuthSnapshot();
    }
  },
);
