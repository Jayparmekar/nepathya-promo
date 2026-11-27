(function () {
  var statusEl = document.getElementById('status');
  var errEl = document.getElementById('error');

  function showError(msg) { errEl.textContent = msg; errEl.hidden = false; statusEl.textContent = ''; }

  if (!NP.configured()) { document.getElementById('setup').hidden = false; return; }

  async function check() {
    errEl.hidden = true;
    statusEl.textContent = 'Checking your access…';
    try {
      var me = await NP.call('whoami');
      sessionStorage.setItem('np_me', JSON.stringify(me));
      location.href = 'admission.html';
    } catch (e) {
      NP.clearToken();
      showError(e.auth && e.message !== 'Session expired' ? 'Access only for Nepathya staff.' : e.message);
    }
  }

  NP.initGis(check).then(function () {
    NP.renderButton(document.getElementById('gbtn'));
    if (NP.getToken()) check();
  });
})();
