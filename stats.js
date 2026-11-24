(() => {
  const byId = id => document.getElementById(id);
  const number = new Intl.NumberFormat('zh-CN');
  const percent = new Intl.NumberFormat('zh-CN', {style: 'percent', maximumFractionDigits: 1});
  const timestamp = new Intl.DateTimeFormat('zh-CN', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai'});
  const names = {home: '首页', volunteer: '志愿者采集', blind: '竹语 · 读屏', lowvis: '竹影 · 低视力', review: '管理员审核'};
  const labels = {views: '浏览量', submissions: '新增投稿'};
  const metrics = byId('metrics');
  const period = byId('period');
  const seriesSwitch = byId('series');
  const refresh = byId('refresh-stats');
  const status = byId('load-status');
  const chart = byId('chart');
  const tooltip = byId('chart-tooltip');
  const cursor = byId('chart-cursor');
  const gridIntervals = 4;
  let selectedDays = 7;
  let displayedDays = 7;
  let selectedSeries = 'views';
  let snapshot;
  let request = 0;
  let activeIndex = -1;
  let chartMaximum = gridIntervals;

  function html(tag, text) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function pressed(container, attribute, value) {
    const buttons = [...container.querySelectorAll('button')];
    const index = buttons.findIndex(button => button.dataset[attribute] === String(value));
    container.dataset.index = index;
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
  }

  function formatValue(value, series = selectedSeries) {
    return value === null ? '未采集' : number.format(value) + (series === 'views' ? ' 次' : ' 条');
  }

  function render(snapshot) {
    const {traffic, accounts, routes, daily, pages} = snapshot;
    const counts = {
      views: traffic.views, visitors: traffic.visitors, trial: traffic.trial_browsers,
      verified: accounts.verified, pending: routes.pending,
      'approved-audio': routes.approved_audio, submissions: routes.submissions
    };
    for (const [id, value] of Object.entries(counts)) byId(id).textContent = number.format(value);
    byId('new-verified').textContent = '累计账号 · 本期新增 ' + number.format(accounts.new_verified) + ' 个';
    byId('submitters').textContent = '来自 ' + number.format(routes.submitters) + ' 个投稿账号';
    const reviewed = routes.approved_audio + routes.rejected;
    byId('approval-rate').textContent = reviewed ? percent.format(routes.approved_audio / reviewed) : '—';
    byId('review-count').textContent = reviewed ? '已审核 ' + number.format(reviewed) + ' 条 · 驳回 ' + number.format(routes.rejected) + ' 条' : '尚无已审核路标';
    byId('coverage').textContent = daily[0].day + ' 至 ' + daily.at(-1).day;
    byId('updated').textContent = '更新于 ' + timestamp.format(new Date(snapshot.generated_at));
    byId('tracking-start').textContent = '访问统计始于 ' + snapshot.tracking_start + '，此前的日期标记为「未采集」。看板按北京时间统计。';

    byId('daily').replaceChildren(...daily.map(row => {
      const tr = html('tr');
      const date = html('th', row.day);
      date.scope = 'row';
      tr.append(date, html('td', row.views === null ? '未采集' : number.format(row.views)), html('td', number.format(row.submissions)));
      return tr;
    }));

    const ranking = Object.entries(names).map(([page, label]) => ({label, views: Number(pages[page])})).sort((a, b) => b.views - a.views);
    byId('pages').replaceChildren(...ranking.map(({label, views}) => {
      const li = html('li');
      const track = html('div');
      const fill = html('i');
      const share = views / Math.max(1, Number(traffic.views));
      li.className = 'page-row';
      track.className = 'page-track';
      track.setAttribute('aria-hidden', 'true');
      fill.style.setProperty('--share', share);
      track.append(fill);
      li.append(html('span', label), html('strong', formatValue(views, 'views')), track);
      return li;
    }));
    renderChart();
  }

  function hideDay() {
    activeIndex = -1;
    tooltip.hidden = cursor.hidden = true;
  }

  function positionTooltip() {
    const x = activeIndex / (snapshot.daily.length - 1);
    const preferred = x * chart.clientWidth + (x > .65 ? -tooltip.offsetWidth - 10 : 10);
    tooltip.style.left = Math.max(0, Math.min(chart.clientWidth - tooltip.offsetWidth, preferred)) + 'px';
  }

  function showDay(index, announce = false) {
    if (!snapshot || (index === activeIndex && !announce)) return;
    const {daily} = snapshot;
    const row = daily[index];
    if (!row) return;
    const value = row[selectedSeries];
    const x = index / (daily.length - 1);
    activeIndex = index;
    cursor.style.left = (x * 100) + '%';
    const dot = byId('chart-dot');
    dot.hidden = value === null;
    if (value !== null) dot.style.top = ((1 - value / chartMaximum) * 100) + '%';
    byId('tooltip-day').textContent = row.day;
    byId('tooltip-value').textContent = labels[selectedSeries] + ' · ' + formatValue(value);
    tooltip.hidden = cursor.hidden = false;
    positionTooltip();
    if (announce) byId('chart-status').textContent = row.day + '，' + labels[selectedSeries] + '，' + formatValue(value);
  }

  function renderChart() {
    if (!snapshot) return;
    hideDay();
    const {daily} = snapshot;
    const values = daily.map(row => row[selectedSeries]);
    const peak = Math.max(0, ...values.map(value => value ?? 0));
    const target = Math.max(1, peak / gridIntervals);
    const order = 10 ** Math.floor(Math.log10(target));
    const step = [1, 2, 3, 5, 10].find(value => value * order >= target) * order;
    chartMaximum = step * gridIntervals;
    chart.style.setProperty('--chart-color', selectedSeries === 'views' ? '#138260' : '#566db6');
    byId('chart-peak').textContent = '单日最高 ' + formatValue(peak);
    byId('axis-y').replaceChildren(...Array.from({length: gridIntervals + 1}, (_, i) => html('span', number.format((gridIntervals - i) * step))));
    byId('chart-grid').replaceChildren(...Array.from({length: gridIntervals + 1}, () => html('i')));
    const gap = byId('chart-gap');
    const firstTracked = values.findIndex(value => value !== null);
    const gapWidth = firstTracked < 0 ? 100 : 100 * firstTracked / (daily.length - 1);
    gap.hidden = !gapWidth;
    gap.style.width = gapWidth + '%';
    gap.toggleAttribute('data-wide', gapWidth >= 28);
    const ticks = daily.length <= 7 ? [0, 2, 4, daily.length - 1] : [0, 7, 14, 21, daily.length - 1];
    byId('axis-x').replaceChildren(...ticks.map(index => {
      const label = html('span', daily[index].day.slice(5).replace('-', '/'));
      label.style.left = (index / (daily.length - 1) * 100) + '%';
      return label;
    }));

    // Split at untracked dates so the line never implies that they had zero visits.
    const segments = [];
    let segment = [];
    values.forEach((value, index) => {
      if (value === null) {
        if (segment.length) segments.push(segment);
        segment = [];
      } else {
        segment.push([1000 * index / (daily.length - 1), 200 * (1 - value / chartMaximum)]);
      }
    });
    if (segment.length) segments.push(segment);
    const paths = segments.map(points => {
      const line = 'M' + points.map(([x, y]) => x + ',' + y).join(' L');
      const [first, last] = [points[0], points.at(-1)];
      return {
        line: points.length === 1 ? line + 'h0.1' : line,
        area: line + ' L' + last[0] + ',200 L' + first[0] + ',200 Z'
      };
    });
    byId('plot-line').setAttribute('d', paths.map(path => path.line).join(' '));
    byId('plot-area').setAttribute('d', paths.map(path => path.area).join(' '));
    const plot = byId('plot');
    plot.classList.remove('plot-enter');
    requestAnimationFrame(() => requestAnimationFrame(() => plot.classList.add('plot-enter')));
  }

  function pointFromPointer(event) {
    if (!snapshot) return;
    const bounds = chart.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    showDay(Math.round(x * (snapshot.daily.length - 1)));
  }

  chart.addEventListener('pointermove', event => {
    if (event.pointerType !== 'touch') pointFromPointer(event);
  });
  chart.addEventListener('click', pointFromPointer);
  chart.addEventListener('pointerleave', event => {
    if (event.pointerType !== 'touch' && !chart.matches(':focus-visible')) hideDay();
  });
  chart.addEventListener('focus', () => {
    if (snapshot && chart.matches(':focus-visible')) showDay(snapshot.daily.length - 1, true);
  });
  chart.addEventListener('blur', hideDay);
  chart.addEventListener('keydown', event => {
    if (!snapshot) return;
    const max = snapshot.daily.length - 1;
    const index = activeIndex === -1 ? max : activeIndex;
    if (event.key === 'Escape') {
      hideDay();
      return;
    }
    const steps = {ArrowLeft: Math.max(0, index - 1), ArrowRight: Math.min(max, index + 1), Home: 0, End: max};
    if (Object.hasOwn(steps, event.key)) {
      event.preventDefault();
      showDay(steps[event.key], true);
    }
  });
  window.addEventListener('resize', () => { if (activeIndex !== -1) positionTooltip(); });

  async function loadStats() {
    const current = ++request;
    const days = selectedDays;
    refresh.disabled = true;
    refresh.setAttribute('aria-busy', 'true');
    metrics.setAttribute('aria-busy', 'true');
    metrics.dataset.state = snapshot ? 'refreshing' : 'loading';
    status.classList.add('sr-only');
    status.textContent = '正在读取使用数据…';
    try {
      if (!bambooCloud) throw new Error('Cloud client unavailable');
      const {data, error} = await bambooCloud.rpc('bamboo_usage_snapshot', {p_days: days});
      if (current !== request) return;
      if (error) throw error;
      snapshot = data;
      displayedDays = days;
      metrics.hidden = false;
      render(data);
      status.textContent = '已更新最近 ' + days + ' 天的数据。';
    } catch (error) {
      if (current !== request) return;
      selectedDays = displayedDays;
      pressed(period, 'days', displayedDays);
      metrics.hidden = !snapshot;
      status.classList.remove('sr-only');
      status.textContent = snapshot ? '刷新失败，当前显示上一次的数据。' : '暂时无法读取使用数据，请重试。';
      console.warn('Could not load usage dashboard', error);
    } finally {
      if (current === request) {
        refresh.disabled = false;
        refresh.removeAttribute('aria-busy');
        metrics.removeAttribute('aria-busy');
        delete metrics.dataset.state;
      }
    }
  }

  period.addEventListener('click', event => {
    const button = event.target.closest('[data-days]');
    if (!button || Number(button.dataset.days) === selectedDays) return;
    selectedDays = Number(button.dataset.days);
    pressed(period, 'days', selectedDays);
    loadStats();
  });
  seriesSwitch.addEventListener('click', event => {
    const button = event.target.closest('[data-series]');
    if (!button || button.dataset.series === selectedSeries) return;
    selectedSeries = button.dataset.series;
    pressed(seriesSwitch, 'series', selectedSeries);
    renderChart();
  });
  refresh.addEventListener('click', loadStats);
  loadStats();
})();
