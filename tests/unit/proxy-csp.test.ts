import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";

afterEach(() => vi.unstubAllEnvs());

const csp = () => proxy(new NextRequest("http://localhost:3000/sign-in")).headers.get("content-security-policy")!;
const formAction = () => /form-action ([^;]+)/.exec(csp())![1]!.split(" ");

describe("the content security policy's form-action", () => {
  it("lets a sign-in form redirect to Google, Apple and WeChat at their own hosts, and nowhere else", () => {
    vi.stubEnv("APPLE_ORIGIN", "");
    vi.stubEnv("WECHAT_OPEN_ORIGIN", "");
    expect(formAction()).toEqual(["'self'", "https://accounts.google.com", "https://appleid.apple.com", "https://open.weixin.qq.com"]);
  });

  it("follows the overrides that point a test at stand-in servers, down to the origin", () => {
    vi.stubEnv("APPLE_ORIGIN", "http://127.0.0.1:4020/auth/");
    vi.stubEnv("WECHAT_OPEN_ORIGIN", "http://127.0.0.1:4010");
    expect(formAction()).toEqual(["'self'", "https://accounts.google.com", "http://127.0.0.1:4020", "http://127.0.0.1:4010"]);
  });

  it("falls back to the real hosts when an override isn't a usable address", () => {
    vi.stubEnv("APPLE_ORIGIN", "not a url");
    vi.stubEnv("WECHAT_OPEN_ORIGIN", "also not");
    expect(formAction()).toEqual(["'self'", "https://accounts.google.com", "https://appleid.apple.com", "https://open.weixin.qq.com"]);
  });
});
