(() => {
  const byId = id => document.getElementById(id);
  const number = new Intl.NumberFormat('zh-CN');
  const percent = new Intl.NumberFormat('zh-CN', {style: 'percent', maximumFractionDigits: 1});
  const timestamp = new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai'
  });
  const names = {home: '首页', volunteer: '志愿者采集', blind: '竹语 · 读屏', lowvis: '竹影 · 低视力', review: '管理员审核'};
  const metrics = byId('metrics');
  const period = byId('period');
  const refresh = byId('refresh-stats');
  const status = byId('load-status');
  let displayedPeriod;

  function render(snapshot) {
    const {traffic, accounts, routes, daily, pages} = snapshot;
    const counts = {
      views: traffic.views, visitors: traffic.visitors, trial: traffic.trial_browsers,
      verified: accounts.verified, pending: routes.pending,
      'approved-audio': routes.approved_audio, submissions: routes.submissions
    };
    for (const [id, value] of Object.entries(counts)) byId(id).textContent = number.format(value);
    byId('new-verified').textContent = '累计账号 · 时段内新增 ' + number.format(accounts.new_verified) + ' 个';
    byId('submitters').textContent = '来自 ' + number.format(routes.submitters) + ' 个投稿账号';
    const reviewed = routes.approved_audio + routes.rejected;
    byId('approval-rate').textContent = reviewed ? percent.format(routes.approved_audio / reviewed) : '—';
    byId('review-count').textContent = reviewed
      ? '已审核 ' + number.format(reviewed) + ' 条 · 其中驳回 ' + number.format(routes.rejected) + ' 条'
      : '尚无已审核路标';
    byId('coverage').textContent = daily[0].day + ' 至 ' + daily.at(-1).day
      + '（北京时间）。访问统计始于 ' + snapshot.tracking_start + '，此前无访问数据。';
    byId('updated').textContent = '更新于 ' + timestamp.format(new Date(snapshot.generated_at)) + '（北京时间）';

    const peak = Math.max(0, ...daily.map(row => row.views ?? 0));
    byId('chart-peak').textContent = '单日最高 ' + number.format(peak);
    byId('start-date').textContent = daily[0].day.slice(5);
    byId('end-date').textContent = daily.at(-1).day.slice(5);
    byId('chart').replaceChildren(...daily.map(row => {
      const bar = document.createElement('div');
      bar.className = row.views === null ? 'bar missing' : 'bar';
      bar.style.height = (peak ? (row.views ?? 0) / peak * 100 : 0) + '%';
      bar.title = row.day + ' · ' + (row.views === null ? '未采集' : number.format(row.views) + ' 次');
      return bar;
    }));
    byId('daily').replaceChildren(...daily.map(row => {
      const tr = document.createElement('tr');
      const date = document.createElement('th');
      date.scope = 'row';
      date.textContent = row.day;
      tr.append(date);
      for (const label of [row.views === null ? '未采集' : number.format(row.views), number.format(row.submissions)]) {
        const td = document.createElement('td');
        td.textContent = label;
        tr.append(td);
      }
      return tr;
    }));
    byId('pages').replaceChildren(...Object.entries(names).map(([page, label]) => {
      const li = document.createElement('li');
      const title = document.createElement('span');
      const count = document.createElement('strong');
      const meter = document.createElement('meter');
      title.textContent = label;
      count.textContent = number.format(pages[page]);
      meter.max = Math.max(1, traffic.views);
      meter.value = pages[page];
      meter.setAttribute('aria-hidden', 'true');
      li.append(title, count, meter);
      return li;
    }));
  }

  async function loadStats() {
    if (refresh.disabled) return;
    period.disabled = refresh.disabled = true;
    status.textContent = '正在读取使用数据…';
    try {
      if (!bambooCloud) throw new Error('Cloud client unavailable');
      const {data, error} = await bambooCloud.rpc('bamboo_usage_snapshot', {p_days: Number(period.value)});
      if (error) throw error;
      render(data);
      displayedPeriod = period.value;
      metrics.hidden = false;
      status.textContent = '';
    } catch (error) {
      if (displayedPeriod) period.value = displayedPeriod;
      status.textContent = displayedPeriod ? '刷新失败，当前显示上一次的数据。' : '暂时无法读取使用数据，请重试。';
      console.warn('Could not load usage dashboard', error);
    } finally {
      period.disabled = refresh.disabled = false;
    }
  }

  period.addEventListener('change', loadStats);
  refresh.addEventListener('click', loadStats);
  loadStats();
})();
