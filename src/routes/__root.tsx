/// <reference types="vite/client" />
import type { ReactNode } from "react";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "../features/auth/AuthProvider";
import { getInitialAuth } from "../features/auth/server/auth.server-fns";
import "@/styles.css";

export const Route = createRootRoute({
  loader: () => getInitialAuth(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Curve Fever Pro Tour Hub" },
      { name: "theme-color", content: "#0D0F14" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootComponent() {
  const initialAuth = Route.useLoaderData();
  return (
    <RootDocument>
      <AuthProvider initialAuth={initialAuth}>
        <Outlet />
      </AuthProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html className="min-h-full bg-background" lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-full bg-background text-foreground">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function NotFoundComponent() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-3xl font-bold text-primary">Page not found</h1>
      <p className="mt-3 text-muted">The tournament hub currently exposes only the main application route.</p>
    </main>
  );
}
