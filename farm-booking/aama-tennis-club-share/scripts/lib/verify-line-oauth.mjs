// Structural, exact-match verification of LINE's OAuth redirect URL.
// Extracted into its own module so it has a direct, standalone test suite
// (tests/scripts/verify-line-oauth.test.ts) instead of only being exercised
// indirectly through a full postdeploy run against production.
//
// Never does a substring/`includes` search on the raw or decoded URL string —
// every field is extracted by exact key from the correct nesting layer via
// URL/URLSearchParams, then compared with `===`. A prior version of this
// check used `decodedUrl.includes(...)`, which independently reproduced as a
// false PASS for both a wrong app_id (suffix appended) and a spoofed
// redirect_uri domain (suffix appended) — see 2026-09-18 second code review.
export function verifyLineOAuthRedirect(finalUrl, expectedLiffId, expectedClientId, siteUrl) {
  let outer;
  try {
    outer = new URL(finalUrl);
  } catch {
    return { ok: false, reason: `final URL is not parseable: ${finalUrl}` };
  }
  if (outer.protocol !== "https:") return { ok: false, reason: `expected https:, got ${outer.protocol} (${finalUrl})` };
  if (outer.hostname !== "access.line.me") {
    return { ok: false, reason: `expected host exactly "access.line.me", got ${JSON.stringify(outer.hostname)} (${finalUrl})` };
  }
  if (outer.username || outer.password) return { ok: false, reason: `URL contains userinfo credentials, rejecting (${finalUrl})` };

  const returnUriValues = outer.searchParams.getAll("returnUri");
  if (returnUriValues.length !== 1) {
    return { ok: false, reason: `expected exactly one returnUri query param, found ${returnUriValues.length} (${finalUrl})` };
  }
  const returnUri = returnUriValues[0];
  const qIdx = returnUri.indexOf("?");
  if (qIdx === -1) {
    return { ok: false, reason: `returnUri has no query segment to read app_id/redirect_uri from: ${JSON.stringify(returnUri)}` };
  }
  let innerParams;
  try {
    innerParams = new URLSearchParams(returnUri.slice(qIdx + 1));
  } catch {
    return { ok: false, reason: `returnUri's query segment failed to parse: ${JSON.stringify(returnUri)}` };
  }

  const appIdValues = innerParams.getAll("app_id");
  if (appIdValues.length !== 1) return { ok: false, reason: `expected exactly one app_id in returnUri, found ${appIdValues.length}` };
  if (appIdValues[0] !== expectedLiffId) {
    return { ok: false, reason: `app_id is ${JSON.stringify(appIdValues[0])}, expected exactly ${JSON.stringify(expectedLiffId)}` };
  }

  if (expectedClientId) {
    const clientIdValues = innerParams.getAll("client_id");
    if (clientIdValues.length !== 1) return { ok: false, reason: `expected exactly one client_id in returnUri, found ${clientIdValues.length}` };
    if (clientIdValues[0] !== expectedClientId) {
      return {
        ok: false,
        reason: `client_id is ${JSON.stringify(clientIdValues[0])}, expected exactly ${JSON.stringify(expectedClientId)} (derived from the LIFF ID's channel prefix)`,
      };
    }
  }

  const redirectUriValues = innerParams.getAll("redirect_uri");
  if (redirectUriValues.length !== 1) return { ok: false, reason: `expected exactly one redirect_uri in returnUri, found ${redirectUriValues.length}` };
  let redirectUri;
  try {
    redirectUri = new URL(redirectUriValues[0]);
  } catch {
    return { ok: false, reason: `redirect_uri is not a parseable URL: ${JSON.stringify(redirectUriValues[0])}` };
  }
  if (redirectUri.username || redirectUri.password) {
    return { ok: false, reason: `redirect_uri contains userinfo credentials, rejecting` };
  }
  let expectedSite;
  try {
    expectedSite = new URL(siteUrl);
  } catch {
    return { ok: false, reason: `configured siteUrl is not a valid URL: ${siteUrl}` };
  }
  if (redirectUri.origin !== expectedSite.origin) {
    return { ok: false, reason: `redirect_uri origin ${JSON.stringify(redirectUri.origin)} does not exactly match expected ${JSON.stringify(expectedSite.origin)}` };
  }
  if (redirectUri.pathname !== expectedSite.pathname) {
    return { ok: false, reason: `redirect_uri pathname ${JSON.stringify(redirectUri.pathname)} does not exactly match expected ${JSON.stringify(expectedSite.pathname)}` };
  }
  return { ok: true };
}
