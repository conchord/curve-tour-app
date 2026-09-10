import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getDatabase, onValue, ref, type Database } from "firebase/database";
import type { SyncTransport } from "./live-sync";
import { writeTournament } from "./tournament-write.server-fns";

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAzbwk2ZJj2jmtKRFjzDJyPk4ePmF3Q04M",
  authDomain: "curve-tour-app.firebaseapp.com",
  databaseURL:
    "https://curve-tour-app-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "curve-tour-app",
  storageBucket: "curve-tour-app.firebasestorage.app",
  messagingSenderId: "840551568118",
  appId: "1:840551568118:web:40e3c22de01e2587e8d2d7",
} as const;

let database: Database | null | undefined;

function firebaseApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
}

export function getFirebaseDatabase(): Database | null {
  if (database !== undefined) return database;
  try {
    database = getDatabase(firebaseApp());
  } catch (error) {
    console.warn("Live sync unavailable — Firebase failed to initialize", error);
    database = null;
  }
  return database;
}

export function getFirebaseSyncTransport(): SyncTransport | null {
  const db = getFirebaseDatabase();
  if (!db) return null;
  return {
    write: async (tournamentId, payload) => {
      await writeTournament({ data: { tournamentId, payload } });
    },
    subscribe(tournamentId, onPayload, onError) {
      return onValue(ref(db, `tournaments/${tournamentId}`), (snapshot) => onPayload(snapshot.val()), onError);
    },
  };
}
