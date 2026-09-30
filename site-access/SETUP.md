# RTCats volunteer email access rollout

This branch prepares an email-code gate. It does not protect the current GitHub
Pages site until the Cloudflare deployment and domain cutover are complete.

## Settings and roster

In the portal database `Settings!D1:E4`, `D2` is `WebsiteAccessMode`.
Leave `E2` blank for public access during rollout; set it to exactly `Email`
after announcing the change. `E3:E4` store the emergency contact name and phone.
The existing public settings endpoint must never expose columns D:E.

The `Volunteers` tab is the authorization source: column A is volunteer ID,
D and E are email addresses, and F is Active. A code goes only to an address
on a row marked `Yes`. Every site request checks the roster again, so changing
Active to `No` revokes access even for an existing session. Two currently
active volunteers lack email addresses and need one before email mode is enabled.
An email address alone never unlocks the site.

## Dedicated Apps Script backend

1. Create a separate Apps Script project owned by the rescue account and paste
   `site-access/Code.gs` into it. Do not replace the Schedule Portal script.
2. Set script properties `SITE_SETTINGS_SPREADSHEET_ID` to the portal database
   ID and `SITE_GATE_TOKEN` to a new long random secret. Keep secrets outside
   the repository and outside public settings responses.
3. Deploy as a web app executing as owner, access `Anyone`. Record the `/exec`
   URL privately. Requests without the secret must return `unauthorized`.
4. Authorize spreadsheet and MailApp permissions in the rescue account. MailApp
   has a daily recipient quota (100 consumer, 1,500 Workspace); plan the first
   rollout accordingly. Requesting another code for the same address within
   60 seconds does not send another message; codes expire after 10 minutes.

## Cloudflare Pages

1. Connect the same GitHub repository to Cloudflare Pages, using this branch
   for preview. No build command or framework; root (`.`) output directory.
   Pages Functions loads `functions/_middleware.js` from the repository root.
2. Set encrypted preview and production secrets: `SITE_GATE_API_URL` (dedicated
   Apps Script `/exec` URL), `SITE_GATE_TOKEN` (matching property), and
   `SITE_SESSION_SECRET` (a separate long random secret). Disable bypass on
   Functions quota exhaustion. Backend errors return 503.
3. Test the public preview with `E2` blank: home, deep links, assets, and
   emergency control. For locked tests, use a **copy** of the spreadsheet with
   `E2=Email` and an active test volunteer. Test code delivery, wrong/expired
   code, direct asset access, session persistence, and revocation on Active=No.
   Restore the preview configuration afterward.

## Cutover and activation

1. After preview passes, connect `rtcats.com` to Cloudflare Pages and verify
   direct URLs and emergency control while `E2` is still blank.
2. Disable GitHub Pages and its `github.io` address so it cannot bypass the
   new gate. Keep GitHub as the source repository; confirm Cloudflare deployments
   still work before making the repository private. Old public copies of the
   emergency number may remain accessible elsewhere.
3. Tell volunteers how to sign in and update missing roster emails. Set
   `Settings!E2` to `Email` only when ready. Blanking E2 restores public
   access without a code change.

This gate covers rtcats.com pages and assets. Linked Forms, Apps Script URLs,
and third-party sites retain their own access rules.
