# Curve Fever Pro Tour Hub

The Tour Hub is a web app for setting up and running Curve Fever Pro tournaments. Organisers can load a roster, generate rounds, enter scores, resolve ties, and manage players or teams during an event. A shareable live view lets everyone follow the scoreboard, bracket, and rankings.

The app supports individual and team formats, single and double elimination, qualification tables, Swiss rounds, and group stages. Tournament snapshots are stored in the browser and can be imported or exported as JSON.

## Requirements

- A current LTS version of [Node.js](https://nodejs.org/)
- [pnpm](https://pnpm.io/) 11

Install pnpm if needed:

```sh
npm install --global pnpm@11.19.0
```

## Local setup

Install the dependencies:

```sh
pnpm install
```

Start the development server:

```sh
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

Local development expects the Curve Fever Pro API at `http://localhost:8000` and uses the Firebase project configured in the app. Create a `.env` file from [`.env.example`](.env.example) to override the API URL or provide Firebase Admin credentials.

| Variable                        | Purpose                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VITE_API_ENDPOINT`             | Overrides the Curve Fever Pro API URL. Local development defaults to `http://localhost:8000`.                                                    |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Admin service-account JSON for server-side live tournament updates. You can omit it when Application Default Credentials are available. |

## Useful commands

| Command             | Purpose                         |
| ------------------- | ------------------------------- |
| `pnpm dev`          | Start the development server.   |
| `pnpm build`        | Create a production build.      |
| `pnpm start`        | Run the production build.       |
| `pnpm typecheck`    | Check TypeScript types.         |
| `pnpm lint`         | Check the code with ESLint.     |
| `pnpm format:check` | Check formatting with Prettier. |

Run `pnpm build` before `pnpm start`.

## Project layout

```text
src/
├── components/   Shared UI and tournament components
├── domain/       Tournament rules, formats, scoring, and round generation
├── features/     Admin, scoreboard, bracket, rankings, archive, auth, and sync
├── routes/       TanStack Router pages
└── styles.css    Global styles
```

The app uses React, TypeScript, TanStack Start, Tailwind CSS, and Firebase Realtime Database.
