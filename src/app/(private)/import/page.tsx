import { notFound } from "next/navigation";
import { pageActor } from "@/server/auth/session";
import { ImportPage } from "@/features/import/ImportPage/ImportPage";

export default async function ImportRoute() {
  const actor = await pageActor();
  if (!actor.isOwner) notFound();
  return <ImportPage />;
}
