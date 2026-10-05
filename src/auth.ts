import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env";
import { userByEmail } from "./db";
import type { User } from "./types";

const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function currentUser(request: Request, env: Env): Promise<User | null> {
  if ((env.APP_ENV === "dev" || env.APP_ENV === "test") && env.DEV_USER_EMAIL) {
    const email = request.headers.get("x-dev-user") ?? env.DEV_USER_EMAIL;
    return userByEmail(env.DB, email);
  }
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  const team = `https://${env.ACCESS_TEAM_DOMAIN}`;
  let jwks = jwksByTeam.get(team);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
    jwksByTeam.set(team, jwks);
  }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: team, audience: env.ACCESS_AUD });
    return typeof payload.email === "string" ? userByEmail(env.DB, payload.email) : null;
  } catch {
    return null;
  }
}
