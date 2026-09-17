import { describe, expect, it } from "vitest";
import { verifyLineOAuthRedirect } from "../../scripts/lib/verify-line-oauth.mjs";

const LIFF_ID = "2011633158-ZdAj8eJh";
const CLIENT_ID = "2011633158";
const SITE_URL = "https://booking.wegrow-orbit.com";

// Redacted (state/code_challenge replaced) but structurally real capture from
// production on 2026-09-18, used as the required PASS case.
const REAL_REDACTED_URL =
  "https://access.line.me/oauth2/v2.1/login?returnUri=%2Foauth2%2Fv2.1%2Fauthorize%2Fconsent%3Fapp_id%3D2011633158-ZdAj8eJh%26client_id%3D2011633158%26scope%3Dopenid%2520profile%26state%3DREDACTED%26response_type%3Dcode%26code_challenge_method%3DS256%26code_challenge%3DREDACTED%26liff_sdk_version%3D2.31.0%26type%3DL%26redirect_uri%3Dhttps%253A%252F%252Fbooking.wegrow-orbit.com%252F%253Fliff.state%253D%25252Flogin&loginChannelId=2011633158&loginState=REDACTED#/";

function buildUrl(innerOverrides = {}, outerOverrides = {}) {
  const inner = new URLSearchParams({
    app_id: LIFF_ID,
    client_id: CLIENT_ID,
    scope: "openid profile",
    redirect_uri: SITE_URL + "/",
    ...innerOverrides,
  });
  const returnUri = `/oauth2/v2.1/authorize/consent?${inner.toString()}`;
  const outer = new URLSearchParams({ returnUri, ...outerOverrides });
  return `https://access.line.me/oauth2/v2.1/login?${outer.toString()}`;
}

describe("verifyLineOAuthRedirect", () => {
  it("PASS: a real redacted LINE nested URL", () => {
    const result = verifyLineOAuthRedirect(REAL_REDACTED_URL, LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(true);
  });

  it("PASS: a well-formed synthetic URL matching all fields exactly", () => {
    const result = verifyLineOAuthRedirect(buildUrl(), LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(true);
  });

  it("PASS: redirect_uri carries the expected liff.state param", () => {
    const url = buildUrl({ redirect_uri: `${SITE_URL}/?liff.state=%2Flogin` });
    const result = verifyLineOAuthRedirect(url, LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(true);
  });

  it("FAIL: outer pathname is not the expected LINE login path (third review round)", () => {
    const url = buildUrl().replace("/oauth2/v2.1/login?", "/some/other/unexpected/path?");
    const result = verifyLineOAuthRedirect(url, LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(false);
  });

  it("FAIL: returnUri is an absolute URL to a different host, not a relative LINE-internal path (third review round)", () => {
    const inner = new URLSearchParams({
      app_id: LIFF_ID,
      client_id: CLIENT_ID,
      redirect_uri: SITE_URL + "/",
    });
    const returnUri = `https://evil.example.org/consent?${inner.toString()}`;
    const url = `https://access.line.me/oauth2/v2.1/login?returnUri=${encodeURIComponent(returnUri)}`;
    const result = verifyLineOAuthRedirect(url, LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(false);
  });

  it("FAIL: returnUri path is a plausible-looking but wrong LINE-internal path", () => {
    const inner = new URLSearchParams({ app_id: LIFF_ID, client_id: CLIENT_ID, redirect_uri: SITE_URL + "/" });
    const returnUri = `/oauth2/v2.1/authorize/different-endpoint?${inner.toString()}`;
    const url = `https://access.line.me/oauth2/v2.1/login?returnUri=${encodeURIComponent(returnUri)}`;
    const result = verifyLineOAuthRedirect(url, LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(false);
  });

  it("FAIL: redirect_uri carries an extra unexpected query param alongside liff.state (third review round)", () => {
    const url = buildUrl({ redirect_uri: `${SITE_URL}/?liff.state=%2Flogin&evil_param=steal_token` });
    const result = verifyLineOAuthRedirect(url, LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(false);
  });

  it("FAIL: redirect_uri carries only an unexpected query param, no liff.state at all", () => {
    const url = buildUrl({ redirect_uri: `${SITE_URL}/?evil_param=steal_token` });
    const result = verifyLineOAuthRedirect(url, LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(false);
  });

  it("FAIL: app_id has a wrong suffix appended (previously false-passed via includes())", () => {
    const url = buildUrl({ app_id: LIFF_ID + "WRONG" });
    const result = verifyLineOAuthRedirect(url, LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(false);
  });

  it("FAIL: redirect_uri host has an attacker suffix appended (previously false-passed via includes())", () => {
    const url = buildUrl({ redirect_uri: SITE_URL + ".example.org/" });
    const result = verifyLineOAuthRedirect(url, LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(false);
  });

  it("FAIL: redirect_uri is the correct host but the wrong path", () => {
    const url = buildUrl({ redirect_uri: SITE_URL + "/admin" });
    const result = verifyLineOAuthRedirect(url, LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(false);
  });

  it("FAIL: the correct app_id string is hidden inside an unrelated query value, not the app_id key", () => {
    const url = buildUrl({ app_id: "totally-different-id", state: `smuggled-app_id=${LIFF_ID}` });
    const result = verifyLineOAuthRedirect(url, LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(false);
  });

  it("FAIL: duplicate app_id in the nested query", () => {
    const inner = `app_id=${LIFF_ID}&app_id=${LIFF_ID}&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(SITE_URL + "/")}`;
    const returnUri = `/oauth2/v2.1/authorize/consent?${inner}`;
    const url = `https://access.line.me/oauth2/v2.1/login?returnUri=${encodeURIComponent(returnUri)}`;
    const result = verifyLineOAuthRedirect(url, LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(false);
  });

  it("FAIL: duplicate redirect_uri in the nested query", () => {
    const goodRedirect = encodeURIComponent(SITE_URL + "/");
    const evilRedirect = encodeURIComponent("https://evil.example.org/");
    const inner = `app_id=${LIFF_ID}&client_id=${CLIENT_ID}&redirect_uri=${goodRedirect}&redirect_uri=${evilRedirect}`;
    const returnUri = `/oauth2/v2.1/authorize/consent?${inner}`;
    const url = `https://access.line.me/oauth2/v2.1/login?returnUri=${encodeURIComponent(returnUri)}`;
    const result = verifyLineOAuthRedirect(url, LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(false);
  });

  it("FAIL: missing app_id entirely", () => {
    const inner = `client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(SITE_URL + "/")}`;
    const returnUri = `/oauth2/v2.1/authorize/consent?${inner}`;
    const url = `https://access.line.me/oauth2/v2.1/login?returnUri=${encodeURIComponent(returnUri)}`;
    const result = verifyLineOAuthRedirect(url, LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(false);
  });

  it("FAIL: returnUri has no nested query segment at all", () => {
    const url = `https://access.line.me/oauth2/v2.1/login?returnUri=${encodeURIComponent("/oauth2/v2.1/authorize/consent")}`;
    const result = verifyLineOAuthRedirect(url, LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(false);
  });

  it("FAIL: duplicate returnUri at the outer layer", () => {
    const inner = `app_id=${LIFF_ID}&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(SITE_URL + "/")}`;
    const returnUri = encodeURIComponent(`/oauth2/v2.1/authorize/consent?${inner}`);
    const url = `https://access.line.me/oauth2/v2.1/login?returnUri=${returnUri}&returnUri=${returnUri}`;
    const result = verifyLineOAuthRedirect(url, LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(false);
  });

  it("FAIL: wrong hostname (not access.line.me exactly)", () => {
    const url = buildUrl().replace("access.line.me", "access.line.me.evil.org");
    const result = verifyLineOAuthRedirect(url, LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(false);
  });

  it("FAIL: wrong client_id (channel id mismatch)", () => {
    const url = buildUrl({ client_id: "9999999999" });
    const result = verifyLineOAuthRedirect(url, LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(false);
  });

  it("FAIL: not even a parseable URL", () => {
    const result = verifyLineOAuthRedirect("not a url at all", LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(false);
  });

  it("FAIL: userinfo credentials present in the outer URL", () => {
    const url = buildUrl().replace("https://access.line.me", "https://user:pass@access.line.me");
    const result = verifyLineOAuthRedirect(url, LIFF_ID, CLIENT_ID, SITE_URL);
    expect(result.ok).toBe(false);
  });
});
