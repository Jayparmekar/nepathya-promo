/* Sign-in and calls to the Apps Script web app. */
(function () {
  var TOKEN_KEY = 'np_id_token';
  var cfg = window.NP_CONFIG || {};

  function configured() {
    return cfg.CLIENT_ID && cfg.CLIENT_ID.indexOf('PASTE_') < 0 && cfg.WEB_APP_URL && cfg.WEB_APP_URL.indexOf('PASTE_') < 0;
  }

  function getToken() { return sessionStorage.getItem(TOKEN_KEY); }
  function setToken(t) { sessionStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { sessionStorage.removeItem(TOKEN_KEY); }

  /** Waits for the Google Identity Services script, then initialises it. */
  function initGis(onCredential) {
    return new Promise(function (resolve) {
      (function wait() {
        if (window.google && google.accounts && google.accounts.id) {
          google.accounts.id.initialize({
            client_id: cfg.CLIENT_ID,
            callback: function (resp) { setToken(resp.credential); onCredential(resp.credential); },
            auto_select: false,
            cancel_on_tap_outside: true
          });
          resolve();
        } else setTimeout(wait, 100);
      })();
    });
  }

  function renderButton(el) {
    google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', width: 280 });
  }

  /** Session-expired handler, set by the page (shows the sign-in overlay and resolves with a new token). */
  var reauth = null;
  function onReauth(fn) { reauth = fn; }

  async function call(action, data, retried) {
    var res;
    try {
      res = await fetch(cfg.WEB_APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, idToken: getToken(), data: data || {} }),
        redirect: 'follow'
      });
    } catch (e) {
      throw new Error('Could not reach the server. Check the internet connection and try again.');
    }
    var json;
    try { json = await res.json(); } catch (e) { throw new Error('The server sent an unexpected reply. Please try again.'); }
    if (json.ok) return json.data;
    if (json.auth && json.error === 'Session expired' && reauth && !retried) {
      await reauth();
      return call(action, data, true);
    }
    var err = new Error(json.error || 'Something went wrong');
    err.auth = !!json.auth;
    throw err;
  }

  function signOut() {
    clearToken();
    try { google.accounts.id.disableAutoSelect(); } catch (e) {}
    location.href = 'index.html';
  }

  window.NP = { configured: configured, getToken: getToken, initGis: initGis, renderButton: renderButton,
    call: call, onReauth: onReauth, signOut: signOut, clearToken: clearToken };
})();
