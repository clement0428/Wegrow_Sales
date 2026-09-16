import { redirect } from "next/navigation";
import LiffLogin from "@/components/LiffLogin";
import { getCurrentMember } from "@/lib/auth/current-member";
import { env } from "@/lib/env";

type SearchParams = Promise<{ returnTo?: string; "liff.state"?: string }>;
type Params = Promise<{ slug?: string[] }>;

function safeReturnTo(input: string | undefined): string {
  if (!input) return "/";
  // must be a same-origin path
  if (!input.startsWith("/") || input.startsWith("//")) return "/";
  // shared LIFF links are /events/{id}; the event detail is the home-page sheet, so land there directly
  const m = input.match(/^\/events\/([^/?#]+)\/?$/);
  if (m) return `/?event=${m[1]}`;
  return input;
}

export default async function LoginPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  // returnTo priority: explicit query > liff.state (LIFF passes intended path here) > path-based slug
  let returnTo = "/";
  if (sp.returnTo) returnTo = sp.returnTo;
  else if (sp["liff.state"]) returnTo = sp["liff.state"];
  else if (slug && slug.length > 0) returnTo = "/" + slug.join("/");
  returnTo = safeReturnTo(returnTo);

  if (await getCurrentMember()) redirect(returnTo);
  return (
    <LiffLogin
      liffId={process.env.NEXT_PUBLIC_LIFF_ID ?? null}
      devLogin={env.DEV_FAKE_LOGIN}
      returnTo={returnTo}
    />
  );
}
