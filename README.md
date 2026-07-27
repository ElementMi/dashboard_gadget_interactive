<h2 style="color: #333333;">SUP Service Histogram</h2>
Custom gadget for Jira dashboards that visualizes ticket-volume over time, with KPIs metrics and a ticket-table.

<h2 style="color: #333333;">Structure</h2>
`manifest.yml`  
`src/frontend/index.html`  
`src/frontend/main.jsx`  
`src/frontend/styles.css`  
`src/backend/index.js`  
`vite.config.js`  
`package.json`  

<h2 style="color: #333333;">Prerequisites</h2>
`Node.js 22.x or 24.x recommended by Forge CLI`  
`Forge CLI installed and authenticated`  
`Jira site admin access for app installation`  

<h2 style="color: #333333;">Dependencies</h2>
`npm install` - Run in project root

<h2 style="color: #333333;">Configuration</h2>
1. Run `forge lint --verbose` to validate the app  
2. Run `forge deploy -e production` to deploy to production  
3. Run `forge install -e production` to install on your Jira site  
4. Verify with `forge install list -e production` — status should be **Up-to-date**  
5. Open your Jira Dashboard → **Add gadget** → search for **SUP Ticket Histogram**  
---
---
<h2 style="color: #333333;">Mathematics</h2>
<h2 style="color: #6B7280;">Time Histogram & Bucketing</h2>
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

---
---
<h2 style="color: #333333;">KPIs — Metrics Overview</h2>

**MA1 — Tickets / Day (This Year)**  
Average tickets per calendar day in the chosen window (7-day or 28-day). Indicates current load baseline.

Time period, counts all tickets created from window start (Mon 08:00) to window end (next Mon 08:00 Berlin time), across all hours and all days.

$$\text{MA1} = \frac{\text{Total Tickets in Window}}{\text{Total Calendar Days}}$$

**MA2 — Tickets / Day (Last Year)**  
Same metric one year ago. Compare MA1 vs MA2 to see if load is increasing or decreasing year-over-year.

Time period, same window shifted back exactly 365 days (or 366 for leap years). Counts all tickets in that prior year window, all hours and all days.

$$\text{MA2} = \frac{\text{Tickets Same Period Previous Year}}{\text{Total Calendar Days}}$$

**<span style="color: #333333;">EMA — Exponential Moving Average (Tickets / Day)</span>**  
Latest EMA trend snapshot, updated in real-time. Shows short-term momentum independent of window selection.

Time period, calculated continuously across the chart history. Latest value is the most recent bucket's EMA (recalculated as new tickets arrive). Does **not** reset between 7-day and 28-day views.

$$\text{EMA}_{\text{latest}} = \text{Most recent value from trend line (HL/2 basis)}$$

**<span style="color: #333333;">Bank Holidays</span>**  
Count of German bank holidays in the viewing period. Useful for interpreting dips in business-hours metrics.

Time period, counts German bank holidays (January 1, January 6, Easter, May 1, Ascension, Whit, German Unity Day, All Saints, Christmas) that fall **within the window calendar days**.

$$\text{Count} = |\{\text{bank holidays in window}\}|$$

---
---
**<span style="color: #333333;">Weekly Averages — Tickets per Completed Weekday/Day, Scaled to 7-Day Week</span>**

For each time band:
$$\text{Avg}_{\text{band, weekly}} = \frac{\text{Tickets in Band}}{\text{Applicable Days}} \times \text{Days per Week}$$

Where "applicable days" = weekdays (excl. holidays) for 08:00–17:00, or all days for other bands.

- **Avg Mo–Fri 08:00–17:00 (excl. holidays):** Business-hours average × 5  
  Time period: Counts tickets Mon–Fri, 08:00–17:00 Berlin time, excluding bank holidays. Divides by completed weekdays only. Scales to a full 5-day work week.

- **Avg Mo–Sun 17:00–22:00 (incl. holidays):** Evening average × 7  
  Time period: Counts tickets any day, 17:00–22:00 Berlin time, including weekends and holidays. Divides by all calendar days in window. Scales to 7 days.

- **Avg Mo–Sun 22:00–06:00 (incl. holidays):** Night average × 7  
  Time period: Counts tickets any day, 22:00–06:00 Berlin time (wraps midnight), including weekends and holidays. Divides by all calendar days. Scales to 7 days.

- **Avg Mo–Sun 06:00–08:00 (incl. holidays):** Early-morning average × 7  
  Time period: Counts tickets any day, 06:00–08:00 Berlin time, including weekends and holidays. Divides by all calendar days. Scales to 7 days.

---
**<span style="color: #333333;">Period Averages — Tickets per Day, Full Window (7-day or 28-day)</span>**

For each time band:
$$\text{Avg}_{\text{band, period}} = \frac{\text{Tickets in Band}}{\text{Applicable Days in Window}}$$

- **Avg Mo–Fri 08:00–17:00 (excl. holidays):** Business hours total ÷ completed weekdays  
  Time period: Counts tickets Mon–Fri, 08:00–17:00 Berlin time, excluding bank holidays. Divides by the number of completed weekdays in the window (no scaling).

- **Avg Mo–Sun 17:00–22:00 (incl. holidays):** Evening total ÷ calendar days  
  Time period: Counts tickets any day, 17:00–22:00 Berlin time. Divides by all calendar days in window (no scaling).

- **Avg Mo–Sun 22:00–06:00 (incl. holidays):** Night total ÷ calendar days  
  Time period: Counts tickets any day, 22:00–06:00 Berlin time (wraps midnight). Divides by all calendar days in window (no scaling).

- **Avg Mo–Sun 06:00–08:00 (incl. holidays):** Early morning total ÷ calendar days  
  Time period: Counts tickets any day, 06:00–08:00 Berlin time. Divides by all calendar days in window (no scaling).

---
**<span style="color: #6B7280;">KPIs — Color Indicators</span>**

The KPI cards use color coding based on **timeline selection** and **metric type**. Thresholds vary to account for scaling differences between 7-day and 28-day views.

#### Weekly Averages (scaled to per-week) — 28-Day Timeline, Daily Bar Size
| Metric | Green | Yellow | Red |
|--------|-----------|--------|-----|
| **WE Avg KPIs** (tickets/week) | < 1.9 | 2.0 – 3.4 | ≥ 3.5 |

#### Regular Averages (per-day) — 28-Day Timeline
| Metric | Green | Yellow | Red |
|--------|-----------|--------|-----|
| **Avg KPIs** (tickets/day) | ≤ 0.2 | > 0.2 and ≤ 0.4 | > 0.4 |

#### Regular Averages (per-day) — 7-Day Timeline
| Metric | Green | Yellow | Red |
|--------|-----------|--------|-----|
| **Avg KPIs** (tickets/day) | ≤ 1.0 | > 1.0 and ≤ 2.4 | > 2.5 |


---
---

<h2 style="color: #333333;">Third-Party Dependencies</h2>
`@forge/api` ^5.1.0 — Forge backend API  
`@forge/bridge` ^4.5.0 — Frontend-to-backend communication  
`@forge/resolver` ^1.7.0 — Forge function resolver  
`echarts` ^5.5.1 — Chart library for visualizations  
`react` ^18.3.1 — UI framework  
`react-dom` ^18.3.1 — React DOM rendering  
`vite` ^5.4.10 — Frontend build tool  

<h2 style="color: #333333;">Contributing</h2>
Thank you for your interest and using this gadget. Also, thank you for the contributions & help along the way building this gadget.

<h2 style="color: #333333;">Security, License & Ownership</h2>
This app is intended for internal Sup-Logistik company use on your Jira cloud site, only!  
Use Forge sharing via Developer Console Distribution page. Internal Distribution (Internal only). Never share installation links publicly.  
Do not list on Marketplace. Do not enable licensing for this internal app.  
Should the link leak, generate a new installation link immediately.  