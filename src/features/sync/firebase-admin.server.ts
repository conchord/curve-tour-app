import { applicationDefault, cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";

const DATABASE_URL = "https://curve-tour-app-default-rtdb.europe-west1.firebasedatabase.app";

function parseServiceAccount(): Parameters<typeof cert>[0] | undefined {
  const value = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Parameters<typeof cert>[0];
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
}

function getFirebaseAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const serviceAccount = parseServiceAccount();
  return initializeApp({
    credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
    databaseURL: DATABASE_URL,
  });
}

export async function writeTournamentToFirebase(tournamentId: string, payload: unknown): Promise<void> {
  await getDatabase(getFirebaseAdminApp()).ref(`tournaments/${tournamentId}`).set(payload);
}
