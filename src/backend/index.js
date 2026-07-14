import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();

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

resolver.define('loadGadgetData', async ({ payload }) => {
  const searchJql = payload?.searchJql;

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

  const impactFieldId = findFieldIdByDisplayName(namesMap, [
    'impact (migrated 2)[dropdown]',
    'Impact (migrated 2)[dropdown]',
    'impact',
    'Impact',
  ]);
  const organizationFieldId = findFieldIdByDisplayName(namesMap, [
    'organization',
    'Organisation',
    'Organizations',
    'Organisationen',
  ]);
  const reactionFieldId = findFieldIdByDisplayName(namesMap, [
    'Reaktionszeit',
    'Reaktionzeit',
    'Reaktionszeit (SLA)',
    'Time to first response',
    'First response time',
  ]);

  const fieldsToRequest = [
    'created',
    'updated',
    'summary',
    'status',
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

  const searchResponse = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jql: searchJql,
      maxResults: 2000,
      fields: fieldsToRequest,
    }),
  });

  if (!searchResponse.ok) {
    const searchError = await searchResponse.text();
    throw new Error(`Jira search failed (${searchResponse.status}): ${searchError}`);
  }

  const searchJson = await searchResponse.json();

  return {
    issues: searchJson.issues ?? [],
    namesMap,
  };
});

export const handler = resolver.getDefinitions();