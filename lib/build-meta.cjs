function envTrim(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function sanitizeGitHubRepository(s) {
  const t = String(s || '').trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(t)) return null;
  return t;
}

function sanitizeGitSha(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!/^[a-f0-9]{7,64}$/.test(t)) return null;
  return t;
}

function sanitizeRunId(s) {
  const t = String(s || '').trim();
  if (!/^\d+$/.test(t)) return null;
  return t;
}

function buildGitHubBuildMeta() {
  const repository = sanitizeGitHubRepository(
    envTrim('CHORELOG_GITHUB_REPOSITORY', 'GITHUB_REPOSITORY'),
  );
  const shaRaw = envTrim('CHORELOG_GITHUB_SHA', 'GITHUB_SHA');
  const sha = shaRaw ? sanitizeGitSha(shaRaw) : null;
  const ref = envTrim('CHORELOG_GITHUB_REF', 'GITHUB_REF');
  const runIdRaw = envTrim('CHORELOG_GITHUB_RUN_ID', 'GITHUB_RUN_ID');
  const runId = runIdRaw ? sanitizeRunId(runIdRaw) : null;
  const runNumber = envTrim('CHORELOG_GITHUB_RUN_NUMBER', 'GITHUB_RUN_NUMBER');
  const workflow = envTrim('CHORELOG_GITHUB_WORKFLOW', 'GITHUB_WORKFLOW');
  const explicitUrl = envTrim('CHORELOG_GITHUB_ACTIONS_URL');
  let actionsRunUrl = null;
  if (explicitUrl) {
    try {
      const u = new URL(explicitUrl);
      if (u.protocol === 'https:' && u.hostname === 'github.com') actionsRunUrl = u.href;
    } catch {
      /* ignore */
    }
  } else if (repository && runId) {
    actionsRunUrl = `https://github.com/${repository}/actions/runs/${runId}`;
  }
  if (!repository && !sha && !runId && !ref && !workflow && !actionsRunUrl) return null;
  return {
    ...(repository ? { repository } : {}),
    ...(sha ? { sha } : {}),
    ...(ref ? { ref } : {}),
    ...(runId ? { runId } : {}),
    ...(runNumber ? { runNumber } : {}),
    ...(workflow ? { workflow } : {}),
    ...(actionsRunUrl ? { actionsRunUrl } : {}),
  };
}

module.exports = {
  buildGitHubBuildMeta,
};
