import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/server/auth/actor";
import { commitImport } from "@/server/modules/import/import.service";
import { createItem, deleteItem, updateItem, updateItemNotes } from "@/server/modules/items/items.service";
import { createTrip } from "@/server/modules/trips/trips.service";
import { countUsage } from "@/server/modules/usage/usage.service";
import type { ImportCommitInput, PlanItemDraftDTO } from "@/shared/import";
import example from "../../docs/design/import-example-v1.json";
import { event, makeActor, NOW, reset, testDb, tripInput } from "./helpers";

const session = vi.hoisted(() => ({ actor: null as Actor | null }));
vi.mock("@/server/auth/session", async () => {
  const { HttpError } = await import("@/server/core/http/errors");
  return {
    currentActor: async () => session.actor,
    requireActor: async () => {
      if (!session.actor) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
      return session.actor;
    },
  };
});
const preview = await import("@/app/api/import/preview/route");

const origin = "http://localhost:3000";
const post = (body: unknown) =>
  new Request(`${origin}/api/import/preview`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });

async function counts(): Promise<Record<string, number>> {
  const rows = await testDb().selectFrom("usage_counts").select(["name", "count"]).execute();
  return Object.fromEntries(rows.map((r) => [r.name, Number(r.count)]));
}

const item = (over: Partial<PlanItemDraftDTO>): PlanItemDraftDTO =>
  ({
    location: null, notes: null, links: [], bookingStatus: "not_required", bookingDueDate: null, plannedPrice: null,
    localDate: "2027-04-15", localTime: null, timeZone: null, durationMinutes: null, timeDisambiguation: null, flightDetails: null,
    type: "activity", title: "Explore", ...over,
  }) as PlanItemDraftDTO;

let owner: Actor;
beforeEach(async () => {
  await reset();
  owner = await makeActor("owner@example.com", "Link");
  session.actor = owner;
});

describe("pilot counts (PRD section 8)", () => {
  it("counts previews by outcome without storing the pasted response", async () => {
    await preview.POST(post({ responseText: JSON.stringify(example), ownerProvidedBudget: null }));
    await preview.POST(post({ responseText: JSON.stringify({ ...example, items: [{ ...example.items[0], title: "" }] }), ownerProvidedBudget: null }));
    expect((await preview.POST(post({ responseText: "{ not json", ownerProvidedBudget: null }))).status).toBe(422);
    expect(await counts()).toEqual({ import_preview_ok: 1, import_preview_needs_fixes: 1, import_preview_rejected: 1 });
    const columns = await testDb().selectFrom("usage_counts").selectAll().executeTakeFirstOrThrow();
    expect(Object.keys(columns).sort()).toEqual(["count", "day", "name"]);
  });

  it("counts a confirmed import, its items and skipped items, but not a retry", async () => {
    const draft: ImportCommitInput = {
      expectedFormatVersion: 1,
      ownerProvidedBudget: null,
      trip: { title: "Tokyo week", destination: "Tokyo, Japan", startDate: "2027-04-14", endDate: "2027-04-18", timeZone: "Asia/Tokyo", budget: null },
      items: [item({ title: "A" }), item({ title: "B" })],
      previewSkipped: 3,
    };
    const key = crypto.randomUUID();
    await commitImport(testDb(), owner, draft, key);
    await commitImport(testDb(), owner, draft, key);
    expect(await counts()).toEqual({ import_trip_created: 1, import_items_created: 2, import_items_skipped: 3 });
  });

  it("counts edits and deletions of imported items, due dates, bookings and manual work", async () => {
    const draft: ImportCommitInput = {
      expectedFormatVersion: 1, ownerProvidedBudget: null,
      trip: { title: "Kyoto", destination: "Kyoto, Japan", startDate: "2027-04-14", endDate: "2027-04-18", timeZone: "Asia/Tokyo", budget: null },
      items: [item({ title: "Imported one" }), item({ title: "Imported two" })],
    };
    const { tripId } = await commitImport(testDb(), owner, draft, crypto.randomUUID());
    const rows = await testDb().selectFrom("plan_items").select(["id", "version", "title"]).where("trip_id", "=", tripId).orderBy("title").execute();
    const [one, two] = rows as [(typeof rows)[number], (typeof rows)[number]];
    await updateItem(testDb(), owner, tripId, one.id, { item: event({ title: "Imported one, edited", localDate: "2027-04-15", localTime: null, bookingStatus: "needs_booking", bookingDueDate: "2027-03-01" }), expectedVersion: one.version });
    await updateItemNotes(testDb(), owner, tripId, two.id, { notes: "Bring cash", expectedVersion: two.version });
    await deleteItem(testDb(), owner, tripId, two.id, two.version + 1);

    const manualTrip = await createTrip(testDb(), owner, tripInput, NOW);
    const manual = await createItem(testDb(), owner, manualTrip.id, event({ bookingStatus: "needs_booking", bookingDueDate: "2026-11-01" }));
    await updateItem(testDb(), owner, manualTrip.id, manual.id, { item: event({ bookingStatus: "booked" }), expectedVersion: manual.version });

    expect(await counts()).toMatchObject({
      import_trip_created: 1,
      ai_item_edited: 2,
      ai_item_deleted: 1,
      due_date_set: 2,
      manual_trip_created: 1,
      manual_item_created: 1,
      item_booked: 1,
    });
  });

  it("never fails the owner's action when counting fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await countUsage({ insertInto: () => { throw new Error("boom"); } } as never, [{ name: "manual_item_created" }]);
    expect(spy).toHaveBeenCalledWith("[usage] Error");
    spy.mockRestore();
  });
});
