function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function isTestHost(hostname: string): boolean {
  return hostname === "test.curvefever.pro" || hostname.endsWith("-test.curvefever.pro");
}

function buildEndpointURL(endpoint: string): string {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) return endpoint;
  if (endpoint.includes("localhost") || endpoint.includes("127.0.0.1")) return `http://${endpoint}`;
  return `https://${endpoint}`;
}

export function getApiBaseURL(hostname?: string): string {
  const configuredEndpoint = import.meta.env.VITE_API_ENDPOINT?.trim();
  if (configuredEndpoint) return buildEndpointURL(configuredEndpoint);
  if (hostname && isLocalHost(hostname)) return "http://localhost:8000";
  if (hostname && isTestHost(hostname)) return "https://api-test.curvefever.pro";
  return "https://api.curvefever.pro";
}

export async function postJSON<TResponse>(
  path: string,
  payload: object,
  options?: { hostname?: string },
): Promise<TResponse> {
  const response = await fetch(`${getApiBaseURL(options?.hostname)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const responseBody = (await response.json().catch(() => null)) as {
    data?: { message?: string };
    message?: string;
  } | null;
  if (!response.ok) {
    throw new Error(responseBody?.data?.message || responseBody?.message || "Unable to complete the request.");
  }
  return responseBody as TResponse;
}
