# RTCats site access rollout

This branch prepares a server-side gate. It does not protect the current
GitHub Pages site until the Cloudflare deployment and domain cutover are done.

## Source of truth

In the portal database's `Settings` tab, the website-only values are kept in
`D1:E4`. `E2` is the website PIN and is intentionally blank. Blank means the
site is public. `E3:E4` hold the emergency contact name and phone number.

The public `action=settings` endpoint currently serves settings used by the
website. Do not add `SiteAccessPIN` to columns A:B or expose columns D:E through
that endpoint. The dedicated Apps Script source in `Code.gs` reads D:E and
returns only whether a PIN is required, whether a submitted PIN matches, and
the emergency contact. It never returns the PIN.

## Prepare the dedicated Apps Script backend

1. Create a separate Apps Script project owned by the rescue account and paste
   `site-access/Code.gs` into it. It must not replace the Schedule Portal script.
2. Set script properties `SITE_SETTINGS_SPREADSHEET_ID` to the portal database
   spreadsheet ID, and `SITE_GATE_TOKEN` to a new long random secret. Do not
   place either token in this repository or in a public settings response.
3. Deploy as a web app, executing as the owner with access set to Anyone.
   Record the `/exec` URL privately. A request without the token must return
   `unauthorized` and must never reveal Settings values.
4. With E2 blank, test the backend's `status` result from a trusted client:
   `required:false`, `version:"open"`. Test a nonblank PIN on a **copy** of the
   sheet before enabling the real site PIN.

## Prepare Cloudflare Pages

1. Connect the **same GitHub repository** to a Cloudflare Pages project using
   this branch for a test deployment. It is a static site: no framework or
   build command, root (`.`) as the output directory. Pages Functions finds
   `functions/_middleware.js` at the repository root.
2. Configure encrypted project secrets for both preview and production:
   `SITE_GATE_API_URL` (the dedicated `/exec` URL), `SITE_GATE_TOKEN` (same
   value as the Apps Script property), and `SITE_SESSION_SECRET` (a separate
   long random secret). Never put them in a checked-in file.
3. For the Free plan, set the project to fail closed / disable on Functions
   quota exhaustion. The middleware also fails closed when the backend cannot
   be read.
4. Test `/`, a direct store page, a CSS/image asset, and `/_emergency` on the
   Cloudflare preview with E2 blank. In a test copy of the Settings sheet,
   check wrong PIN, right PIN, session persistence, PIN rotation, and direct
   URL blocking. Do not use the real Settings E2 for the locked test.

## Cut over while E2 is blank

1. Merge after preview passes; connect `rtcats.com` as the custom domain and
   verify the live pages and emergency control still work without a PIN.
2. Unpublish the GitHub Pages site, including its `github.io` URL. Move the
   repository to private visibility after verifying Cloudflare still deploys
   from it. Previously copied public content cannot be recalled, so the new
   emergency number is loaded from Settings only by the protected service.
3. Confirm all volunteer page URLs pass through Cloudflare, including direct
   links. Linked Apps Script, Google Forms, and third-party sites have their
   own access rules.

## Activate later

Once volunteers have been told the PIN, enter it in `Settings!E2`. No website
source change or redeployment is needed. Blank E2 again to restore public
access. A shared PIN can be forwarded; it is not an individual volunteer login.
