// Transport for the Google Apps Script web app.
// The session token lives in sessionStorage because Apps Script cannot set cookies.
(function (root) {
  const base = () => (root.IA && root.IA.api) || '';
  const ready = () => /^https:\/\/script\.google\.com\/macros\/s\//.test(base());

  const tok = () => {
    try { return sessionStorage.getItem('ia_t'); }
    catch { return null; }
  };

  const setTok = t => {
    try {
      t ? sessionStorage.setItem('ia_t', t) : sessionStorage.removeItem('ia_t');
    } catch {}
  };

  async function call(action, data = {}) {
    if (!ready()) {
      return {
        ok: false,
        error: 'The backend is not connected yet. Set the Apps Script URL in config.js.'
      };
    }

    try {
      const r = await (
        await fetch(base(), {
          method: 'POST',
          headers: {'Content-Type': 'text/plain;charset=utf-8'},
          body: JSON.stringify({...data, action, token: tok()})
        })
      ).json();

      if (r.token) setTok(r.token);
      if (action === 'logout' || r.auth) setTok(null);

      return r;
    } catch {
      return {
        ok: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  async function pub(action, params = {}) {
    if (!ready()) return {ok: false, data: []};

    try {
      return await (
        await fetch(base() + '?' + new URLSearchParams({action, ...params}))
      ).json();
    } catch {
      return {ok: false, data: []};
    }
  }

  root.IA_API = {
    call,
    pub,
    ready,
    hasToken: () => !!tok()
  };
})(typeof window !== 'undefined' ? window : globalThis);




