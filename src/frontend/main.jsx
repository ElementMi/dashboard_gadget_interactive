/*
  ===========================
  JQL statement full
  ===========================
project = SUP
AND "impact (migrated 2)[dropdown]" IN ("Systemstillstand (hoch) / System downtime (high)", "Schwere Störung (hoch) / Severe disruption (high)")
AND summary ~ "Sprachnachricht von"

ORDER BY created DESC, "impact (migrated 2)[dropdown]" ASC
AND created >= "2026-07-06 08:00"
AND created < "2026-07-13 08:00"

===========================
  JQL statement without summary
 ===========================
AND created >= "2026-07-06 08:00"
AND created < "2026-07-13 08:00"

===========================
  JQL statement monthly
 ===========================
AND created >= -30d

===========================
  Gadget description
 ===========================
monthly, filters from first monday 8am to next possible monday 8am. 
weekly, filters from first monday 8am to next possible monday 8am. 
foreground and table, filters the user statement
background displays average example of previous year
*/

import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  BarChart,
  Button,
  Box,
  DynamicTable,
  EmptyState,
  Heading,
  Inline,
  Label,
  LineChart,
  Link,
  Select,
  Spinner,
  TextArea,
  Text,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const chartWrapperStyles = xcss({
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'border.radius',
  padding: 'space.200',
});

const overlayHostStyles = xcss({
  position: 'relative',
});

const overlayLineStyles = xcss({
  position: 'absolute',
  insetBlockStart: 'space.0',
  insetInlineStart: 'space.0',
  width: '100%',
});

const gadgetShellStyles = xcss({
  borderRadius: 'border.radius',
  padding: 'space.150',
});

const controlRowStyles = xcss({
  alignItems: 'end',
});

const jqlBoxStyles = xcss({
  width: '100%',
});

const applyBoxStyles = xcss({
  marginBlockStart: 'space.100',
});

const secondaryFilterStyles = xcss({
  marginBlockEnd: 'space.100',
});

const kpiCardStyles = xcss({
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'border.radius',
  padding: 'space.100',
  minWidth: '190px',
});

const m1ValueStyles = xcss({
  color: 'color.text.danger',
});

// Avoid filtering for impact (migrated 2)[dropdown] because ooO - Service might forget setting the Impact/Priority.
const DEFAULT_JQL = 'project = SUP AND summary ~ "Sprachnachricht von" ORDER BY created DESC, "impact (migrated 2)[dropdown]" ASC';

const timeframeOptions = [
  { label: 'Last 7 days', value: '7' },
  { label: 'Last 30 days', value: '30' },
];

const intervalOptions = [
  { label: 'Hourly', value: 'hour' },
  { label: 'Daily', value: 'day' },
  { label: 'Weekly', value: 'week' },
];

const BERLIN_TIMEZONE = 'Europe/Berlin';
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const BANK_HOLIDAYS = new Set([
  '01.01',
  '06.01',
  '03.04',
  '06.04',
  '01.05',
  '14.05',
  '25.05',
  '04.06',
  '03.10',
  '01.11',
  '25.12',
  '26.12',
]);

const weekdayMap = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

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
  if (interval === 'week') {
    return 7 * MS_PER_DAY;
  }

  if (interval === 'day') {
    return MS_PER_DAY;
  }

  return MS_PER_HOUR;
}

function formatBucketLabel(date, interval) {
  if (interval === 'hour') {
    return `${dateOnlyFormatter.format(date)} ${hourOnlyFormatter.format(date)}`;
  }

  if (interval === 'day') {
    return dateOnlyFormatter.format(date);
  }

  return `Wk ${dateOnlyFormatter.format(date)}`;
}

function toTimeHistogram(issues, interval, window) {
  const stepMs = getBucketStepMs(interval);
  const rawStartMs = window.start.getTime();
  const rawEndMs = window.end.getTime();

  // Hourly charts should only ever show full-hour bars (08:00, 09:00, ...).
  const startMs = interval === 'hour'
    ? Math.floor(rawStartMs / MS_PER_HOUR) * MS_PER_HOUR
    : rawStartMs;
  const endMs = interval === 'hour'
    ? Math.ceil(rawEndMs / MS_PER_HOUR) * MS_PER_HOUR
    : rawEndMs;
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
    if (!created) {
      continue;
    }

    const createdDate = new Date(created);
    if (Number.isNaN(createdDate.getTime())) {
      continue;
    }

    if (createdDate < window.start || createdDate >= window.end) {
      continue;
    }

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

function getM1SmaLength(timeframeDays, interval) {
  if (timeframeDays !== 30) {
    return 0;
  }

  if (interval === 'day') {
    return 7;
  }

  if (interval === 'hour') {
    return 24;
  }

  if (interval === 'week') {
    return 1;
  }

  return 0;
}

function toM1SmaSeries(histogram, timeframeDays, interval) {
  const length = getM1SmaLength(timeframeDays, interval);
  if (!length) {
    return {
      length: 0,
      data: [],
      trendChartData: [],
      latest: null,
    };
  }

  let rollingSum = 0;
  const points = [];

  for (let i = 0; i < (histogram?.length ?? 0); i += 1) {
    const current = histogram[i];
    // Histogram has one value per bucket, so HL/2 proxy is the bucket value itself.
    const hl2 = Number(current?.tickets ?? 0);
    rollingSum += hl2;

    if (i >= length) {
      rollingSum -= Number(histogram[i - length]?.tickets ?? 0);
    }

    const sma = i >= length - 1 ? rollingSum / length : null;

    points.push({
      xKey: current?.xKey ?? `${i}`,
      period: current?.period ?? `${i}`,
      m1: sma,
      series: 'M1 SMA (HL/2)',
    });
  }

  const latestPoint = [...points].reverse().find((point) => Number.isFinite(point.m1));

  const trendChartData = [];
  for (const point of points) {
    trendChartData.push({
      xKey: point.xKey,
      period: point.period,
      value: Number(histogram.find((bin) => bin.xKey === point.xKey)?.tickets ?? 0),
      series: 'Tickets',
    });

    if (Number.isFinite(point.m1)) {
      trendChartData.push({
        xKey: point.xKey,
        period: point.period,
        value: point.m1,
        series: 'M1 SMA (HL/2)',
      });
    }
  }

  return {
    length,
    data: points.filter((point) => Number.isFinite(point.m1)),
    trendChartData,
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

function toNamesMapFromFields(fieldDefinitions) {
  const namesMap = {};
  for (const field of fieldDefinitions ?? []) {
    if (field?.id && field?.name) {
      namesMap[field.id] = field.name;
    }
  }
  return namesMap;
}

function getFieldByNames(fields, namesMap, candidateNames) {
  const directMatch = candidateNames.find((name) => fields?.[name] !== undefined);
  if (directMatch) {
    return fields[directMatch];
  }

  const fieldId = findFieldIdByDisplayName(namesMap, candidateNames);
  if (fieldId && fields?.[fieldId] !== undefined) {
    return fields[fieldId];
  }

  return null;
}

function toDisplayValue(value) {
  if (value == null) {
    return '-';
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (!value.length) {
      return '-';
    }
    return value
      .map((item) => {
        if (item == null) {
          return '';
        }
        if (typeof item === 'string') {
          return item;
        }
        if (typeof item === 'object') {
          return item.displayName ?? item.name ?? item.value ?? JSON.stringify(item);
        }
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
    if (!created) {
      continue;
    }

    const createdDate = new Date(created);
    if (Number.isNaN(createdDate.getTime())) {
      continue;
    }

    if (createdDate < window.start || createdDate >= window.end) {
      continue;
    }

    const fields = issue?.fields ?? {};
    const impactValue = getFieldByNames(fields, namesMap, [
      'impact (migrated 2)[dropdown]',
      'Impact (migrated 2)[dropdown]',
      'impact',
      'Impact',
    ]);
    const organizationValue = getFieldByNames(fields, namesMap, [
      'organization',
      'Organisation',
      'Organizations',
      'Organisationen',
    ]);
    const reactionValue = getFieldByNames(fields, namesMap, [
      'Reaktionszeit',
      'Reaktionzeit',
      'Reaktionszeit (SLA)',
      'Time to first response',
      'First response time',
    ]);

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
    if (Number.isNaN(createdDate.getTime())) {
      continue;
    }

    const berlinParts = getTzParts(createdDate, BERLIN_TIMEZONE);
    const hour = berlinParts.hour;

    if (hour >= 8 && hour < 17) {
      band8to17 += 1;
    } else if (hour >= 17 && hour < 22) {
      band17to22 += 1;
    } else if (hour >= 22 || hour < 6) {
      band22to6 += 1;
    } else {
      band6to8 += 1;
    }

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

function getSelectValue(options, value) {
  return options.find((option) => option.value === String(value)) ?? null;
}

function App() {
  const [timeframeDays, setTimeframeDays] = useState(30);
  const [secondaryJqlInput, setSecondaryJqlInput] = useState('');
  const [jqlInput, setJqlInput] = useState('');
  const [appliedJql, setAppliedJql] = useState(DEFAULT_JQL);
  const [interval, setInterval] = useState('day');
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function loadHistogram() {
      if (!hasLoadedOnce) {
        setLoading(true);
      } else {
        setIsUpdating(true);
      }
      setError('');

      try {
        const window = getWindowForTimeframe(timeframeDays);
        const searchJql = buildSearchJql(appliedJql);

        const { issues = [], namesMap = {} } = await invoke('loadGadgetData', {
          searchJql,
        });

        const histogram = toTimeHistogram(issues, interval, window);
        const m1Sma = timeframeDays === 30
          ? toM1SmaSeries(histogram, timeframeDays, interval)
          : { length: 0, data: [], trendChartData: [], latest: null };
        const visibleIssues = toVisibleIssuesWithNames(issues, window, namesMap);
        const visibleTotal = histogram.reduce((sum, bucket) => sum + bucket.tickets, 0);
        const kpis = computeKpis(visibleIssues, window, timeframeDays === 30 ? m1Sma.latest : null);

        const result = {
          total: visibleTotal,
          histogram,
          m1Sma,
          tickets: visibleIssues,
          kpis,
        };

        if (!mounted) {
          return;
        }

        setData(result);
      } catch (e) {
        if (!mounted) {
          return;
        }

        setError(e?.message ?? 'Unexpected error while loading gadget data.');
        setData(null);
      } finally {
        if (mounted && !hasLoadedOnce) {
          setLoading(false);
          setHasLoadedOnce(true);
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
  }, [timeframeDays, interval, appliedJql, hasLoadedOnce]);

  if (loading) {
    return (
      <>
        <Spinner label="Loading gadget data" />
        <Text>Loading ticket data from Jira...</Text>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Text>{`Error: ${error}`}</Text>
      </>
    );
  }

  return (
    <Box xcss={gadgetShellStyles}>
      <Box xcss={secondaryFilterStyles}>
        <Label labelFor="secondary-jql-filter">Secondary JQL filter (inactive)</Label>
        <TextArea
          id="secondary-jql-filter"
          name="secondary-jql-filter"
          value={secondaryJqlInput}
          placeholder="This field is currently not applied."
          resize="smart"
          onChange={(event) => setSecondaryJqlInput(event?.target?.value ?? '')}
        />
      </Box>
      <Inline alignBlock="start" space="space.100" shouldWrap xcss={controlRowStyles}>
        <Box xcss={jqlBoxStyles}>
          <Label labelFor="jql-filter">Foreground JQL filter</Label>
          <TextArea
            id="jql-filter"
            name="jql-filter"
            value={jqlInput}
            placeholder={DEFAULT_JQL}
            resize="smart"
            isDisabled={isUpdating}
            onChange={(event) => setJqlInput(event?.target?.value ?? '')}
          />
          <Box xcss={applyBoxStyles}>
            <Button appearance="primary" isDisabled={isUpdating} onClick={() => setAppliedJql(jqlInput)}>
              Apply
            </Button>
          </Box>
        </Box>
      </Inline>
      <Inline alignBlock="start" space="space.200" shouldWrap>
        <Box>
          <Label labelFor="timeframe-select">Timeline</Label>
          <Select
            inputId="timeframe-select"
            options={timeframeOptions}
            value={getSelectValue(timeframeOptions, String(timeframeDays))}
            isDisabled={isUpdating}
            onChange={(option) => {
              const nextDays = Number(option?.value ?? 30);
              setTimeframeDays(nextDays);
              if (nextDays === 7) {
                setInterval('day');
              }
            }}
          />
        </Box>
        <Box>
          <Label labelFor="interval-select">Bucket size</Label>
          <Select
            inputId="interval-select"
            options={intervalOptions}
            value={getSelectValue(intervalOptions, interval)}
            isDisabled={isUpdating}
            onChange={(option) => setInterval(option?.value ?? 'hour')}
          />
        </Box>
      </Inline>
      {timeframeDays === 7 ? (
        <Text>Window: Monday 08:00 to next Monday 08:00 (Europe/Berlin)</Text>
      ) : (
        <Text>Window: rolling 30 days until now</Text>
      )}
      {appliedJql ? <Text>{`Active JQL filter: ${appliedJql}`}</Text> : <Text>Active JQL filter: none</Text>}
      <Text>{`Total issues: ${data?.total ?? 0}`}</Text>
      <Box xcss={chartWrapperStyles}>
        {isUpdating ? (
          <Inline alignBlock="center" space="space.100">
            <Spinner size="small" label="Updating chart" />
            <Text>Updating chart...</Text>
          </Inline>
        ) : null}
        {timeframeDays === 30 ? <Text>{`M1 SMA active (length ${data?.m1Sma?.length ?? 0})`}</Text> : null}
        {data?.histogram?.length ? (
          <Box xcss={overlayHostStyles}>
            <BarChart
              title="Tickets over time"
              subtitle={timeframeDays === 30 ? 'Green bars = tickets, red line = M1 SMA (HL/2)' : 'X-axis: time, Y-axis: number of tickets'}
              data={data.histogram}
              xAccessor="period"
              yAccessor="tickets"
              colorAccessor="series"
              colorPalette={['#A8E6CF']}
              height={interval === 'hour' ? 220 : 340}
              showBorder
            />
            {timeframeDays === 30 && data?.m1Sma?.data?.length ? (
              <Box xcss={overlayLineStyles}>
                <LineChart
                  data={data.m1Sma.data}
                  xAccessor="period"
                  yAccessor="m1"
                  colorAccessor="series"
                  colorPalette={[{ key: 'M1 SMA (HL/2)', value: '#D14343' }]}
                  height={interval === 'hour' ? 220 : 340}
                  showBorder={false}
                />
              </Box>
            ) : null}
          </Box>
        ) : (
          <EmptyState
            header="No ticket data"
            description="No issues were found for the selected timeframe and bucket settings."
          />
        )}
      </Box>
      <Box xcss={chartWrapperStyles}>
        <Heading size="xsmall">KPI Summary</Heading>
        <Inline alignBlock="start" space="space.100" shouldWrap>
          <Box xcss={kpiCardStyles}>
            <Text weight="medium">M1</Text>
            <Text xcss={m1ValueStyles}>{`${data?.kpis?.m1 ?? 'N/A'}`}</Text>
          </Box>
          <Box xcss={kpiCardStyles}>
            <Text weight="medium">M2</Text>
            <Text>{`${data?.kpis?.m2 ?? 0}`}</Text>
          </Box>
          <Box xcss={kpiCardStyles}>
            <Text weight="medium">Tickets / Day</Text>
            <Text>{`${data?.kpis?.ticketsPerDay ?? '0.00'}`}</Text>
          </Box>
          <Box xcss={kpiCardStyles}>
            <Text weight="medium">Avg 08:00-17:00</Text>
            <Text>{`${data?.kpis?.avg8to17 ?? '0.00'}`}</Text>
          </Box>
          <Box xcss={kpiCardStyles}>
            <Text weight="medium">Avg 17:00-22:00</Text>
            <Text>{`${data?.kpis?.avg17to22 ?? '0.00'}`}</Text>
          </Box>
          <Box xcss={kpiCardStyles}>
            <Text weight="medium">Avg 22:00-06:00</Text>
            <Text>{`${data?.kpis?.avg22to6 ?? '0.00'}`}</Text>
          </Box>
          <Box xcss={kpiCardStyles}>
            <Text weight="medium">Avg 06:00-08:00</Text>
            <Text>{`${data?.kpis?.avg6to8 ?? '0.00'}`}</Text>
          </Box>
          <Box xcss={kpiCardStyles}>
            <Text weight="medium">Bank holidays</Text>
            <Text>{`${data?.kpis?.bankHolidays ?? 0}`}</Text>
          </Box>
        </Inline>
      </Box>
      <Box xcss={chartWrapperStyles}>
        <Heading size="xsmall">Tickets Table</Heading>
        <DynamicTable
          head={{
            cells: [
              { key: 'key', content: 'Key' },
              { key: 'project', content: 'Project' },
              { key: 'impact', content: 'Impact' },
              { key: 'assignee', content: 'Assignee' },
              { key: 'summary', content: 'Summary' },
              { key: 'organization', content: 'Organization' },
              { key: 'reaction', content: 'Reaktionszeit' },
              { key: 'created', content: 'Created (Berlin)' },
              { key: 'updated', content: 'Updated (Berlin)' },
            ],
          }}
          rows={(data?.tickets ?? []).map((ticket) => ({
            key: ticket.key,
            cells: [
              {
                key: `k-${ticket.key}`,
                content: <Link href={`/browse/${ticket.key}`}>{ticket.key}</Link>,
              },
              { key: `p-${ticket.key}`, content: ticket.project },
              { key: `i-${ticket.key}`, content: ticket.impact },
              { key: `a-${ticket.key}`, content: ticket.assignee },
              { key: `s-${ticket.key}`, content: ticket.summary },
              { key: `o-${ticket.key}`, content: ticket.organization },
              { key: `r-${ticket.key}`, content: ticket.reactionTime },
              { key: `c-${ticket.key}`, content: ticket.createdDisplay },
              { key: `u-${ticket.key}`, content: ticket.updatedDisplay },
            ],
          }))}
          rowsPerPage={10}
          defaultPage={1}
          isLoading={isUpdating}
          emptyView="No tickets for the current foreground filter and timeline."
        />
      </Box>
    </Box>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
