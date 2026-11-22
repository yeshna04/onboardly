# Frontend – React + Vite + TypeScript + Tailwind

The customer portal (`src/pages/portal`), the admin portal (`src/pages/admin`) and sign-in/sign-up
(`src/pages/auth`). The app talks only to the Flask API under `/api` (`src/lib/api.ts`).

```bash
npm ci
npm run dev     # http://localhost:5173, proxies /api to Flask on :5050
npm run build   # production build into dist/, served by Flask
```

See the [main README](../README.md) for the full setup.
