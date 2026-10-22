import { ghReady, readState, exchangeCode, canWrite, grantedKinds, sealToken, revoke, links, redirectUri, LINK_SECRET } from "./_googleHealth.js";

/* Where Google sends the lifter after they allow (or don't allow) GymBuddy into Google Health:
   GET /api/google-health-callback?code=…&state=… (this exact address is the OAuth client's
   redirect URI). Trades the code for a refresh token, checks the Google account is set up in
   Google Health, and saves the link for the lifter named in the signed state. Answers with a
   small page: on an iPhone this opens outside the home screen app, so it says to go back to it,
   where Settings picks the connection up. */

const page = (title, text, status = 200) => new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · GymBuddy</title><link rel="stylesheet" href="/legal.css"></head>
<body><main><a class="home" href="/#/settings">GymBuddy</a><h1>${title}</h1><p>${text}</p>
<p><a href="/#/settings">Back to GymBuddy</a></p></main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

const AGAIN = "Go back to GymBuddy and try again from Settings › Google Health.";

export async function GET(request) {
  if (!ghReady() || !LINK_SECRET) return page("Not set up yet", "Google Health isn't set up on the server yet.", 503);
  const q = new URL(request.url).searchParams;
  if (q.get("error")) return page("Not connected", `Google Health wasn't connected. ${AGAIN}`);
  const state = readState(q.get("state"));
  if (!state || !q.get("code")) return page("Link expired", `This link has expired or isn't valid. ${AGAIN}`, 400);

  let tokens;
  try {
    tokens = await exchangeCode(q.get("code"), redirectUri(request));
  } catch (e) {
    console.error("google health callback: code exchange failed", e?.message);
    return page("Couldn't connect", `Google didn't accept the sign-in. ${AGAIN}`, 502);
  }
  if (!tokens.refresh_token) return page("Couldn't connect", `Google didn't give GymBuddy lasting access. ${AGAIN}`, 502);
  const kinds = grantedKinds(tokens.scope);
  if (!kinds.length) {
    await revoke(tokens.refresh_token);
    return page("Nothing allowed", `GymBuddy needs at least one of workouts, weight or food to send anything. ${AGAIN} Leave the boxes ticked on Google's page.`);
  }
  const check = await canWrite(tokens.access_token, kinds[0]).catch((e) => ({ ok: false, message: e?.message }));
  if (!check.ok) {
    console.warn("google health callback: account check failed", check.status, check.message);
    await revoke(tokens.refresh_token);
    return page("Open Google Health first", "Google Health didn't let GymBuddy in yet. If you haven't, open the Google Health app and sign in with this Google account. Then go back to GymBuddy and connect again.");
  }
  try {
    await links().save(state.user, { token: sealToken(tokens.refresh_token), scopes: tokens.scope || "", since: state.since });
  } catch (e) {
    console.error("google health callback: link not saved", e?.message);
    await revoke(tokens.refresh_token);
    return page("Couldn't connect", `GymBuddy couldn't save the connection. ${AGAIN}`, 502);
  }
  return page("Google Health connected", "Your workouts, weight and food will be sent to Google Health from today on. You can close this page and go back to GymBuddy.");
}
