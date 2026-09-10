export function sanitizeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]/gu, "-").replace(/\s+/gu, " ").trim() || "Unnamed Tournament";
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadJson(filename: string, value: unknown): void {
  downloadBlob(filename, new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
}
