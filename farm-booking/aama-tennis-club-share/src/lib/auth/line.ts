export type LineProfile = { sub: string; name: string; picture: string | null };

export async function verifyLineIdToken(idToken: string, channelId: string, fetchFn: typeof fetch = fetch): Promise<LineProfile> {
  const body = new URLSearchParams({ id_token: idToken, client_id: channelId }).toString();
  const res = await fetchFn("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as { sub?: string; name?: string; picture?: string; error_description?: string };
  if (!res.ok || !json.sub) throw new Error(json.error_description ?? "LINE 驗證失敗");
  return { sub: json.sub, name: json.name ?? "LINE 使用者", picture: json.picture ?? null };
}
