import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "tc_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

const key = (s: string) => new TextEncoder().encode(s);

export async function signSession(memberId: string, secret: string): Promise<string> {
  return new SignJWT({ mid: memberId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(key(secret));
}

export async function verifySession(token: string, secret: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret));
    return typeof payload.mid === "string" ? payload.mid : null;
  } catch {
    return null;
  }
}
