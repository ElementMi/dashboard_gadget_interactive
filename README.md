## SUP Service Histogram
Custom gadget for Jira dashboards that visualizes ticket-volume over time, with KPIs metrics and a ticket-table.

## Structure
`manifest.yml`  
`src/frontend/index.html`  
`src/frontend/main.jsx`  
`src/frontend/styles.css`  
`src/backend/index.js`  
`vite.config.js`  
`package.json`  

## Prerequisites
`Node.js 22.x or 24.x recommended by Forge CLI`  
`Forge CLI installed and authenticated`  
`Jira site admin access for app installation`  

## Dependencies
`npm install` - Run in project root

## Configuration
1. Run `forge lint --verbose` to validate the app  
2. Run `forge deploy -e production` to deploy to production  
3. Run `forge install -e production` to install on your Jira site  
4. Verify with `forge install list -e production` — status should be **Up-to-date**  
5. Open your Jira Dashboard → **Add gadget** → search for **SUP Ticket Histogram**  

## Mathematics
### Time Histogram (Bucketing)
The chart groups tickets into time slots called time bucket (hourly, daily, or weekly). Each ticket is placed into a bucket based on its creation timestamp:

$$\text{bucketIndex} = \left\lfloor \frac{t_{\text{created}} - t_{\text{start}}}{\text{stepMs}} \right\rfloor$$

Bucket sizes: 1 hour = 3,600,000 ms · 1 day = 86,400,000 ms · 1 week = 604,800,000 ms

---

### EMA — Exponential Moving Average (HL/2)
The trend line shows averaging recent ticket counts. Newer buckets have more influence than older ones.  
HL/2 means we use half the ticket count per bucket as input, which keeps the trend line scaled within the bars.

Initially average the first $n$ buckets (where $n$ is the EMA length, e.g. 24 hours or 7 days)

For each new bucket blend the current value with the previous EMA using a weighted mix:
- Newer data gets weight $\alpha = \frac{2}{n + 1}$
- Previous EMA gets weight $1 - \alpha$

**Recurrence formula:**
$$\text{EMA}_i = \text{value}_i \times \alpha + \text{EMA}_{i-1} \times (1 - \alpha)$$

---

### Time Windows
The gadget always shows a full reporting week (Mon 08:00 → next Mon 08:00 Berlin time), or the last 4 such weeks. The grey comparison line shows the same period from one year ago.

**7-day window**, anchored to Monday 08:00 Berlin time of the current reporting week.  
**28-day window**, current week + 3 prior weeks (same Monday anchor − 21 days).  
**Historical comparison**, the same window shifted back exactly 1 year, used to overlay previous-year ticket volume.  

All timestamps are converted to/from UTC with iterative DST correction to ensure accurate Berlin wall-clock alignment.

## Third-Party Dependencies
`@forge/api` ^5.1.0 — Forge backend API  
`@forge/bridge` ^4.5.0 — Frontend-to-backend communication  
`@forge/resolver` ^1.7.0 — Forge function resolver  
`echarts` ^5.5.1 — Chart library for visualizations  
`react` ^18.3.1 — UI framework  
`react-dom` ^18.3.1 — React DOM rendering  
`vite` ^5.4.10 — Frontend build tool  

## Contributing
Thank you for your interest and using this gadget. Also, thank you for the contributions & help along the way building this gadget.

## Security, License & Ownership
This app is intended for internal Sup-Logistik company use on your Jira cloud site, only!  
Use Forge sharing via Developer Console Distribution page. Internal Distribution (Internal only). Never share installation links publicly.  
Do not list on Marketplace. Do not enable licensing for this internal app.  
Should the link leak, generate a new installation link immediately.  