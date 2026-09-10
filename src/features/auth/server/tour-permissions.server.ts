import { getRequest } from "@tanstack/react-start/server";
import { ACCESS_TOKEN_KEY, PID_STORAGE_KEY, canAdminTour, type AuthSnapshot } from "../auth.shared";
import { readCookieValue } from "../../../lib/cookies";
import { getCachedAuthSnapshot } from "./auth-session-cache.server";

export async function requireTourAdminPermission(): Promise<AuthSnapshot> {
  const request = getRequest();
  const cookies = request.headers.get("cookie") || undefined;
  const token = readCookieValue(cookies, ACCESS_TOKEN_KEY);
  if (!token) throw new Error("You must sign in with CFP to manage a tournament.");
  const snapshot = await getCachedAuthSnapshot({
    hostname: new URL(request.url).hostname,
    pid: readCookieValue(cookies, PID_STORAGE_KEY) || "",
    request,
    token,
  });
  if (!canAdminTour(snapshot.roles)) {
    throw new Error("Your CFP account does not have Tour Hub admin access.");
  }
  return snapshot;
}
