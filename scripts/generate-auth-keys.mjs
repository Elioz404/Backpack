#!/usr/bin/env node
/**
 * Generate the Convex Auth signing keys and print them as shell-ready
 * `npx convex env set` commands.
 *
 * Why this exists: `npx @convex-dev/auth` (2.0.0-alpha.1) generates the same
 * key pair but writes it to the deployment with `spawnSync("npx", ...)` and no
 * `shell: true`, which cannot launch `npx.cmd` on Windows — it fails with
 * "Could not set AUTH_PRIVATE_KEY on the Convex deployment". This produces
 * byte-identical output (base64 PKCS8 private key, JWKS JSON with a random
 * `kid`, RS256) and leaves the writing to the caller.
 *
 * Usage:
 *   node scripts/generate-auth-keys.mjs           # dev deployment
 *   node scripts/generate-auth-keys.mjs --prod    # production deployment
 */
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { randomUUID } from "node:crypto";

const ALG = "RS256";
const prod = process.argv.includes("--prod");
const target = prod ? " --prod" : "";

const { publicKey, privateKey } = await generateKeyPair(ALG, {
  extractable: true,
});

const authPrivateKey = Buffer.from(await exportPKCS8(privateKey)).toString(
  "base64",
);
const authJwks = JSON.stringify({
  keys: [{ ...(await exportJWK(publicKey)), kid: randomUUID(), alg: ALG, use: "sig" }],
});

process.stdout.write(
  [
    `npx convex env set AUTH_PRIVATE_KEY ${authPrivateKey}${target}`,
    `npx convex env set AUTH_JWKS '${authJwks}'${target}`,
    "",
  ].join("\n"),
);
