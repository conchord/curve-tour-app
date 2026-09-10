import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";
import {
  ACCESS_TOKEN_KEY,
  NET_VERSION,
  PID_STORAGE_KEY,
  SESSION_MAX_AGE_SECONDS,
  USERNAME_STORAGE_KEY,
  canAdminTour,
  extractAccountRoles,
  getAnonymousAuthSnapshot,
  getUserIdFromPayload,
  getUsernameFromPayload,
  type AccountRoleID,
  type AuthRolePayload,
  type AuthSnapshot,
} from "./auth.shared";
import { postJSON } from "../../lib/api";
import { readCookieValue } from "../../lib/cookies";

type AuthStatus = "checking" | "anonymous" | "submitting" | "authenticated";

type LoginResponse = AuthRolePayload & {
  accessToken?: string;
  ticket?: string;
  username: string;
};

type LoginTokenResponse = AuthRolePayload & {
  accessToken?: string;
  ticket?: string;
  username?: string;
};

type AuthState = {
  error: string | null;
  roles: AccountRoleID[];
  status: AuthStatus;
  userId: string;
  username: string;
};

type AuthContextValue = AuthState & {
  canAdmin: boolean;
  clearError(): void;
  login(email: string, password: string): Promise<boolean>;
  logout(): void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function cookieValue(name: string): string | undefined {
  return isBrowser() ? readCookieValue(document.cookie, name) : undefined;
}

function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  if (!isBrowser()) return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secure}`;
}

function removeCookie(name: string): void {
  if (!isBrowser()) return;
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
}

function saveAccessToken(token: string): void {
  writeCookie(ACCESS_TOKEN_KEY, token, SESSION_MAX_AGE_SECONDS);
  window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

function clearAccessToken(): void {
  if (!isBrowser()) return;
  removeCookie(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
}

function getAccessToken(): string | undefined {
  if (!isBrowser()) return undefined;
  return cookieValue(ACCESS_TOKEN_KEY) || window.localStorage.getItem(ACCESS_TOKEN_KEY) || undefined;
}

function saveUsername(username: string): void {
  const normalized = username.trim();
  if (!normalized) return;
  writeCookie(USERNAME_STORAGE_KEY, normalized, SESSION_MAX_AGE_SECONDS);
  window.localStorage.setItem(USERNAME_STORAGE_KEY, normalized);
}

function clearUsername(): void {
  if (!isBrowser()) return;
  removeCookie(USERNAME_STORAGE_KEY);
  window.localStorage.removeItem(USERNAME_STORAGE_KEY);
}

function getCachedUsername(): string {
  return isBrowser() ? window.localStorage.getItem(USERNAME_STORAGE_KEY) || "" : "";
}

function getPID(): string {
  if (!isBrowser()) return "";
  const existing = window.localStorage.getItem(PID_STORAGE_KEY);
  if (existing) {
    writeCookie(PID_STORAGE_KEY, existing, SESSION_MAX_AGE_SECONDS);
    return existing;
  }
  const pid = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(PID_STORAGE_KEY, pid);
  writeCookie(PID_STORAGE_KEY, pid, SESSION_MAX_AGE_SECONDS);
  return pid;
}

function deviceData(): string {
  if (!isBrowser()) return "";
  return JSON.stringify({
    language: window.navigator.language,
    platform: window.navigator.platform,
    userAgent: window.navigator.userAgent,
  });
}

async function requestLogin(email: string, password: string): Promise<LoginResponse> {
  const pid = getPID();
  return postJSON<LoginResponse>(
    "/auth/login",
    { email, password, version: NET_VERSION, deviceID: pid, deviceData: deviceData(), pid },
    { hostname: isBrowser() ? window.location.hostname : undefined },
  );
}

async function requestTokenLogin(token: string): Promise<LoginTokenResponse> {
  const pid = getPID();
  return postJSON<LoginTokenResponse>(
    "/auth/logintoken",
    { token, version: NET_VERSION, deviceID: pid, deviceData: deviceData(), pid },
    { hostname: isBrowser() ? window.location.hostname : undefined },
  );
}

function stateFromSnapshot(snapshot: AuthSnapshot): AuthState {
  return { ...snapshot, error: null };
}

function anonymousState(error: string | null = null): AuthState {
  return { ...getAnonymousAuthSnapshot(), error };
}

export function AuthProvider({
  children,
  initialAuth = getAnonymousAuthSnapshot(),
}: PropsWithChildren<{ initialAuth?: AuthSnapshot }>) {
  const [state, setState] = useState<AuthState>(() => stateFromSnapshot(initialAuth));

  useEffect(() => {
    if (!isBrowser()) return;
    if (initialAuth.status === "authenticated" && canAdminTour(initialAuth.roles)) {
      saveUsername(initialAuth.username);
      return;
    }

    let cancelled = false;
    async function restoreSession() {
      const token = getAccessToken();
      const fallbackUsername = getCachedUsername();
      if (!token) {
        if (!cancelled) setState(anonymousState());
        return;
      }
      if (!cancelled) {
        setState({ error: null, roles: [], status: "checking", userId: fallbackUsername, username: fallbackUsername });
      }
      try {
        const response = await requestTokenLogin(token);
        const roles = extractAccountRoles(response);
        if (!canAdminTour(roles)) throw new Error("Your CFP account does not have Tour Hub admin access.");
        const username = getUsernameFromPayload(response.username, fallbackUsername);
        const nextToken = response.accessToken?.trim() || token;
        saveAccessToken(nextToken);
        saveUsername(username);
        if (!cancelled) {
          setState({
            error: null,
            roles,
            status: "authenticated",
            userId: getUserIdFromPayload(response, username),
            username,
          });
        }
      } catch {
        clearAccessToken();
        clearUsername();
        if (!cancelled) setState(anonymousState());
      }
    }
    void restoreSession();
    return () => { cancelled = true; };
  }, [initialAuth]);

  async function login(email: string, password: string): Promise<boolean> {
    setState((current) => ({ ...current, error: null, status: "submitting" }));
    try {
      const response = await requestLogin(email, password);
      const roles = extractAccountRoles(response);
      if (!canAdminTour(roles)) throw new Error("Your CFP account does not have Tour Hub admin access.");
      const token = response.accessToken?.trim();
      if (!token) throw new Error("CFP did not return a login token.");
      const username = getUsernameFromPayload(response.username);
      saveAccessToken(token);
      saveUsername(username);
      setState({
        error: null,
        roles,
        status: "authenticated",
        userId: getUserIdFromPayload(response, username),
        username,
      });
      return true;
    } catch (error) {
      clearAccessToken();
      clearUsername();
      setState(anonymousState(error instanceof Error ? error.message : "Unable to sign in."));
      return false;
    }
  }

  function logout(): void {
    clearAccessToken();
    clearUsername();
    setState(anonymousState());
  }

  function clearError(): void {
    setState((current) => ({ ...current, error: null }));
  }

  return (
    <AuthContext.Provider
      value={{
        ...state,
        canAdmin: state.status === "authenticated" && canAdminTour(state.roles),
        clearError,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
