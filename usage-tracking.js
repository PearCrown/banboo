// Count the five public site entrances, independently of login.
(() => {
  const page = document.body.dataset.usagePage;
  const hosts = ['bamboo-help.vercel.app', 'banboo-one.vercel.app'];
  if (!page || !bambooCloud || !hosts.includes(location.hostname) || !crypto.randomUUID) return;

  function recordVisibleVisit() {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', recordVisibleVisit);
    try {
      const key = 'bamboo_usage_browser';
      let browser = localStorage.getItem(key);
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(browser || '')) {
        browser = crypto.randomUUID();
        localStorage.setItem(key, browser);
      }
      void bambooCloud.rpc('bamboo_record_visit', {p_page: page, p_browser: browser}).then(
        () => {}, () => {}
      );
    } catch {
      // Storage restrictions must not interfere with the site's main flows.
    }
  }

  if (document.visibilityState === 'visible') recordVisibleVisit();
  else document.addEventListener('visibilitychange', recordVisibleVisit);
})();
