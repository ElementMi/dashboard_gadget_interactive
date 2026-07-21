import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();

const IMPACT_FIELD_NAMES = [
  'impact (migrated 2)[dropdown]',
  'Impact (migrated 2)[dropdown]',
  'impact',
  'Impact',
];

const ORGANIZATION_FIELD_NAMES = [
  'organization',
  'Organisation',
  'Organizations',
  'Organisationen',
];

const REACTION_FIELD_NAMES = [
  'Reaktionszeit',
  'Reaktionzeit',
  'Reaktionszeit (SLA)',
  'Time to first response',
  'First response time',
];

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

function stripOrderByClause(jql) {
  return (jql ?? '').replace(/\s+order\s+by\b[\s\S]*$/i, '').trim();
}

function buildWindowScopedJql(searchJql, windowStart, windowEnd) {
  const base = stripOrderByClause(searchJql);
  return `(${base}) AND created >= "${windowStart}" AND created < "${windowEnd}" ORDER BY created DESC`;
}

async function loadAllIssues(searchJql, fieldsToRequest, maxPages = 25) {
  const issues = [];
  const pageSize = 500;
  let nextPageToken = null;
  let safetyCounter = 0;
  const seenTokens = new Set();

  do {
    const requestBody = {
      jql: searchJql,
      maxResults: pageSize,
      fields: fieldsToRequest,
    };

    if (nextPageToken) {
      requestBody.nextPageToken = nextPageToken;
    }

    const searchResponse = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!searchResponse.ok) {
      const searchError = await searchResponse.text();
      throw new Error(`Jira search failed (${searchResponse.status}): ${searchError}`);
    }

    const searchJson = await searchResponse.json();
    const pageIssues = searchJson.issues ?? [];
    issues.push(...pageIssues);

    const candidateToken = searchJson.nextPageToken ?? null;

    // Stop if Jira returns an already-seen token to avoid endless pagination loops.
    if (candidateToken && seenTokens.has(candidateToken)) {
      nextPageToken = null;
    } else {
      nextPageToken = candidateToken;
      if (nextPageToken) {
        seenTokens.add(nextPageToken);
      }
    }

    // No results means there is nothing left to fetch even if a token is present.
    if (!pageIssues.length) {
      nextPageToken = null;
    }

    safetyCounter += 1;
  } while (nextPageToken && safetyCounter < maxPages);

  return issues;
}

resolver.define('loadGadgetData', async ({ payload }) => {
  const searchJql = payload?.searchJql;
  const historicalJql = payload?.historicalJql;
  const windowStart = payload?.windowStart;
  const windowEnd = payload?.windowEnd;

  if (!searchJql) {
    throw new Error('Missing search JQL.');
  }

  const fieldsResponse = await api.asApp().requestJira(route`/rest/api/3/field`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!fieldsResponse.ok) {
    const fieldsError = await fieldsResponse.text();
    throw new Error(`Jira fields lookup failed (${fieldsResponse.status}): ${fieldsError}`);
  }

  const fieldDefinitions = await fieldsResponse.json();
  const namesMap = toNamesMapFromFields(fieldDefinitions);

  const impactFieldId = findFieldIdByDisplayName(namesMap, IMPACT_FIELD_NAMES);
  const organizationFieldId = findFieldIdByDisplayName(namesMap, ORGANIZATION_FIELD_NAMES);
  const reactionFieldId = findFieldIdByDisplayName(namesMap, REACTION_FIELD_NAMES);

  const fieldsToRequest = [
    'created',
    'updated',
    'resolutiondate',
    'summary',
    'project',
    'assignee',
  ];

  if (impactFieldId) {
    fieldsToRequest.push(impactFieldId);
  }
  if (organizationFieldId) {
    fieldsToRequest.push(organizationFieldId);
  }
  if (reactionFieldId) {
    fieldsToRequest.push(reactionFieldId);
  }

  // Backward compatibility: older frontend builds call without timeframe window.
  // In that case, return the legacy full issue list in `issues`.
  if (!windowStart || !windowEnd) {
    return {
      issues: await loadAllIssues(searchJql, fieldsToRequest, 10),
      historicalIssues: [],
      visibleIssues: [],
      namesMap,
    };
  }

  const visibleWindowJql = buildWindowScopedJql(searchJql, windowStart, windowEnd);
  const historicalQuery = (historicalJql ?? '').trim();

  return {
    issues: await loadAllIssues(searchJql, ['created'], 25),
    historicalIssues: historicalQuery ? await loadAllIssues(historicalQuery, ['created'], 10) : [],
    visibleIssues: await loadAllIssues(visibleWindowJql, fieldsToRequest, 10),
    namesMap,
  };
});

export const handler = resolver.getDefinitions();