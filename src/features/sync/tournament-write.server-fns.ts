import { createServerFn } from "@tanstack/react-start";
import { requireTourAdminPermission } from "../auth/server/tour-permissions.server";
import { writeTournamentToFirebase } from "./firebase-admin.server";

export type TournamentWriteInput = {
  payload: unknown;
  tournamentId: string;
};

function validateWriteInput(input: TournamentWriteInput): TournamentWriteInput {
  if (!input || typeof input !== "object") throw new Error("Invalid tournament update.");
  const tournamentId = typeof input.tournamentId === "string" ? input.tournamentId.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(tournamentId)) throw new Error("Invalid tournament ID.");
  if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) {
    throw new Error("Invalid tournament data.");
  }
  const payload = { ...(input.payload as Record<string, unknown>) };
  delete payload.adminProof;
  return { tournamentId, payload };
}

export const writeTournament = createServerFn({ method: "POST" })
  .inputValidator(validateWriteInput)
  .handler(async ({ data }): Promise<void> => {
    await requireTourAdminPermission();
    await writeTournamentToFirebase(data.tournamentId, data.payload);
  });
