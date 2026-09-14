import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { api } from "../convex/_generated/api";
import { App } from "./App";
import "./index.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
if (typeof convexUrl !== "string" || convexUrl === "") {
  // Fail loudly at boot rather than as a confusing network error later. The
  // static-hosting deploy sets this at build time; local dev reads .env.local.
  throw new Error(
    "VITE_CONVEX_URL is not set. Run `npx convex dev` once to write .env.local.",
  );
}

const convex = new ConvexReactClient(convexUrl);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexAuthProvider
      client={convex}
      api={{
        refreshSession: api.auth.refreshSession,
        signOut: api.auth.signOut,
      }}
    >
      <App />
    </ConvexAuthProvider>
  </StrictMode>,
);
