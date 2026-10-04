import { describe, expect, it } from "vitest";
import {
  READ_ONLY,
  READ_WRITE,
  allLoopback,
  codeChallengeFor,
  hashSecret,
  isCodeChallenge,
  isCodeVerifier,
  isSecret,
  narrowedScope,
  newSecret,
  redirectAllowed,
  redirectHost,
  registrableRedirect,
  requestedScope,
  verifyPkce,
  withParams,
} from "@/server/modules/oauth/oauth.rules";

describe("codes and tokens", () => {
  it("are 256 random bits behind a prefix that says what they are", () => {
    for (const kind of ["code", "access", "refresh"] as const) {
      const a = newSecret(kind);
      expect(isSecret(kind, a)).toBe(true);
      expect(a).not.toBe(newSecret(kind));
      expect(a.slice(0, 6)).toBe({ code: "fn_ac_", access: "fn_at_", refresh: "fn_rt_" }[kind]);
    }
  });

  it("are not mistaken for one another or for malformed values", () => {
    const access = newSecret("access");
    expect(isSecret("refresh", access)).toBe(false);
    expect(isSecret("access", `${access}x`)).toBe(false);
    expect(isSecret("access", access.slice(0, -1))).toBe(false);
    expect(isSecret("access", "fn_at_" + "+".repeat(43))).toBe(false);
    expect(isSecret("access", "")).toBe(false);
  });

  it("hash to 32 bytes, and the hash is not the value", () => {
    const s = newSecret("access");
    expect(hashSecret(s)).toHaveLength(32);
    expect(hashSecret(s).toString("utf8")).not.toContain(s);
  });
});

describe("scopes", () => {
  it("make write imply read, ignore names it does not know, and default to read", () => {
    expect(requestedScope("trips:write")).toBe(READ_WRITE);
    expect(requestedScope("trips:read trips:write offline_access")).toBe(READ_WRITE);
    expect(requestedScope("trips:read")).toBe(READ_ONLY);
    expect(requestedScope("offline_access something_else")).toBe(READ_ONLY);
    expect(requestedScope(undefined)).toBe(READ_ONLY);
    expect(requestedScope("")).toBe(READ_ONLY);
  });

  it("let a refresh ask for less than it holds, never more", () => {
    expect(narrowedScope(undefined, READ_WRITE)).toBe(READ_WRITE);
    expect(narrowedScope("offline_access", READ_WRITE)).toBe(READ_WRITE);
    expect(narrowedScope("trips:read", READ_WRITE)).toBe(READ_ONLY);
    expect(narrowedScope("trips:read trips:write", READ_WRITE)).toBe(READ_WRITE);
    expect(narrowedScope("trips:write", READ_ONLY)).toBeNull();
    expect(narrowedScope("trips:read admin", READ_WRITE)).toBeNull();
  });
});

describe("registrable redirect addresses", () => {
  it("accept https and http on a loopback host", () => {
    expect(registrableRedirect("https://claude.ai/api/mcp/auth_callback")).toBe("https://claude.ai/api/mcp/auth_callback");
    expect(registrableRedirect("https://chatgpt.com/connector_platform_oauth_redirect")).not.toBeNull();
    expect(registrableRedirect("http://localhost:3118/callback")).not.toBeNull();
    expect(registrableRedirect("http://127.0.0.1/callback")).not.toBeNull();
    expect(registrableRedirect("http://[::1]:8080/cb")).not.toBeNull();
  });

  it("refuse everything else", () => {
    for (const bad of [
      "http://example.com/callback",
      "http://localhost.evil.example/callback",
      "ftp://example.com/cb",
      "cursor://anysphere/oauth",
      "javascript:alert(1)",
      "https://user:pass@example.com/cb",
      "https://example.com/cb#frag",
      "https://example.com/cb#",
      "https://example.com/c\\b",
      "/relative/path",
      "",
      "https://" + "a".repeat(600) + ".com/cb",
      "https://example.com/\ncb",
    ]) {
      expect(registrableRedirect(bad), bad).toBeNull();
    }
    expect(registrableRedirect(42)).toBeNull();
    expect(registrableRedirect(null)).toBeNull();
  });
});

describe("matching a redirect address against the registered ones", () => {
  const registered = ["https://claude.ai/api/mcp/auth_callback", "http://localhost/callback", "http://127.0.0.1:3118/cb?x=1"];

  it("needs an exact match for https", () => {
    expect(redirectAllowed(registered, "https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(redirectAllowed(registered, "https://claude.ai/api/mcp/auth_callback/")).toBe(false);
    expect(redirectAllowed(registered, "https://claude.ai/api/mcp/auth_callback?x=1")).toBe(false);
    expect(redirectAllowed(registered, "https://claude.ai:444/api/mcp/auth_callback")).toBe(false);
    expect(redirectAllowed(registered, "https://CLAUDE.ai.evil.example/api/mcp/auth_callback")).toBe(false);
    expect(redirectAllowed(registered, "https://evil.example/api/mcp/auth_callback")).toBe(false);
  });

  it("lets a loopback address use any port, and nothing else differ", () => {
    expect(redirectAllowed(registered, "http://localhost:51234/callback")).toBe(true);
    expect(redirectAllowed(registered, "http://localhost/callback")).toBe(true);
    expect(redirectAllowed(registered, "http://127.0.0.1:9999/cb?x=1")).toBe(true);
    expect(redirectAllowed(registered, "http://localhost:51234/other")).toBe(false);
    expect(redirectAllowed(registered, "http://127.0.0.1:9999/cb?x=2")).toBe(false);
    expect(redirectAllowed(registered, "http://127.0.0.1:9999/cb")).toBe(false);
    expect(redirectAllowed(registered, "http://[::1]:9999/callback")).toBe(false);
    expect(redirectAllowed(registered, "https://localhost:51234/callback")).toBe(false);
    expect(redirectAllowed(registered, "http://localhost:51234/callback#x")).toBe(false);
    expect(redirectAllowed(registered, "not a url")).toBe(false);
  });
});

describe("the redirect address as the consent page shows it", () => {
  it("is the host and port", () => {
    expect(redirectHost("https://claude.ai/api/mcp/auth_callback")).toBe("claude.ai");
    expect(redirectHost("http://localhost:3118/callback")).toBe("localhost:3118");
    expect(allLoopback(["http://localhost:1/a", "http://127.0.0.1/b"])).toBe(true);
    expect(allLoopback(["http://localhost:1/a", "https://claude.ai/cb"])).toBe(false);
    expect(allLoopback([])).toBe(false);
  });
});

describe("PKCE", () => {
  // RFC 7636 appendix B.
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

  it("hashes a verifier with S256", () => {
    expect(codeChallengeFor(verifier)).toBe(challenge);
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it("refuses a different verifier, a wrong challenge and malformed values", () => {
    expect(verifyPkce(verifier.replace("d", "e"), challenge)).toBe(false);
    expect(verifyPkce(verifier, challenge.replace("E", "F"))).toBe(false);
    expect(verifyPkce(verifier, challenge.slice(1))).toBe(false);
    expect(verifyPkce("short", challenge)).toBe(false);
    expect(isCodeVerifier(verifier)).toBe(true);
    expect(isCodeVerifier(`${verifier}!`)).toBe(false);
    expect(isCodeVerifier("a".repeat(129))).toBe(false);
    expect(isCodeChallenge(challenge)).toBe(true);
    expect(isCodeChallenge(`${challenge}=`)).toBe(false);
  });
});

describe("adding parameters to the app's redirect address", () => {
  it("keeps the query it already has and drops absent values", () => {
    expect(withParams("https://x.example/cb?keep=1", { code: "c", state: undefined, iss: "https://notes.example" })).toBe(
      "https://x.example/cb?keep=1&code=c&iss=https%3A%2F%2Fnotes.example",
    );
  });

  it("encodes values so a state cannot add parameters", () => {
    const url = new URL(withParams("https://x.example/cb", { state: "a&code=evil#frag" }));
    expect(url.searchParams.get("state")).toBe("a&code=evil#frag");
    expect(url.searchParams.has("code")).toBe(false);
    expect(url.hash).toBe("");
  });
});
