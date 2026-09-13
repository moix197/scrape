const PERMISSIVE_RULES = { disallow: [], allow: [] };

function parseLine(line) {
  const withoutComment = line.split('#')[0].trim();
  if (!withoutComment) return null;
  const separatorIndex = withoutComment.indexOf(':');
  if (separatorIndex === -1) return null;
  const field = withoutComment.slice(0, separatorIndex).trim().toLowerCase();
  const value = withoutComment.slice(separatorIndex + 1).trim();
  return { field, value };
}

function groupRobotsLines(text) {
  const groups = [];
  let currentGroup = null;
  let sawDirectiveSinceLastAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const parsed = parseLine(rawLine);
    if (!parsed) continue;

    if (parsed.field === 'user-agent') {
      if (!currentGroup || sawDirectiveSinceLastAgent) {
        currentGroup = { agents: [], disallow: [], allow: [] };
        groups.push(currentGroup);
        sawDirectiveSinceLastAgent = false;
      }
      currentGroup.agents.push(parsed.value.toLowerCase());
    } else if (parsed.field === 'disallow' || parsed.field === 'allow') {
      if (!currentGroup) continue;
      currentGroup[parsed.field].push(parsed.value);
      sawDirectiveSinceLastAgent = true;
    }
  }

  return groups;
}

function findMatchingGroup(groups, userAgent) {
  const uaLower = userAgent.toLowerCase();
  const specificMatch = groups.find((group) =>
    group.agents.some((agent) => agent !== '*' && uaLower.startsWith(agent))
  );
  if (specificMatch) return specificMatch;
  return groups.find((group) => group.agents.includes('*')) || null;
}

export function parseRobotsText(text, userAgent) {
  const groups = groupRobotsLines(text);
  const match = findMatchingGroup(groups, userAgent);
  if (!match) return { disallow: [], allow: [] };
  return { disallow: match.disallow, allow: match.allow };
}

export async function fetchRobotsRules(originUrl, userAgent) {
  try {
    const robotsUrl = new URL('/robots.txt', originUrl).toString();
    const res = await fetch(robotsUrl);
    if (!res.ok) return PERMISSIVE_RULES;
    const text = await res.text();
    return parseRobotsText(text, userAgent);
  } catch {
    return PERMISSIVE_RULES;
  }
}

function extractPath(pathOrUrl) {
  try {
    return new URL(pathOrUrl).pathname;
  } catch {
    return pathOrUrl;
  }
}

function findLongestMatch(entries, path) {
  let longest = -1;
  for (const entry of entries) {
    if (entry !== '' && path.startsWith(entry) && entry.length > longest) {
      longest = entry.length;
    }
  }
  return longest;
}

export function isAllowed(rules, pathOrUrl) {
  const path = extractPath(pathOrUrl);
  const disallowLength = findLongestMatch(rules.disallow || [], path);
  const allowLength = findLongestMatch(rules.allow || [], path);

  if (disallowLength === -1) return true;
  return allowLength >= disallowLength;
}
