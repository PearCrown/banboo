function visibleMarks(){
  const local = state.role === 'volunteer' ? state.marks : state.marks.filter(isSample);
  return [...publishedRoutes,...local];
}

function findMark(id){
  return visibleMarks().find(mark => mark.id === id);
}

function cloudListControls(){
  return `<section class="section">
    <button class="btn btn-outline btn-block" onclick="reloadPublishedRoutes()">刷新已审核路标</button>
    <p id="cloudNotice" class="rec-example" role="status">${esc(routeLoadError)}</p>
  </section>`;
}

async function reloadPublishedRoutes(showCount = true){
  const view = document.getElementById('view');
  const notice = document.getElementById('cloudNotice');
  if(notice) notice.textContent = '正在读取已审核路标…';
  await refreshRoutes();
  if(view.dataset.page !== 'nearby' || view.closest('.hidden')) return;
  go('nearby',null,false);
  const updated = document.getElementById('cloudNotice');
  if(updated && !routeLoadError && showCount) updated.textContent = `已读取 ${publishedRoutes.length} 条通过审核的路标。`;
}

function accountForm(purpose){
  if(!bambooCloud) return '<p class="trust" role="status">登录服务暂时无法加载，请刷新页面重试。</p>';
  return `<form class="rec-card" onsubmit="submitAccount(event,'${purpose}')">
    <p class="rec-example">${purpose === 'review' ? '请用已获得审核权限的邮箱登录。' : '请登录后提交路标，之后可以查看审核状态。'}</p>
    <label for="accountEmail">邮箱</label>
    <input class="rec-input" id="accountEmail" name="email" type="email" autocomplete="email" maxlength="254" required>
    <label for="accountPassword">密码</label>
    <input class="rec-input" id="accountPassword" name="password" type="password" autocomplete="current-password" minlength="6" required>
    <div class="rec-actions">
      <button class="btn btn-primary" type="submit" value="login">登录</button>
      <button class="btn btn-outline" type="submit" value="register">注册</button>
    </div>
    <p class="rec-example" data-account-status role="status"></p>
  </form>`;
}

async function submitAccount(event,purpose){
  event.preventDefault();
  const form = event.currentTarget;
  const status = form.querySelector('[data-account-status]');
  const fields = new FormData(form);
  const credentials = {email:fields.get('email').trim(),password:fields.get('password')};
  const registering = (event.submitter?.value === 'register');
  const buttons = form.querySelectorAll('button');
  buttons.forEach(button => button.disabled = true);
  status.textContent = registering ? '正在发送验证邮件…' : '正在登录…';
  try{
    const {data,error} = registering
      ? await bambooCloud.auth.signUp({...credentials,options:{emailRedirectTo:location.origin + '/'}})
      : await bambooCloud.auth.signInWithPassword(credentials);
    if(error) throw error;
    if(!data.session){
      form.elements.password.value = '';
      status.textContent = '请打开验证邮件，确认邮箱后再回来登录。';
      return;
    }
    cloudSession = data.session;
    if(form.isConnected) go(purpose);
  }catch(error){
    status.textContent = error.code === 'email_not_confirmed' ? '请先打开验证邮件确认邮箱。'
      : error.code === 'invalid_credentials' ? '邮箱或密码不正确。'
      : error.code === 'email_address_not_authorized' ? '这个邮箱还未获准接收试运行的验证邮件，请联系管理员。'
      : registering ? '暂时无法发送验证邮件。请确认邮箱，或稍后再试。'
      : '登录失败，请检查网络后重试。';
  }finally{
    buttons.forEach(button => button.disabled = false);
  }
}

async function signOutAccount(){
  if(rec.saving){ toast('请等当前路标上传完成'); return; }
  await discardDraftUploads(rec);
  const {error} = await bambooCloud.auth.signOut({scope:'local'});
  if(error){ toast('退出失败，请重试'); return; }
  cloudSession = null;
  resetRecord();
  go(state.role === 'admin' ? 'review' : 'me');
}

function reviewView(){
  return `<header class="page-head">
    <button class="btn btn-outline" onclick="switchRole()">返回身份选择</button>
    <h1>管理员审核</h1>
  </header>
  <section class="section">
    ${cloudSession
      ? `<div class="rec-actions">
           <button class="btn btn-outline" onclick="mountReviewQueue()">刷新待审核列表</button>
           <button class="btn btn-outline" onclick="signOutAccount()">退出账号</button>
         </div>
         <p id="reviewNotice" class="rec-example" role="status"></p>
         <div id="reviewQueue" aria-busy="true"></div>`
      : accountForm('review')}
  </section>`;
}

let reviewQueue = [];

async function mountReviewQueue(){
  const slot = document.getElementById('reviewQueue');
  const notice = document.getElementById('reviewNotice');
  if(!slot) return;
  slot.setAttribute('aria-busy','true');
  notice.textContent = '正在读取待审核路标…';
  const viewer = cloudSession?.user.id;
  try{
    const rows = await getReviewQueue();
    if(!slot.isConnected || viewer !== cloudSession?.user.id) return;
    reviewQueue = rows ?? [];
    notice.textContent = !rows ? '这个账号暂无管理员审核权限。'
      : rows.length ? `当前显示 ${rows.length} 条待审核路标。` : '目前没有待审核路标。';
    slot.innerHTML = reviewQueue.map(mark => `<article class="mark-card" id="review-${Number(mark.id)}">
      <h2 class="mark-title">${esc(mark.place)}</h2>
      <p class="mark-meta">${esc(mark.recorder)} · ${esc(new Date(mark.created_at).toLocaleString('zh-CN'))}</p>
      <p class="transcript">${esc(mark.summary)}</p>
      <p class="rec-example">${pathInfo({blindPath:{status:mark.path_status}}).text}</p>
      <button type="button" class="btn btn-outline" onclick="showReviewMedia(${Number(mark.id)},this)">打开录音和照片</button>
      <div data-review-media role="status"></div>
      <div class="rec-actions">
        <button type="button" class="btn btn-primary" onclick="decideReview(${Number(mark.id)},'approved')">审核通过</button>
        <button type="button" class="btn btn-outline" onclick="decideReview(${Number(mark.id)},'rejected')">不通过</button>
      </div>
    </article>`).join('');
  }catch(error){
    if(slot.isConnected) notice.textContent = '暂时无法读取待审核路标，请重试。';
    console.warn('Could not load moderation queue',error);
  }finally{
    slot.setAttribute('aria-busy','false');
  }
}

async function renderCloudMedia(slot,paths){
  const urls = await signRouteMedia(paths);
  if(!slot.isConnected) return;
  if(!urls.audio) throw new Error('Recording cannot be read');
  slot.textContent = '现场原声';
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.preload = 'metadata';
  audio.src = urls.audio;
  audio.style.width = '100%';
  audio.setAttribute('aria-label',mediaLabels.audio);
  audio.onplay = () => {
    window.speechSynthesis?.cancel();
    window.BangbuDevice?.stopSpeaking();
  };
  slot.append(audio);
  for(const kind of ['before','after']){
    if(!urls[kind]) continue;
    const image = document.createElement('img');
    image.src = urls[kind];
    image.alt = mediaLabels[kind];
    image.style.maxWidth = '45%';
    slot.append(image);
  }
}

async function showReviewMedia(id,button){
  const row = reviewQueue.find(mark => Number(mark.id) === id);
  const slot = document.querySelector(`#review-${id} [data-review-media]`);
  if(!row || !slot) return;
  button.disabled = true;
  slot.textContent = '正在读取录音与照片…';
  try{
    await renderCloudMedia(slot,{audio:row.audio_path,before:row.before_path,after:row.after_path});
  }catch(error){
    slot.textContent = '暂时无法读取录音，请重试。';
    console.warn('Could not load review media',error);
  }finally{
    button.disabled = false;
  }
}

function decideReview(id,status){
  const approved = status === 'approved';
  confirmAction(
    approved ? '通过审核' : '不通过审核',
    approved ? '这条路标的描述和素材将公开给查看者。' : '这条路标将保持私有。',
    () => saveReview(id,status)
  );
}

async function saveReview(id,status){
  const row = document.getElementById(`review-${id}`);
  if(!row) return;
  row.querySelectorAll('button').forEach(button => button.disabled = true);
  try{
    const changed = await updateReview(id,status);
    toast(changed ? routeStatus[status] : '这条路标已被处理，请查看最新列表。');
    await mountReviewQueue();
  }catch(error){
    toast(error.code === '23514' ? '录音或照片缺失，无法通过审核。' : '审核未保存，请重试。');
    console.warn('Could not save review decision',error);
  }finally{
    row.querySelectorAll('button').forEach(button => button.disabled = false);
  }
}

function ownRoutesPanel(){
  return `<section class="section">
    <h2>我的云端投稿</h2>
    ${cloudSession ? `
      <div id="ownCloudRoutes" aria-live="polite">正在读取投稿…</div>
      <div class="rec-actions">
        <button class="btn btn-outline" onclick="mountOwnRoutes()">刷新投稿状态</button>
        <button class="btn btn-outline" onclick="signOutAccount()">退出账号</button>
      </div>` : '<p class="rec-example">录制页面登录后，可以查看你的投稿状态。</p>'}
  </section>`;
}

async function mountOwnRoutes(){
  const slot = document.getElementById('ownCloudRoutes');
  if(!slot) return;
  const viewer = cloudSession?.user.id;
  try{
    const rows = await getOwnRoutes();
    if(!slot.isConnected || viewer !== cloudSession?.user.id) return;
    slot.innerHTML = rows.length ? rows.map(mark => `<article class="mark-card">
      <b>${esc(mark.place)}</b>
      <p class="mark-meta">${routeStatus[mark.status]}</p>
    </article>`).join('') : '<p class="rec-example">暂无云端投稿。</p>';
  }catch(error){
    if(slot.isConnected) slot.textContent = '暂时无法读取投稿，请重试。';
    console.warn('Could not load user submissions',error);
  }
}
