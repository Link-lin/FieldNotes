import { notFound, redirect } from "next/navigation";
import { PageMessage } from "@/components/layout/PageMessage/PageMessage";
import { ButtonLink } from "@/components/ui/Button/Button";
import { ConsentPage } from "@/features/connector/ConsentPage/ConsentPage";
import { currentSession, pageActor } from "@/server/auth/session";
import { getDb } from "@/server/core/db/client";
import { connectorEnabled } from "@/server/core/env";
import { allLoopback, hasWrite, redirectHost } from "@/server/modules/oauth/oauth.rules";
import { AuthorizationPageError, AuthorizationRedirectError, checkAuthorizationRequest, type AuthorizationParams } from "@/server/modules/oauth/oauth.service";

export const dynamic = "force-dynamic";

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * CONNECT-2: an AI app sends the person here to ask for access. The page is in the signed-in group, so a visitor who is
 * signed out signs in first and returns to this exact address. A request that cannot be trusted enough to send the
 * person back to the app shows an error and redirects nowhere; one the app got wrong goes back to it as an OAuth error.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!connectorEnabled()) notFound();
  await pageActor();
  const query = await searchParams;
  const params: AuthorizationParams = {
    client_id: first(query.client_id),
    redirect_uri: first(query.redirect_uri),
    response_type: first(query.response_type),
    state: first(query.state),
    scope: first(query.scope),
    code_challenge: first(query.code_challenge),
    code_challenge_method: first(query.code_challenge_method),
    resource: first(query.resource),
  };

  let request;
  try {
    request = await checkAuthorizationRequest(getDb(), params);
  } catch (err) {
    if (err instanceof AuthorizationRedirectError) redirect(err.redirectTo);
    if (err instanceof AuthorizationPageError) {
      return (
        <PageMessage title="Can't connect this app" action={<ButtonLink href="/">Back to your trips</ButtonLink>}>
          {err.message}
        </PageMessage>
      );
    }
    throw err;
  }

  const user = (await currentSession())?.user;
  const sent = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) as Record<string, string>;
  return (
    <ConsentPage
      appName={request.client.name}
      returnHost={redirectHost(request.redirectUri)}
      runsLocally={allLoopback(request.client.redirectUris)}
      wantsChanges={hasWrite(request.scope)}
      accountName={user?.name ?? user?.email ?? "your account"}
      accountEmail={user?.name && user?.email ? user.email : null}
      params={sent}
    />
  );
}
