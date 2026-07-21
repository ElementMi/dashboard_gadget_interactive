import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as echarts from 'echarts';
import { invoke } from '@forge/bridge';

const DEFAULT_JQL = 'project = SUP AND summary ~ "Sprachnachricht von" ORDER BY created DESC, "impact (migrated 2)[dropdown]" ASC';
const STATIC_TIMELINE_JQL = 'project = SUP AND summary ~ "Sprachnachricht von" ORDER BY created DESC, "impact (migrated 2)[dropdown]" ASC';

const timeframeOptions = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 28 days', value: 28 },
];

const intervalOptions = [
  { label: 'Hourly', value: 'hour' },
  { label: 'Daily', value: 'day' },
  { label: 'Weekly', value: 'week' },
];

const IMPACT_FIELD_NAMES = ['impact (migrated 2)[dropdown]', 'Impact (migrated 2)[dropdown]', 'impact', 'Impact'];
const ORGANIZATION_FIELD_NAMES = ['organization', 'Organisation', 'Organizations', 'Organisationen'];

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

function getBerlinFourWeekWindow(now = new Date()) {
  const weekWindow = getBerlinWeekWindow(now);

  return {
    start: new Date(weekWindow.start.getTime() - 21 * MS_PER_DAY),
    end: weekWindow.end,
  };
}

function getWindowForTimeframe(timeframeDays) {
  if (timeframeDays === 7) {
    return getBerlinWeekWindow();
  }

  if (timeframeDays === 28) {
    return getBerlinFourWeekWindow();
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
  if (timeframeDays === 28) {
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

function toM1EmaSeries(histogram, timeframeDays, interval, source = 'hl2') {
  const length = getM1TrendLength(timeframeDays, interval);
  if (!length) return { length: 0, data: [], latest: null };

  // Seed EMA with the first full-window average, then apply standard EMA recurrence.
  const alpha = 2 / (length + 1);
  let rollingSum = 0;
  let emaValue = null;
  const points = [];

  for (let i = 0; i < (histogram?.length ?? 0); i += 1) {
    const current = histogram[i];
    const currentTickets = Number(current?.tickets ?? 0);
    const currentValue = source === 'close' ? currentTickets : currentTickets / 2;
    rollingSum += currentValue;

    if (i >= length) {
      const previousTickets = Number(histogram[i - length]?.tickets ?? 0);
      const previousValue = source === 'close' ? previousTickets : previousTickets / 2;
      rollingSum -= previousValue;
    }

    if (i === length - 1) {
      emaValue = rollingSum / length;
    } else if (i >= length) {
      emaValue = currentValue * alpha + emaValue * (1 - alpha);
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

function buildEmaLegendLabel(interval, length) {
  if (!length) {
    return 'EMA (HL/2)';
  }

  const unit = interval === 'hour'
    ? (length === 1 ? 'Hour' : 'Hours')
    : interval === 'day'
      ? (length === 1 ? 'Day' : 'Days')
      : (length === 1 ? 'Week' : 'Weeks');

  return `EMA ${length}${unit} (HL/2)`;
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

function formatDeltaFromMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '-';

  const totalMinutes = Math.floor(ms / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
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
    const updatedDate = fields?.updated ? new Date(fields.updated) : null;
    const closedDate = fields?.resolutiondate ? new Date(fields.resolutiondate) : null;
    const hasValidUpdated = updatedDate instanceof Date && !Number.isNaN(updatedDate.getTime());
    const hasValidClosed = closedDate instanceof Date && !Number.isNaN(closedDate.getTime());
    const deltaMs = hasValidClosed ? closedDate.getTime() - createdDate.getTime() : NaN;

    visible.push({
      key: issue.key,
      project: fields?.project?.key ?? '-',
      impact: toDisplayValue(impactValue),
      assignee: fields?.assignee?.displayName ?? 'Unassigned',
      summary: fields?.summary ?? '(no summary)',
      organization: toDisplayValue(organizationValue),
      createdDisplay: createdTableFormatter.format(createdDate),
      deltaDisplay: formatDeltaFromMs(deltaMs),
      createdRaw: createdDate.toISOString(),
      updatedDisplay: hasValidUpdated ? createdTableFormatter.format(updatedDate) : '-',
      closedDisplay: hasValidClosed ? createdTableFormatter.format(closedDate) : '-',
    });
  }

  return visible;
}

function formatKpi(value) {
  return Number.isFinite(value) ? (Math.ceil(value * 100) / 100).toFixed(2) : '0.00';
}

function formatKpiOneDecimal(value) {
  return Number.isFinite(value) ? (Math.ceil(value * 10) / 10).toFixed(1) : '0.0';
}

function getWeeklyDailyAvgClass(value, timeframeDays, interval) {
  if (!Number.isFinite(value) || timeframeDays !== 28 || interval !== 'day') {
    return '';
  }

  if (value < 1.9) return 'kpi-dark-green';
  if (value >= 2.0 && value <= 3.4) return 'kpi-dark-yellow';
  if (value >= 3.5) return 'kpi-negative';
  return '';
}

function getRegularAvgClass(value, timeframeDays) {
  if (!Number.isFinite(value)) {
    return '';
  }

  if (timeframeDays === 28) {
    if (value <= 0.2) return 'kpi-green';
    if (value > 0.2 && value <= 0.4) return 'kpi-dark-green';
    if (value > 0.4) return 'kpi-negative';
    return '';
  }

  if (timeframeDays === 7) {
    if (value <= 1.0) return 'kpi-dark-green';
    if (value > 1.0 && value <= 2.4) return 'kpi-dark-yellow';
    if (value > 2.5) return 'kpi-negative';
    return '';
  }

  return '';
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function getWindowDayStats(window) {
  const startLocal = getTzParts(window.start, BERLIN_TIMEZONE);
  const endLocal = getTzParts(new Date(window.end.getTime() - 1), BERLIN_TIMEZONE);

  let cursorUtc = Date.UTC(startLocal.year, startLocal.month - 1, startLocal.day);
  const endUtc = Date.UTC(endLocal.year, endLocal.month - 1, endLocal.day);
  let totalDays = 0;
  let weekdayExcludingHolidays = 0;
  let bankHolidays = 0;

  while (cursorUtc <= endUtc) {
    const cursorDate = new Date(cursorUtc);
    const key = `${pad2(cursorDate.getUTCDate())}.${pad2(cursorDate.getUTCMonth() + 1)}`;
    const isHoliday = BANK_HOLIDAYS.has(key);
    const weekday = cursorDate.getUTCDay();
    const isWeekday = weekday >= 1 && weekday <= 5;

    totalDays += 1;
    if (isHoliday) bankHolidays += 1;
    if (isWeekday && !isHoliday) {
      weekdayExcludingHolidays += 1;
    }

    cursorUtc += MS_PER_DAY;
  }

  return {
    totalDays,
    weekdayExcludingHolidays,
    bankHolidays,
  };
}

function getElapsedWindowForAverages(window, now = new Date()) {
  const berlinNow = getTzParts(now, BERLIN_TIMEZONE);
  const berlinTodayStart = zonedDateTimeToUtcDate(
    {
      year: berlinNow.year,
      month: berlinNow.month,
      day: berlinNow.day,
      hour: 0,
      minute: 0,
      second: 0,
    },
    BERLIN_TIMEZONE
  );

  const end = new Date(Math.min(window.end.getTime(), berlinTodayStart.getTime()));
  if (end <= window.start) {
    return { start: window.start, end: window.start };
  }

  return {
    start: window.start,
    end,
  };
}

function getAverageDenominatorWindow(window, timeframeDays) {
  if (timeframeDays === 7) {
    return getElapsedWindowForAverages(window);
  }

  if (timeframeDays === 28) {
    return getElapsedWindowForAverages(window);
  }

  return window;
}

function computeKpis(tickets, window, historicalTotal, emaTicketsPerDayValue, timeframeDays) {
  const fullDayStats = getWindowDayStats(window);
  const denominatorWindow = getAverageDenominatorWindow(window, timeframeDays);
  const denominatorStats = getWindowDayStats(denominatorWindow);
  const allDays = Math.max(1, denominatorStats.totalDays);
  const businessDaysExcludingHolidays = Math.max(1, denominatorStats.weekdayExcludingHolidays);
  const total = tickets?.length ?? 0;
  const avgPerDay = total / allDays;
  const historicalAvgPerDay = Number(historicalTotal ?? 0) / allDays;

  let band8to17 = 0;
  let band17to22 = 0;
  let band22to6 = 0;
  let band6to8 = 0;

  for (const ticket of tickets ?? []) {
    const createdDate = new Date(ticket.createdRaw);
    if (Number.isNaN(createdDate.getTime())) continue;

    // For elapsed-window views, ignore tickets created on days that are not completed yet.
    if (createdDate < denominatorWindow.start || createdDate >= denominatorWindow.end) continue;

    const berlinParts = getTzParts(createdDate, BERLIN_TIMEZONE);
    const hour = berlinParts.hour;
    const weekday = weekdayMap[berlinParts.weekday] ?? 0;
    const isWeekday = weekday >= 1 && weekday <= 5;
    const dayMonthKey = `${pad2(berlinParts.day)}.${pad2(berlinParts.month)}`;
    const isHoliday = BANK_HOLIDAYS.has(dayMonthKey);

    if (hour >= 8 && hour < 17) {
      // Business-hours KPI excludes weekends and holidays in both numerator and denominator.
      if (isWeekday && !isHoliday) {
        band8to17 += 1;
      }
    }
    else if (hour >= 17 && hour < 22) band17to22 += 1;
    else if (hour >= 22 || hour < 6) band22to6 += 1;
    else band6to8 += 1;

  }

  return {
    m1: avgPerDay,
    m2: historicalAvgPerDay,
    bankHolidays: fullDayStats.bankHolidays,
    ticketsPerDay: Number.isFinite(emaTicketsPerDayValue) ? emaTicketsPerDayValue : null,
    avg8to17: band8to17 / businessDaysExcludingHolidays,
    avg17to22: band17to22 / allDays,
    avg22to6: band22to6 / allDays,
    avg6to8: band6to8 / allDays,
    avg8to17Weekly: (band8to17 / businessDaysExcludingHolidays) * 5,
    avg17to22Weekly: (band17to22 / allDays) * 7,
    avg22to6Weekly: (band22to6 / allDays) * 7,
    avg6to8Weekly: (band6to8 / allDays) * 7,
  };
}

function ChartPanel({ histogram, historicalHistogram, m1Trend, interval, emaLegendLabel }) {
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
        subtext: 'red line = adaptive moving average/ green bar diagram = tickets of timeline chosen/ gray bar diagram = tickets same time last year.\n',
        textStyle: { fontSize: 13, fontWeight: 700, color: '#5e6c84' },
        subtextStyle: { fontSize: 12, color: '#42526e' },
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
          name: 'Tickets (last year)',
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
          name: emaLegendLabel,
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
        data: [emaLegendLabel, 'Tickets', 'Tickets (last year)'],
        bottom: 0,
      },
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [histogram, historicalHistogram, m1Trend, interval, emaLegendLabel]);

  return <div ref={containerRef} className="chart" />;
}

function App() {
  const [timeframeDays, setTimeframeDays] = useState(28);
  const [jqlInput, setJqlInput] = useState(DEFAULT_JQL);
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
        const m1Trend = toM1EmaSeries(histogram, timeframeDays, interval, 'hl2');
        const emaCloseTrend = toM1EmaSeries(histogram, timeframeDays, interval, 'close');
        const visibleRows = toVisibleIssuesWithNames(visibleIssues, window, namesMap);
        const visibleTotal = histogram.reduce((sum, bucket) => sum + bucket.tickets, 0);
        const historicalTotal = historical.histogram.reduce((sum, bucket) => sum + Number(bucket.tickets ?? 0), 0);
        const kpis = computeKpis(visibleRows, window, historicalTotal, emaCloseTrend.latest, timeframeDays);

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
  const emaLegendLabel = buildEmaLegendLabel(interval, data?.m1Trend?.length ?? 0);
  const emaMetricLabel = emaLegendLabel
    .replace(/^EMA\s*/i, '')
    .replace(/\s*\(HL\/2\)\s*/i, '');
  const avgWindowSuffix = timeframeDays === 7 ? '[max 7 days completed]' : '[max 28 days completed]';
  const avg8to17WeeklyNumber = Number.isFinite(data?.kpis?.avg8to17Weekly) ? data.kpis.avg8to17Weekly : null;
  const avg17to22WeeklyNumber = Number.isFinite(data?.kpis?.avg17to22Weekly) ? data.kpis.avg17to22Weekly : null;
  const avg22to6WeeklyNumber = Number.isFinite(data?.kpis?.avg22to6Weekly) ? data.kpis.avg22to6Weekly : null;
  const avg6to8WeeklyNumber = Number.isFinite(data?.kpis?.avg6to8Weekly) ? data.kpis.avg6to8Weekly : null;
  const avg8to17Number = Number.isFinite(data?.kpis?.avg8to17) ? data.kpis.avg8to17 : null;
  const avg17to22Number = Number.isFinite(data?.kpis?.avg17to22) ? data.kpis.avg17to22 : null;
  const avg22to6Number = Number.isFinite(data?.kpis?.avg22to6) ? data.kpis.avg22to6 : null;
  const avg6to8Number = Number.isFinite(data?.kpis?.avg6to8) ? data.kpis.avg6to8 : null;
  const m1Number = Number.isFinite(data?.kpis?.m1) ? data.kpis.m1 : null;
  const m2Number = Number.isFinite(data?.kpis?.m2) ? data.kpis.m2 : null;
  const emaNumber = Number.isFinite(data?.kpis?.ticketsPerDay) ? data.kpis.ticketsPerDay : null;
  const bankHolidayNumber = Number(data?.kpis?.bankHolidays ?? 0);

  const ma1ValueClass =
    m1Number == null || m2Number == null
      ? ''
      : m1Number < m2Number
        ? 'kpi-positive'
        : m1Number > m2Number
          ? 'kpi-negative'
          : '';

  const ma2ValueClass =
    m1Number == null || m2Number == null
      ? ''
      : m2Number > m1Number
        ? 'kpi-negative'
        : 'kpi-positive';

  const emaValueClass =
    emaNumber == null || m1Number == null
      ? ''
      : emaNumber < m1Number
        ? 'kpi-positive'
        : emaNumber > m1Number
          ? 'kpi-negative'
          : '';

  const bankHolidayValueClass = bankHolidayNumber > 0 ? 'kpi-negative' : '';
  const avg8to17WeeklyClass = getWeeklyDailyAvgClass(avg8to17WeeklyNumber, timeframeDays, interval);
  const avg17to22WeeklyClass = getWeeklyDailyAvgClass(avg17to22WeeklyNumber, timeframeDays, interval);
  const avg22to6WeeklyClass = getWeeklyDailyAvgClass(avg22to6WeeklyNumber, timeframeDays, interval);
  const avg6to8WeeklyClass = getWeeklyDailyAvgClass(avg6to8WeeklyNumber, timeframeDays, interval);
  const avg8to17Class = getRegularAvgClass(avg8to17Number, timeframeDays);
  const avg17to22Class = getRegularAvgClass(avg17to22Number, timeframeDays);
  const avg22to6Class = getRegularAvgClass(avg22to6Number, timeframeDays);
  const avg6to8Class = getRegularAvgClass(avg6to8Number, timeframeDays);
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
            />
            <div className="small">Gray bars show the same timeframe from one year earlier. | Historical query rows: {data?.historicalIssueCount ?? 0}, total gray tickets: {Math.round(data?.historicalTotal ?? 0)}</div>
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
              readOnly={isUpdating}
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

        <div className="small">Total issues: {data?.total ?? 0}</div>
      </div>

      <div className="panel">
        {data?.histogram?.length ? (
          <ChartPanel histogram={data.histogram} historicalHistogram={data.historicalHistogram} m1Trend={data.m1Trend} interval={interval} emaLegendLabel={emaLegendLabel} />
        ) : (
          <div className="small">No issues were found for the selected timeframe and bucket settings.</div>
        )}
      </div>

      <div className="panel">
        <div className="meta kpi-heading"><strong>KPI Summary</strong></div>
        <div className="kpi-rows">
          <div className="cards kpi-row">
            <div className="card"><div className="title">MA1 - Tickets / Day (This Year)</div><div className={`value ${ma1ValueClass}`}>{formatKpiOneDecimal(data?.kpis?.m1)}</div></div>
            <div className="card"><div className="title">MA2 - Tickets / Day (Last Year)</div><div className={`value ${ma2ValueClass}`}>{formatKpiOneDecimal(data?.kpis?.m2)}</div></div>
            <div className="card"><div className="title">{`EMA ${emaMetricLabel} - Tickets / Day`}</div><div className={`value ${emaValueClass}`}>{data?.kpis?.ticketsPerDay == null ? 'N/A' : formatKpi(data.kpis.ticketsPerDay)}</div></div>
            <div className="card"><div className="title">Bank holidays</div><div className={`value ${bankHolidayValueClass}`}>{data?.kpis?.bankHolidays ?? 0}</div></div>
          </div>
          {timeframeDays === 28 ? (
            <div className="cards kpi-row">
              <div className="card"><div className="title">Avg Mo - Fri 08:00-17:00 (excl. holidays) [avg/weekly completed days]</div><div className={`value ${avg8to17WeeklyClass}`}>{formatKpiOneDecimal(data?.kpis?.avg8to17Weekly)}</div></div>
              <div className="card"><div className="title">Avg Mo - Sun 17:00-22:00 (incl. holidays) [avg/weekly completed days]</div><div className={`value ${avg17to22WeeklyClass}`}>{formatKpiOneDecimal(data?.kpis?.avg17to22Weekly)}</div></div>
              <div className="card"><div className="title">Avg Mo - Sun 22:00-06:00 (incl. holidays) [avg/weekly completed days]</div><div className={`value ${avg22to6WeeklyClass}`}>{formatKpiOneDecimal(data?.kpis?.avg22to6Weekly)}</div></div>
              <div className="card"><div className="title">Avg Mo - Sun 06:00-08:00 (incl. holidays) [avg/weekly completed days]</div><div className={`value ${avg6to8WeeklyClass}`}>{formatKpiOneDecimal(data?.kpis?.avg6to8Weekly)}</div></div>
            </div>
          ) : null}
          <div className="cards kpi-row">
            <div className="card"><div className="title">{`Avg Mo - Fri 08:00-17:00 (excl. holidays) ${avgWindowSuffix}`}</div><div className={`value ${avg8to17Class}`}>{formatKpiOneDecimal(data?.kpis?.avg8to17)}</div></div>
            <div className="card"><div className="title">{`Avg Mo - Sun 17:00-22:00 (incl. holidays) ${avgWindowSuffix}`}</div><div className={`value ${avg17to22Class}`}>{formatKpiOneDecimal(data?.kpis?.avg17to22)}</div></div>
            <div className="card"><div className="title">{`Avg Mo - Sun 22:00-06:00 (incl. holidays) ${avgWindowSuffix}`}</div><div className={`value ${avg22to6Class}`}>{formatKpiOneDecimal(data?.kpis?.avg22to6)}</div></div>
            <div className="card"><div className="title">{`Avg Mo - Sun 06:00-08:00 (incl. holidays) ${avgWindowSuffix}`}</div><div className={`value ${avg6to8Class}`}>{formatKpiOneDecimal(data?.kpis?.avg6to8)}</div></div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="meta section-heading"><strong>Tickets Table</strong></div>
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
                <th>Created (Berlin)</th>
                <th>Delta</th>
                <th>Updated (Berlin)</th>
                <th>Closed (Berlin)</th>
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
                    <td>{ticket.createdDisplay}</td>
                    <td>{ticket.deltaDisplay}</td>
                    <td>{ticket.updatedDisplay}</td>
                    <td>{ticket.closedDisplay}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="small">No tickets for the current foreground filter and timeline.</td>
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
