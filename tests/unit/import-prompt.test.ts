import { describe, expect, it } from "vitest";
import { buildConversionPrompt, buildImportPrompt } from "@/features/import/import-prompt";

describe("external AI prompts", () => {
  it("converts an existing chat plan without requiring a brief in the app", () => {
    const prompt = buildConversionPrompt();
    expect(prompt).toContain("already discussed in this chat");
    expect(prompt).toContain("ask me for those details in this chat");
    expect(prompt).toContain("formatVersion 1");
    expect(prompt).toContain('"formatVersion":1');
    expect(prompt).toContain("Do not include booking-confirmation codes");
  });

  it("includes an owner-supplied budget in a new planning prompt", () => {
    const prompt = buildImportPrompt({
      title: "Kyoto week", destination: "Kyoto, Japan", startDate: "2027-04-14", endDate: "2027-04-18",
      timeZone: "Asia/Tokyo", interests: "Temples", pace: "Relaxed", constraints: "", budgetAmount: "1200", budgetCurrency: "USD",
    });
    expect(prompt).toContain("Owner-supplied budget: 1200 USD");
    expect(prompt).toContain("Trip title: Kyoto week");
  });
});
