import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "../features/shell/AppShell";
import { TournamentProvider } from "../features/tournament/TournamentProvider";

export const Route = createFileRoute("/")({
  component: TournamentRoute,
});

function TournamentRoute() {
  return (
    <TournamentProvider>
      <AppShell />
    </TournamentProvider>
  );
}
