const pageCaptureFields = 'latitude,longitude,audio_seconds';
const pagePathCodes = {畅通:'ok', 已清理:'cleared', 部分破损:'broken', 被占用:'blocked', 未知:'unknown'};
const pagePathLabels = Object.fromEntries(Object.entries(pagePathCodes).map(([label,code]) => [code,label]));

function pageRoute(row){
  return {
    id:String(row.id),
    place:row.place,
    lat:row.latitude,
    lng:row.longitude,
    submittedAt:Date.parse(row.created_at),
    vol:{anonId:row.recorder},
    audio:{mediaKey:row.audio_path,duration:row.audio_seconds ?? null,aiText:row.summary},
    photo:{mediaKey:row.after_path || row.before_path,aiText:null},
    beforePhoto:row.before_path && row.after_path ? row.before_path : null,
    blindPath:{status:pagePathLabels[row.path_status] ?? '未知',checkedAt:Date.parse(row.created_at)},
    humanReview:{
      status:row.status === 'pending' ? null : row.status,
      reviewedAt:row.reviewed_at ? Date.parse(row.reviewed_at) : null,
      tags:[]
    },
    state:{pending:'queue',approved:'published',rejected:'rejected'}[row.status]
  };
}

function routePageStore(role){
  let rows = [];
  let request = 0;
  return {
    load:() => rows,
    clear(){
      request++;
      rows = [];
    },
    async refresh(){
      const current = ++request;
      await initCloud();
      if(!bambooCloud) throw new Error('Cloud client unavailable');
      const sessionId = cloudSession?.user.id;
      if(role !== 'public' && !sessionId) return false;
      const fields = role === 'public' ? routeFields : reviewFields;
      let query = bambooCloud.from('route_marks').select(fields + ',' + pageCaptureFields);
      if(role === 'review'){
        const {data,error} = await bambooCloud.rpc('is_route_reviewer');
        if(error) throw error;
        if(!data) return false;
        const [pending, reviewed] = await Promise.all([
          bambooCloud.from('route_marks').select(fields + ',' + pageCaptureFields)
            .eq('status','pending').order('id').limit(1000),
          query.in('status',['approved','rejected']).order('reviewed_at',{ascending:false}).limit(100)
        ]);
        if(pending.error || reviewed.error) throw pending.error || reviewed.error;
        if(current !== request || sessionId !== cloudSession?.user.id) return false;
        rows = [...pending.data,...reviewed.data].map(pageRoute);
        return true;
      }
      query = role === 'public' ? query.eq('status','approved') : query.eq('owner_id',sessionId);
      const {data,error} = await query.order('id',{ascending:false});
      if(error) throw error;
      if(current !== request || (role !== 'public' && sessionId !== cloudSession?.user.id)) return false;
      rows = data.map(pageRoute);
      return true;
    },
    async getMedia(path){
      if(!path) return null;
      const {asset} = await signRouteMedia({asset:path});
      if(!asset) throw new Error('Media unavailable');
      const response = await fetch(asset,{cache:'no-store'});
      if(!response.ok) throw new Error('Media unavailable');
      return response.blob();
    },
    async decide(id,status){
      if(role !== 'review') throw new Error('Review permission required');
      const changed = await updateReview(id,status);
      const route = rows.find(row => row.id === id);
      if(changed && route){
        route.state = status === 'approved' ? 'published' : 'rejected';
        route.humanReview = {status,reviewedAt:Date.now(),tags:[]};
      }
      return changed;
    }
  };
}

function setupPageAccount({role,store,content,render,onSessionEnd,beforeSignOut,canSignOut,
  readLabel='正在读取云端路标…',readErrorLabel='暂时无法读取云端路标，请重试。'}){
  const panel = document.getElementById('page-account');
  const form = panel.querySelector('form');
  const controls = panel.querySelector('.page-account-controls');
  const status = panel.querySelector('[role=status]');
  let authorized = false;
  let activeUserId;
  let revision = 0;
  let busy = false;
  const setBusy = value => {
    busy = value;
    panel.querySelectorAll('button, select').forEach(control => { control.disabled = value; });
  };
  const showContent = visible => {
    authorized = visible;
    content.forEach(element => { element.hidden = !visible; });
  };
  const sync = async () => {
    const attempt = ++revision;
    const userId = cloudSession?.user.id;
    if(userId !== activeUserId){
      if(activeUserId) onSessionEnd?.();
      activeUserId = userId;
      store.clear();
      showContent(false);
    }
    form.hidden = Boolean(userId) || !bambooCloud;
    controls.hidden = !userId;
    if(!userId){
      status.textContent = bambooCloud ? '' : '登录服务暂时无法加载，请刷新页面后重试。';
      return;
    }
    status.textContent = readLabel;
    try{
      const allowed = await store.refresh();
      if(attempt !== revision) return;
      showContent(allowed);
      status.textContent = allowed ? '' : '这个账号暂无管理员审核权限。';
      if(allowed) render();
    }catch(error){
      if(attempt !== revision) return;
      status.textContent = readErrorLabel;
      console.warn('Could not refresh route page',error);
    }
  };
  showContent(false);
  form.hidden = true;
  controls.hidden = true;
  form.addEventListener('submit',async event => {
    event.preventDefault();
    if(busy || !bambooCloud) return;
    const registration = role === 'volunteer' && event.submitter?.value === 'register';
    const fields = new FormData(form);
    const credentials = {email:fields.get('email').trim(),password:fields.get('password')};
    setBusy(true);
    status.textContent = registration ? '正在发送验证邮件…' : '正在登录…';
    try{
      const {data,error} = registration
        ? await bambooCloud.auth.signUp({...credentials,options:{emailRedirectTo:location.origin + '/'}})
        : await bambooCloud.auth.signInWithPassword(credentials);
      if(error) throw error;
      form.elements.password.value = '';
      if(!data.session){
        status.textContent = '请打开验证邮件，确认邮箱后再登录。';
        return;
      }
      cloudSession = data.session;
      await sync();
      if(authorized) panel.querySelector('[data-refresh]').focus();
    }catch(error){
      status.textContent = error.code === 'email_not_confirmed' ? '请先打开验证邮件确认邮箱。'
        : error.code === 'invalid_credentials' ? '邮箱或密码不正确。'
        : error.status === 429 ? '操作太频繁，请稍后再试。'
        : registration ? '注册未完成，请确认邮箱或稍后再试。' : '登录失败，请稍后再试。';
    }finally{
      setBusy(false);
    }
  });
  panel.querySelector('[data-refresh]').addEventListener('click',async () => {
    setBusy(true);
    try{ await sync(); }finally{ setBusy(false); }
  });
  panel.querySelector('[data-sign-out]').addEventListener('click',async () => {
    if(canSignOut && !canSignOut()) return;
    setBusy(true);
    try{
      await beforeSignOut?.();
      const {error} = await bambooCloud.auth.signOut({scope:'local'});
      if(error) throw error;
      cloudSession = null;
      await sync();
      form.elements.email.focus();
    }catch(error){
      status.textContent = '退出失败，请重试。';
    }finally{
      setBusy(false);
    }
  });
  initCloud().then(() => {
    sync();
    bambooCloud?.auth.onAuthStateChange((event,session) => {
      if(event !== 'INITIAL_SESSION' && session?.user.id !== activeUserId){
        setTimeout(() => { if(!busy && session?.user.id !== activeUserId) sync(); },0);
      }
    });
  });
}

function setupPublishedRoutes(store,render){
  const status = document.getElementById('published-status');
  const button = document.getElementById('published-refresh');
  const refresh = async () => {
    button.disabled = true;
    status.textContent = '正在读取已审核路标…';
    try{
      await store.refresh();
      render();
      status.textContent = `已读取 ${store.load().length} 条已审核路标。`;
    }catch(error){
      status.textContent = '暂时无法读取云端路标，请重试。';
      console.warn('Could not load published routes',error);
    }finally{
      button.disabled = false;
    }
  };
  button.addEventListener('click',refresh);
  return refresh();
}
