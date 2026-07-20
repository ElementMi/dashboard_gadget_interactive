# SUP Service Histogram (Forge Jira Dashboard Gadget)

Custom Forge gadget for Jira dashboards that visualizes SUP ticket volume over time, with KPI cards and a ticket table.

## What This App Does

- Adds a Jira dashboard gadget called SUP Ticket Histogram.
- Queries Jira issues and builds histogram views (hour/day/week buckets).
- Supports a configurable foreground JQL filter.
- Shows KPI summary metrics and a detailed ticket table.

## Important Architecture Note

This app uses a backend Forge resolver for Jira API access.

Why this matters:
- Frontend requestJira calls run as the current viewer.
- Some users/admins may see an empty or failed gadget if they do not have required project permissions.
- Backend api.asApp access avoids that viewer-permission trap for shared internal dashboards.

Current flow:
- Frontend UI (src/frontend/index.html + src/frontend/main.jsx + src/frontend/styles.css)
- invoke('loadGadgetData')
- Backend resolver (src/backend/index.js)
- Jira REST calls via api.asApp()

## Project Structure

- manifest.yml
- src/frontend/index.html
- src/frontend/main.jsx
- src/frontend/styles.css
- src/backend/index.js
- vite.config.js
- package.json

## Prerequisites

- Node.js 22.x or 24.x recommended by Forge CLI.
- Forge CLI installed and authenticated.
- Jira site admin access for app installation.

## Install Dependencies

Run in project root:

npm install

## NPM Scripts

- npm run lint
- npm run deploy
- npm run install-app
- npm run tunnel
- npm run build:frontend

## Validate App

forge lint --verbose

## Deploy

Standard command:

forge deploy -e production

## Install On Jira Site

Install to production Jira site:

forge install -e production

Then choose:
- Atlassian app: Jira
- Site URL: your company Jira site
- Confirm scopes when prompted

Check installation state:

forge install list -e production

Expected status should be Up-to-date.

## Internal Distribution (Company Only)

Use Forge sharing via Developer Console Distribution page.

Recommended for internal-only rollout:
- Use sharing link only for internal admins.
- Do not list on Marketplace.
- Do not enable licensing for this internal app.
- If link leaks, generate a new installation link immediately.

## Add Gadget In Jira

After installation:
- Open Jira Dashboard.
- Click Add gadget.
- Search for SUP Ticket Histogram.
- Add to dashboard.

If users still see stale behavior, remove the gadget instance and add it again.

## Troubleshooting

### 1) Gadget visible but content not loading

Likely cause:
- Viewer-scoped Jira API access denied.

Fix:
- Ensure app is deployed with backend resolver + api.asApp() (already implemented).
- Re-add gadget instance after deployment.

### 2) Install says already installed, but gadget not available

Likely cause:
- Old major version installed.

Fix:
- Check installed app version.
- Upgrade or reinstall app on site.
- Confirm production install with forge install list -e production.

### 3) Atlassian Admin page shows intermittent Something went wrong

Notes:
- Connected apps UI can be flaky/intermittent.
- Use Forge CLI as source of truth for install/deploy state.

## Useful Commands

- forge whoami
- forge version list -e production
- forge version details -e production --major-version 2
- forge install list -e production
- forge logs -e production -n 50

## Security and Access

This app is intended for internal company use on your Jira cloud site.

Never share installation links publicly.
