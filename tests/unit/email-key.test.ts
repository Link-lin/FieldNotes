import { describe, expect, it } from "vitest";
import { emailKey } from "@/shared/email";

describe("emailKey: when two addresses are the same person's", () => {
  it("ignores case and surrounding spaces for every address", () => {
    expect(emailKey("  Sam@Example.COM ")).toBe("sam@example.com");
  });

  it("lets Gmail ignore dots, the +tag and the googlemail.com spelling", () => {
    const same = ["janedoe@gmail.com", "Jane.Doe@gmail.com", "jane.doe+trip@gmail.com", "j.a.n.e.d.o.e+a+b@gmail.com", "janedoe@googlemail.com", " JANE.DOE+X@GoogleMail.com "];
    expect(new Set(same.map(emailKey))).toEqual(new Set(["janedoe@gmail.com"]));
  });

  it("keeps different Gmail names apart", () => {
    expect(emailKey("jane.doe@gmail.com")).not.toBe(emailKey("jane.doe2@gmail.com"));
    expect(emailKey("jane@gmail.com")).not.toBe(emailKey("jan@gmail.com"));
  });

  it("leaves every other domain exactly as typed, since dots and + can mean something there", () => {
    expect(emailKey("jane.doe@example.com")).toBe("jane.doe@example.com");
    expect(emailKey("jane.doe@example.com")).not.toBe(emailKey("janedoe@example.com"));
    expect(emailKey("jane+trip@example.com")).toBe("jane+trip@example.com");
    expect(emailKey("jane.doe@work-gmail.com")).toBe("jane.doe@work-gmail.com");
    expect(emailKey("jane.doe@gmail.com.example.net")).toBe("jane.doe@gmail.com.example.net");
    expect(emailKey("jane.doe@mail.gmail.com")).toBe("jane.doe@mail.gmail.com");
  });

  it("leaves malformed or empty-named addresses as typed, so they can never collide", () => {
    expect(emailKey("+tag@gmail.com")).toBe("+tag@gmail.com");
    expect(emailKey("...@gmail.com")).toBe("...@gmail.com");
    expect(emailKey("a@b@gmail.com")).toBe("a@b@gmail.com");
    expect(emailKey("@gmail.com")).toBe("@gmail.com");
    expect(emailKey("no-at-sign")).toBe("no-at-sign");
    expect(emailKey("")).toBe("");
  });

  it("is idempotent", () => {
    for (const e of ["Jane.Doe+x@googlemail.com", "sam@example.com", "+a@gmail.com"]) expect(emailKey(emailKey(e))).toBe(emailKey(e));
  });
});
