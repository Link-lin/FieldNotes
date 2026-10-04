import { route } from "@/server/core/http/route";
import { noContent } from "@/server/core/http/respond";
import { deleteAccount } from "@/server/modules/account/account.service";
import { accountDeleteSchema } from "@/shared/schemas";

/** ACCESS-10: settles the trips the account owns, then deletes it; the session cookie is cleared too. */
export const DELETE = route({ body: accountDeleteSchema }, async ({ db, actor, body }) => {
  await deleteAccount(db, actor, body.trips);
  const res = noContent();
  for (const name of ["authjs.session-token", "__Secure-authjs.session-token"]) {
    res.headers.append("Set-Cookie", `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${name.startsWith("__Secure") ? "; Secure" : ""}`);
  }
  return res;
});
