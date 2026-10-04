import { describe, expect, it } from "vitest";
import { onePerAccount, successionOrder, type Person } from "@/server/modules/account/account.rules";

const person = (id: string, userId: string, role: Person["role"], joined: number): Person => ({ id, userId, email: `${userId}@example.com`, role, acceptedAt: new Date(Date.UTC(2026, 0, 1 + joined)) });

describe("the order ownership passes in", () => {
  it("puts owners first, then editors, then viewers", () => {
    const people = [person("a", "vi", "viewer", 0), person("b", "ed", "editor", 1), person("c", "ow", "owner", 2)];
    expect(successionOrder(people).map((p) => p.userId)).toEqual(["ow", "ed", "vi"]);
  });

  it("puts whoever joined first ahead within a role, and breaks a tie by grant id", () => {
    const people = [person("z", "late", "editor", 5), person("y", "early", "editor", 1), person("b", "tie-b", "viewer", 3), person("a", "tie-a", "viewer", 3)];
    expect(successionOrder(people).map((p) => p.userId)).toEqual(["early", "late", "tie-a", "tie-b"]);
  });

  it("doesn't reorder its input", () => {
    const people = [person("a", "vi", "viewer", 0), person("b", "ow", "owner", 1)];
    successionOrder(people);
    expect(people.map((p) => p.userId)).toEqual(["vi", "ow"]);
  });
});

describe("one person per account", () => {
  it("keeps an account's highest-role grant", () => {
    const kept = onePerAccount([person("a", "sam", "viewer", 0), person("b", "sam", "owner", 4), person("c", "sam", "editor", 2)]);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ id: "b", role: "owner" });
  });

  it("keeps the earliest grant among equal roles", () => {
    const kept = onePerAccount([person("b", "sam", "editor", 4), person("a", "sam", "editor", 1)]);
    expect(kept[0]!.id).toBe("a");
  });
});
