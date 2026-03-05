import { cookies } from "next/headers";

const COOKIE_NAME = "bootle_dash_auth";
const PASSWORD = process.env.DASHBOARD_PASSWORD || "dashboard1";

export function verifyPassword(password: string): boolean {
  return password === PASSWORD;
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME);
  return token?.value === "authenticated";
}

export function getAuthCookieName(): string {
  return COOKIE_NAME;
}
