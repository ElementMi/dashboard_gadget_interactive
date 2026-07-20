import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as echarts from 'echarts';
import { invoke } from '@forge/bridge';

const DEFAULT_JQL = 'project = SUP AND summary ~ "Sprachnachricht von" ORDER BY created DESC, "impact (migrated 2)[dropdown]" ASC';
const STATIC_TIMELINE_JQL = 'project = SUP AND summary ~ "Sprachnachricht von" ORDER BY created DESC, "impact (migrated 2)[dropdown]" ASC';

const timeframeOptions = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
];

const intervalOptions = [
  { label: 'Hourly', value: 'hour' },
  { label: 'Daily', value: 'day' },
  { label: 'Weekly', value: 'week' },
];

const IMPACT_FIELD_NAMES = ['impact (migrated 2)[dropdown]', 'Impact (migrated 2)[dropdown]', 'impact', 'Impact'];
const ORGANIZATION_FIELD_NAMES = ['organization', 'Organisation', 'Organizations', 'Organisationen'];
const REACTION_FIELD_NAMES = ['Reaktionszeit', 'Reaktionzeit', 'Reaktionszeit (SLA)', 'Time to first response', 'First response time'];

const BERLIN_TIMEZONE = 'Europe/Berlin';
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const BANK_HOLIDAYS = new Set(['01.01', '06.01', '03.04', '06.04', '01.05', '14.05', '25.05', '04.06', '03.10', '01.11', '25.12', '26.12']);

const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

const dateOnlyFormatter = new Intl.DateTimeFormat('de-DE', {
  timeZone: BERLIN_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
});

const hourOnlyFormatter = new Intl.DateTimeFormat('de-DE', {
  timeZone: BERLIN_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const createdTableFormatter = new Intl.DateTimeFormat('de-DE', {
  timeZone: BERLIN_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function getTzParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: get('weekday'),
  };
}

function zonedDateTimeToUtcDate(parts, timeZone) {
  let timestamp = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second ?? 0);

  // Iterate to resolve DST/offset differences between intended local wall-time and UTC timestamp.
  for (let i = 0; i < 4; i += 1) {
    const actual = getTzParts(new Date(timestamp), timeZone);
    const wantedUtcLike = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second ?? 0);
    const actualUtcLike = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const diff = wantedUtcLike - actualUtcLike;
    timestamp += diff;

    if (diff === 0) {
      break;
    }
  }

  return new Date(timestamp);
}

function getBerlinWeekWindow(now = new Date()) {
  const berlinNow = getTzParts(now, BERLIN_TIMEZONE);
  const weekday = weekdayMap[berlinNow.weekday] ?? 1;
  const minutesOfDay = berlinNow.hour * 60 + berlinNow.minute;

  // Before Monday 08:00, keep the previous reporting week active.
  let daysSinceMonday = weekday - 1;
  if (weekday === 1 && minutesOfDay < 8 * 60) {
    daysSinceMonday = 7;
  }

  const berlinDateOnlyUtc = Date.UTC(berlinNow.year, berlinNow.month - 1, berlinNow.day);
  const mondayDateOnly = new Date(berlinDateOnlyUtc - daysSinceMonday * MS_PER_DAY);

  const start = zonedDateTimeToUtcDate(
    {
      year: mondayDateOnly.getUTCFullYear(),
      month: mondayDateOnly.getUTCMonth() + 1,
      day: mondayDateOnly.getUTCDate(),
      hour: 8,
      minute: 0,
      second: 0,
    },
    BERLIN_TIMEZONE
  );

  const end = new Date(start.getTime() + 7 * MS_PER_DAY);
  return { start, end };
}

function getWindowForTimeframe(timeframeDays) {
  if (timeframeDays === 7) {
    return getBerlinWeekWindow();
  }

  const end = new Date();
  const start = new Date(end.getTime() - timeframeDays * MS_PER_DAY);
  return { start, end };
}

function shiftDateByYears(date, yearOffset) {
  const parts = getTzParts(date, BERLIN_TIMEZONE);
  return zonedDateTimeToUtcDate(
    {
      year: parts.year + yearOffset,
      month: parts.month,
      day: parts.day,
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
    },
    BERLIN_TIMEZONE
  );
}

function stripOrderByClause(jql) {
  return (jql ?? '').replace(/\s+order\s+by\b[\s\S]*$/i, '').trim();
}

function formatHistoricalJqlDate(date) {
  const parts = getTzParts(date, BERLIN_TIMEZONE);
  return `${parts.year}/${pad2(parts.month)}/${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

function buildHistoricalHistogramFromPreviousYear(issues, interval, window) {
  const template = toTimeHistogram([], interval, window);
  const historicalWindow = {
    start: shiftDateByYears(window.start, -1),
    end: shiftDateByYears(window.end, -1),
  };

  const yearHistogram = toTimeHistogram(issues, interval, historicalWindow);

  return {
    window: historicalWindow,
    histogram: template.map((bucket, index) => ({
      ...bucket,
      tickets: Number(yearHistogram[index]?.tickets ?? 0),
      series: 'Historical previous year',
    })),
  };
}

function buildStaticTimelineJql(searchJql, historicalWindow) {
  const baseJql = stripOrderByClause(searchJql);
  if (!baseJql || !historicalWindow?.start || !historicalWindow?.end) {
    return 'No historical comparison window available yet.';
  }

  return `(${baseJql}) AND (created >= "${formatHistoricalJqlDate(historicalWindow.start)}" AND created < "${formatHistoricalJqlDate(historicalWindow.end)}") ORDER BY created DESC`;
}

function buildSearchJql(userJql) {
  const trimmed = (userJql ?? '').trim();

  if (!trimmed) {
    return DEFAULT_JQL;
  }

  if (/\border\s+by\b/i.test(trimmed)) {
    return trimmed;
  }

  return `${trimmed} ORDER BY created DESC`;
}

function getBucketStepMs(interval) {
  if (interval === 'week') return 7 * MS_PER_DAY;
  if (interval === 'day') return MS_PER_DAY;
  return MS_PER_HOUR;
}

function formatBucketLabel(date, interval) {
  if (interval === 'hour') return `${dateOnlyFormatter.format(date)} ${hourOnlyFormatter.format(date)}`;
  if (interval === 'day') return dateOnlyFormatter.format(date);
  return `Wk ${dateOnlyFormatter.format(date)}`;
}

function toTimeHistogram(issues, interval, window) {
  const stepMs = getBucketStepMs(interval);
  const rawStartMs = window.start.getTime();
  const rawEndMs = window.end.getTime();

  // Hourly buckets are aligned to exact hour boundaries for stable chart labels.
  const startMs = interval === 'hour' ? Math.floor(rawStartMs / MS_PER_HOUR) * MS_PER_HOUR : rawStartMs;
  const endMs = interval === 'hour' ? Math.ceil(rawEndMs / MS_PER_HOUR) * MS_PER_HOUR : rawEndMs;
  const bucketCount = Math.max(1, Math.ceil((endMs - startMs) / stepMs));

  const bins = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = new Date(startMs + index * stepMs);

    return {
      xKey: `${bucketStart.toISOString()}_${index}`,
      period: formatBucketLabel(bucketStart, interval),
      tickets: 0,
      sortKey: bucketStart.getTime(),
    };
  });

  for (const issue of issues ?? []) {
    const created = issue?.fields?.created;
    if (!created) continue;

    const createdDate = new Date(created);
    if (Number.isNaN(createdDate.getTime())) continue;
    if (createdDate < window.start || createdDate >= window.end) continue;

    const diff = createdDate.getTime() - startMs;
    const bucketIndex = Math.floor(diff / stepMs);

    if (bucketIndex >= 0 && bucketIndex < bins.length) {
      bins[bucketIndex].tickets += 1;
    }
  }

  return bins
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((bin) => ({
      xKey: bin.xKey,
      period: bin.period,
      tickets: bin.tickets,
      series: 'Tickets',
    }));
}

function getM1TrendLength(timeframeDays, interval) {
  if (timeframeDays === 30) {
    if (interval === 'day') return 7;
    if (interval === 'hour') return 24;
    if (interval === 'week') return 1;
    return 0;
  }

  if (timeframeDays === 7) {
    if (interval === 'hour') return 24;
    if (interval === 'day') return 1;
    return 0;
  }

  return 0;
}

function toM1EmaSeries(histogram, timeframeDays, interval) {
  const length = getM1TrendLength(timeframeDays, interval);
  if (!length) return { length: 0, data: [], latest: null };

  // Seed EMA with the first full-window average, then apply standard EMA recurrence.
  const alpha = 2 / (length + 1);
  let rollingSum = 0;
  let emaValue = null;
  const points = [];

  for (let i = 0; i < (histogram?.length ?? 0); i += 1) {
    const current = histogram[i];
    const hl2 = Number(current?.tickets ?? 0) / 2;
    rollingSum += hl2;

    if (i >= length) {
      rollingSum -= Number(histogram[i - length]?.tickets ?? 0) / 2;
    }

    if (i === length - 1) {
      emaValue = rollingSum / length;
    } else if (i >= length) {
      emaValue = hl2 * alpha + emaValue * (1 - alpha);
    }

    points.push({
      xKey: current?.xKey ?? `${i}`,
      period: current?.period ?? `${i}`,
      m1: Number.isFinite(emaValue) ? emaValue : null,
      series: 'M1 EMA (HL/2)',
    });
  }

  const latestPoint = [...points].reverse().find((point) => Number.isFinite(point.m1));

  return {
    length,
    data: points.filter((point) => Number.isFinite(point.m1)),
    latest: latestPoint?.m1 ?? null,
  };
}

function normalizeLabel(value) {
  return (value ?? '').toString().trim().toLowerCase();
}

function findFieldIdByDisplayName(namesMap, candidateNames) {
  const wanted = candidateNames.map(normalizeLabel);
  for (const [fieldId, displayName] of Object.entries(namesMap ?? {})) {
    if (wanted.includes(normalizeLabel(displayName))) {
      return fieldId;
    }
  }
  return null;
}

function getFieldByNames(fields, namesMap, candidateNames) {
  const directMatch = candidateNames.find((name) => fields?.[name] !== undefined);
  if (directMatch) return fields[directMatch];

  const fieldId = findFieldIdByDisplayName(namesMap, candidateNames);
  if (fieldId && fields?.[fieldId] !== undefined) return fields[fieldId];

  return null;
}

function toDisplayValue(value) {
  if (value == null) return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    if (!value.length) return '-';
    return value
      .map((item) => {
        if (item == null) return '';
        if (typeof item === 'string') return item;
        if (typeof item === 'object') return item.displayName ?? item.name ?? item.value ?? JSON.stringify(item);
        return String(item);
      })
      .filter(Boolean)
      .join(', ');
  }

  if (typeof value === 'object') {
    return value.displayName ?? value.name ?? value.value ?? JSON.stringify(value);
  }

  return String(value);
}

function toVisibleIssuesWithNames(issues, window, namesMap) {
  const visible = [];

  for (const issue of issues ?? []) {
    const created = issue?.fields?.created;
    if (!created) continue;

    const createdDate = new Date(created);
    if (Number.isNaN(createdDate.getTime())) continue;
    if (createdDate < window.start || createdDate >= window.end) continue;

    const fields = issue?.fields ?? {};
    const impactValue = getFieldByNames(fields, namesMap, IMPACT_FIELD_NAMES);
    const organizationValue = getFieldByNames(fields, namesMap, ORGANIZATION_FIELD_NAMES);
    const reactionValue = getFieldByNames(fields, namesMap, REACTION_FIELD_NAMES);

    visible.push({
      key: issue.key,
      project: fields?.project?.key ?? '-',
      impact: toDisplayValue(impactValue),
      assignee: fields?.assignee?.displayName ?? 'Unassigned',
      summary: fields?.summary ?? '(no summary)',
      organization: toDisplayValue(organizationValue),
      reactionTime: toDisplayValue(reactionValue),
      createdDisplay: createdTableFormatter.format(createdDate),
      createdRaw: createdDate.toISOString(),
      updatedDisplay: fields?.updated ? createdTableFormatter.format(new Date(fields.updated)) : '-',
    });
  }

  return visible;
}

function formatKpi(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function countBankHolidaysInWindow(window) {
  const startLocal = getTzParts(window.start, BERLIN_TIMEZONE);
  const endLocal = getTzParts(new Date(window.end.getTime() - 1), BERLIN_TIMEZONE);

  let cursorUtc = Date.UTC(startLocal.year, startLocal.month - 1, startLocal.day);
  const endUtc = Date.UTC(endLocal.year, endLocal.month - 1, endLocal.day);
  let count = 0;

  while (cursorUtc <= endUtc) {
    const cursorDate = new Date(cursorUtc);
    const key = `${pad2(cursorDate.getUTCDate())}.${pad2(cursorDate.getUTCMonth() + 1)}`;
    if (BANK_HOLIDAYS.has(key)) {
      count += 1;
    }
    cursorUtc += MS_PER_DAY;
  }

  return count;
}

function computeKpis(tickets, window, m1Value) {
  const total = tickets?.length ?? 0;
  const daysInWindow = Math.max(1, (window.end.getTime() - window.start.getTime()) / MS_PER_DAY);
  const avgPerDay = total / daysInWindow;

  let band8to17 = 0;
  let band17to22 = 0;
  let band22to6 = 0;
  let band6to8 = 0;
  let m2 = 0;

  for (const ticket of tickets ?? []) {
    const createdDate = new Date(ticket.createdRaw);
    if (Number.isNaN(createdDate.getTime())) continue;

    const berlinParts = getTzParts(createdDate, BERLIN_TIMEZONE);
    const hour = berlinParts.hour;

    if (hour >= 8 && hour < 17) band8to17 += 1;
    else if (hour >= 17 && hour < 22) band17to22 += 1;
    else if (hour >= 22 || hour < 6) band22to6 += 1;
    else band6to8 += 1;

    const impact = (ticket.impact ?? '').toLowerCase();
    if (impact.includes('schwere störung') || impact.includes('severe disruption')) {
      m2 += 1;
    }
  }

  return {
    m1: Number.isFinite(m1Value) ? formatKpi(m1Value) : 'N/A',
    m2,
    bankHolidays: countBankHolidaysInWindow(window),
    ticketsPerDay: formatKpi(avgPerDay),
    avg8to17: formatKpi(band8to17 / daysInWindow),
    avg17to22: formatKpi(band17to22 / daysInWindow),
    avg22to6: formatKpi(band22to6 / daysInWindow),
    avg6to8: formatKpi(band6to8 / daysInWindow),
  };
}

function ChartPanel({ histogram, historicalHistogram, m1Trend, interval }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !histogram?.length) return;

    const chart = echarts.init(containerRef.current, null, { renderer: 'canvas' });

    const categories = histogram.map((d) => d.period);
    const tickets = histogram.map((d) => d.tickets);
    const historicalTickets = (historicalHistogram ?? []).map((d) => d.tickets);

    const trendMap = new Map((m1Trend?.data ?? []).map((d) => [d.period, d.m1]));
    const m1Data = categories.map((period) => (trendMap.has(period) ? trendMap.get(period) : null));

    chart.setOption({
      animation: false,
      title: {
        text: 'Tickets over time',
        subtext:
          (m1Trend?.length ?? 0) > 0
            ? 'Green bars = tickets, red line = M1 EMA (HL/2)'
            : 'X-axis: time, Y-axis: number of tickets',
        textStyle: { fontSize: 14, fontWeight: 600 },
        subtextStyle: { fontSize: 11, color: '#42526e' },
      },
      grid: {
        top: 70,
        left: 42,
        right: 14,
        bottom: interval === 'hour' ? 72 : 46,
      },
      tooltip: {
        trigger: 'axis',
      },
      xAxis: {
        type: 'category',
        data: categories,
        axisLabel: {
          interval: interval === 'hour' ? 'auto' : 0,
          rotate: interval === 'hour' ? 45 : 0,
        },
      },
      yAxis: {
        type: 'value',
        name: 'Tickets',
        minInterval: 1,
      },
      series: [
        {
          name: 'Tickets',
          type: 'bar',
          data: historicalTickets,
          barGap: '-100%',
          barWidth: '55%',
          itemStyle: {
            color: '#97A0AF',
          },
          z: 1,
          emphasis: { focus: 'series' },
        },
        {
          name: 'Tickets',
          type: 'bar',
          data: tickets,
          barWidth: '55%',
          itemStyle: {
            color: 'rgba(168, 230, 207, 0.6)',
          },
          z: 2,
          emphasis: { focus: 'series' },
        },
        {
          name: 'M1 EMA (HL/2)',
          type: 'line',
          data: (m1Trend?.length ?? 0) > 0 ? m1Data : [],
          smooth: false,
          connectNulls: false,
          showSymbol: false,
          lineStyle: {
            color: '#D14343',
            width: 2,
          },
          itemStyle: {
            color: '#D14343',
          },
          z: 4,
          emphasis: { focus: 'series' },
        },
      ],
      legend: {
        bottom: 0,
      },
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [histogram, historicalHistogram, m1Trend, interval]);

  return <div ref={containerRef} className="chart" />;
}

function App() {
  const [timeframeDays, setTimeframeDays] = useState(30);
  const [jqlInput, setJqlInput] = useState('');
  const [appliedJql, setAppliedJql] = useState(DEFAULT_JQL);
  const [interval, setInterval] = useState('day');
  const [tablePage, setTablePage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const hasLoadedOnceRef = useRef(false);
  const rowsPerPage = 10;
  const availableIntervalOptions = useMemo(
    () => (timeframeDays === 7 ? intervalOptions.filter((option) => option.value !== 'week') : intervalOptions),
    [timeframeDays]
  );

  useEffect(() => {
    let mounted = true;

    async function loadHistogram() {
      if (!hasLoadedOnceRef.current) setLoading(true);
      else setIsUpdating(true);

      setError('');

      try {
        const window = getWindowForTimeframe(timeframeDays);
        const searchJql = buildSearchJql(appliedJql);
        const historicalWindow = {
          start: shiftDateByYears(window.start, -1),
          end: shiftDateByYears(window.end, -1),
        };
        const staticTimelineJql = buildStaticTimelineJql(searchJql, historicalWindow);

        const { issues = [], historicalIssues = [], visibleIssues = [], namesMap = {} } = await invoke('loadGadgetData', {
          searchJql,
          historicalJql: staticTimelineJql,
          windowStart: formatHistoricalJqlDate(window.start),
          windowEnd: formatHistoricalJqlDate(window.end),
        });

        const histogram = toTimeHistogram(issues, interval, window);
        const historical = buildHistoricalHistogramFromPreviousYear(historicalIssues, interval, window);
        const m1Trend = toM1EmaSeries(histogram, timeframeDays, interval);
        const visibleRows = toVisibleIssuesWithNames(visibleIssues, window, namesMap);
        const visibleTotal = histogram.reduce((sum, bucket) => sum + bucket.tickets, 0);
        const kpis = computeKpis(visibleRows, window, m1Trend.latest);
        const historicalTotal = historical.histogram.reduce((sum, bucket) => sum + Number(bucket.tickets ?? 0), 0);

        const result = {
          total: visibleTotal,
          histogram,
          historicalHistogram: historical.histogram,
          historicalIssueCount: historicalIssues.length,
          historicalTotal,
          staticTimelineJql,
          m1Trend,
          tickets: visibleRows,
          kpis,
        };

        if (!mounted) return;
        setData(result);
      } catch (e) {
        if (!mounted) return;
        setError(e?.message ?? 'Unexpected error while loading gadget data.');
        setData(null);
      } finally {
        if (mounted && !hasLoadedOnceRef.current) {
          setLoading(false);
          hasLoadedOnceRef.current = true;
        }

        if (mounted) {
          setIsUpdating(false);
        }
      }
    }

    loadHistogram();
    return () => {
      mounted = false;
    };
  }, [timeframeDays, interval, appliedJql]);

  const totalTickets = data?.tickets?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalTickets / rowsPerPage));
  const safePage = Math.min(tablePage, totalPages);
  const pageStart = (safePage - 1) * rowsPerPage;
  const pageEnd = pageStart + rowsPerPage;
  const pagedTickets = (data?.tickets ?? []).slice(pageStart, pageEnd);

  useEffect(() => {
    setTablePage(1);
  }, [appliedJql, timeframeDays, interval]);

  useEffect(() => {
    if (tablePage > totalPages) {
      setTablePage(totalPages);
    }
  }, [tablePage, totalPages]);

  if (loading) {
    return <div className="shell">Loading ticket data from Jira...</div>;
  }

  if (error) {
    return (
      <div className="shell">
        <div className="error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="panel">
        <div className="row">
          <div className="block grow jql-block">
            <label htmlFor="static-jql-filter">Static Timeline [JQL]</label>
            <textarea
              id="static-jql-filter"
              value={STATIC_TIMELINE_JQL}
              readOnly
              disabled={isUpdating}
            />
            <div className="small">Gray bars show the same timeframe from one year earlier.</div>
            <div className="small">Historical query rows: {data?.historicalIssueCount ?? 0}, total gray tickets: {Math.round(data?.historicalTotal ?? 0)}</div>
          </div>
        </div>

        <div className="row">
          <div className="block grow jql-block">
            <label htmlFor="jql-filter">Adjustable Timeline [JQL]</label>
            <textarea
              id="jql-filter"
              value={jqlInput}
              placeholder={DEFAULT_JQL}
              onChange={(event) => setJqlInput(event.target.value)}
              disabled={isUpdating}
            />
            <div>
              <button disabled={isUpdating} onClick={() => setAppliedJql(jqlInput)}>
                Apply
              </button>
            </div>
          </div>
        </div>

        <div className="row">
          <div className="block">
            <label htmlFor="timeline">Timeline</label>
            <select
              id="timeline"
              value={timeframeDays}
              disabled={isUpdating}
              onChange={(event) => {
                const nextDays = Number(event.target.value);
                setTimeframeDays(nextDays);
                if (nextDays === 7 && interval === 'week') setInterval('day');
              }}
            >
              {timeframeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="block">
            <label htmlFor="bucket">Bar-size</label>
            <select id="bucket" value={interval} disabled={isUpdating} onChange={(event) => setInterval(event.target.value)}>
              {availableIntervalOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="meta">Total issues: {data?.total ?? 0}</div>
      </div>

      <div className="panel">
        {data?.histogram?.length ? (
          <ChartPanel histogram={data.histogram} historicalHistogram={data.historicalHistogram} m1Trend={data.m1Trend} interval={interval} />
        ) : (
          <div className="small">No issues were found for the selected timeframe and bucket settings.</div>
        )}
      </div>

      <div className="panel">
        <div className="meta"><strong>KPI Summary</strong></div>
        <div className="cards">
          <div className="card"><div className="title">M1</div><div className="value danger">{data?.kpis?.m1 ?? 'N/A'}</div></div>
          <div className="card"><div className="title">M2</div><div className="value">{data?.kpis?.m2 ?? 0}</div></div>
          <div className="card"><div className="title">Tickets / Day</div><div className="value">{data?.kpis?.ticketsPerDay ?? '0.00'}</div></div>
          <div className="card"><div className="title">Avg 08:00-17:00</div><div className="value">{data?.kpis?.avg8to17 ?? '0.00'}</div></div>
          <div className="card"><div className="title">Avg 17:00-22:00</div><div className="value">{data?.kpis?.avg17to22 ?? '0.00'}</div></div>
          <div className="card"><div className="title">Avg 22:00-06:00</div><div className="value">{data?.kpis?.avg22to6 ?? '0.00'}</div></div>
          <div className="card"><div className="title">Avg 06:00-08:00</div><div className="value">{data?.kpis?.avg6to8 ?? '0.00'}</div></div>
          <div className="card"><div className="title">Bank holidays</div><div className="value">{data?.kpis?.bankHolidays ?? 0}</div></div>
        </div>
      </div>

      <div className="panel">
        <div className="meta"><strong>Tickets Table</strong></div>
        <div className="row table-pager-row">
          <div className="small">
            Showing {totalTickets ? pageStart + 1 : 0}-{Math.min(pageEnd, totalTickets)} of {totalTickets}
          </div>
          <div className="pager-actions">
            <button disabled={safePage <= 1} onClick={() => setTablePage((prev) => Math.max(1, prev - 1))}>Previous 10</button>
            <span className="small">Page {safePage} / {totalPages}</span>
            <button disabled={safePage >= totalPages} onClick={() => setTablePage((prev) => Math.min(totalPages, prev + 1))}>Next 10</button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Project</th>
                <th>Impact</th>
                <th>Assignee</th>
                <th>Summary</th>
                <th>Organization</th>
                <th>Reaktionszeit</th>
                <th>Created (Berlin)</th>
                <th>Updated (Berlin)</th>
              </tr>
            </thead>
            <tbody>
              {pagedTickets.length ? (
                pagedTickets.map((ticket) => (
                  <tr key={ticket.key}>
                    <td><a href={`/browse/${ticket.key}`} target="_blank" rel="noreferrer">{ticket.key}</a></td>
                    <td>{ticket.project}</td>
                    <td>{ticket.impact}</td>
                    <td>{ticket.assignee}</td>
                    <td>{ticket.summary}</td>
                    <td>{ticket.organization}</td>
                    <td>{ticket.reactionTime}</td>
                    <td>{ticket.createdDisplay}</td>
                    <td>{ticket.updatedDisplay}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="small">No tickets for the current foreground filter and timeline.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('app')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
