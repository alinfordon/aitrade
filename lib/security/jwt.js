import { SignJWT, jwtVerify } from "jose";

export const COOKIE_NAME = "aitrade_session";

const alg = "HS256";

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is required");
  return new TextEncoder().encode(s);
}

export async function signToken(payload) {
  const secret = getSecret();
  const jwt = await new SignJWT({
    email: payload.email,
    role: payload.role,
    subscriptionPlan: payload.subscriptionPlan,
  })
    .setProtectedHeader({ alg })
    .setSubject(String(payload.sub))
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
  return jwt;
}

export async function verifyToken(token) {
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const secret = getSecret();
    const { payload } = await jwtVerify(token, secret, { algorithms: [alg] });
    return payload;
  } catch {
    return null;
  }
}
