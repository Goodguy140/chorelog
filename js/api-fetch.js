export async function apiFetch(url, opts = {}) {
  const { skipSessionRedirect, ...fetchOpts } = opts;
  const r = await fetch(url, { credentials: 'include', ...fetchOpts });
  const shell = document.getElementById('appShell');
  if (
    !skipSessionRedirect &&
    r.status === 401 &&
    shell &&
    !shell.hidden
  ) {
    document.getElementById('loginScreen').hidden = false;
    shell.hidden = true;
  }
  return r;
}
