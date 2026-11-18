const bambooCloud = window.supabase?.createClient(
  'https://jhxelbxhczkdajscmbxz.supabase.co',
  'sb_publishable_xr117kWt8EX9eID6idCjTw_iXk5IHxI'
);

const routeFields = 'id,place,summary,recorder,path_status,audio_path,before_path,after_path,created_at,status';
const reviewFields = `${routeFields},reviewed_at`;
const routeBucket = 'bamboo-route-media';
const routeStatus = {pending:'待审核', approved:'已通过', rejected:'未通过'};
const mediaLabels = {audio:'现场原声', before:'清理前', after:'清理后'};

let cloudSession = null;
let publishedRoutes = [];
let routeLoadError = '';
let publicRoutesRequest;
let initializingCloud;

function initCloud(){
  if(initializingCloud) return initializingCloud;
  initializingCloud = (async () => {
    if(!bambooCloud) return;
    const {data, error} = await bambooCloud.auth.getSession();
    if(error) console.warn('Could not restore the session',error);
    cloudSession = data?.session ?? null;
    bambooCloud.auth.onAuthStateChange((_event, session) => { cloudSession = session; });
  })();
  return initializingCloud;
}

function refreshRoutes(){
  if(publicRoutesRequest) return publicRoutesRequest;
  publicRoutesRequest = (async () => {
    try{
      await initCloud();
      if(!bambooCloud) throw new Error('Cloud client unavailable');
      const {data, error} = await bambooCloud.from('route_marks').select(routeFields)
        .eq('status','approved').order('id',{ascending:false});
      if(error) throw error;
      publishedRoutes = data.map(row => ({
        id:Number(row.id), place:row.place, summary:row.summary, recorder:row.recorder,
        createdAt:Date.parse(row.created_at), tags:[], uses:0, verified:0, score:0,
        status:'unknown', hasAudio:true, blindPath:{status:row.path_status},
        cloudMedia:{audio:row.audio_path,before:row.before_path,after:row.after_path}
      }));
      routeLoadError = '';
    }catch(error){
      routeLoadError = '云端路标暂时无法读取，请重试。';
      console.warn('Could not load published routes', error);
    }finally{
      publicRoutesRequest = null;
    }
  })();
  return publicRoutesRequest;
}

function validateRouteMedia(file, kind){
  const type = file.type.split(';')[0].toLowerCase();
  const allowed = kind === 'audio'
    ? ['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-wav','audio/x-m4a','audio/aac','audio/flac','video/webm','video/mp4']
    : ['image/jpeg','image/png','image/webp','image/heic','image/heif'];
  if(!file.size || file.size > 25 * 1024 * 1024 || !allowed.includes(type)){
    throw new Error(kind === 'audio' ? '请选择 25 MB 以内的 MP3、M4A、WAV、WebM 或 Ogg 录音。' : '请选择 25 MB 以内的 JPEG、PNG、WebP 或 HEIC 照片。');
  }
  return type;
}

async function submitCloudRoute(draft, recorder){
  const user = cloudSession?.user;
  if(!user || !bambooCloud) throw new Error('请登录后提交。');
  draft.submissionId ||= crypto.randomUUID();
  const {data:existing,error:lookupError} = await bambooCloud.from('route_marks').select('id')
    .eq('submission_id',draft.submissionId).eq('owner_id',user.id).maybeSingle();
  if(lookupError) throw lookupError;
  if(existing) return existing.id;

  const bucket = bambooCloud.storage.from(routeBucket);
  const files = {audio:draft.audio,before:draft.photos.before,after:draft.photos.after};
  const types = Object.fromEntries(Object.entries(files).filter(([,file]) => file)
    .map(([kind,file]) => [kind,validateRouteMedia(file,kind)]));
  const paths = {};
  const uploads = draft.uploads ||= new Map();
  for(const [kind,file] of Object.entries(files)){
    if(!file) continue;
    const contentType = types[kind];
    const previous = uploads.get(kind);
    if(previous && previous.file !== file){
      if(previous.uploaded) await bucket.remove([previous.path]);
      uploads.delete(kind);
    }
    if(!uploads.has(kind)){
      const path = `${user.id}/${draft.submissionId}/${kind}-${crypto.randomUUID()}`;
      uploads.set(kind,{file,path,uploaded:false});
    }
    const upload = uploads.get(kind);
    if(!upload.uploaded){
      const {error} = await bucket.upload(upload.path,file,{contentType,cacheControl:'60'});
      if(error && String(error.status ?? error.statusCode) !== '409') throw error;
      upload.uploaded = true;
    }
    paths[kind] = upload.path;
  }

  const {data,error} = await bambooCloud.from('route_marks').insert({
    submission_id:draft.submissionId, place:draft.place.trim(), summary:draft.summary.trim(), recorder,
    path_status:draft.path.status || 'unknown', audio_path:paths.audio,
    before_path:paths.before ?? null, after_path:paths.after ?? null,
    ...draft.capture
  }).select('id').single();
  if(error?.code === '23505'){
    const {data:submitted,error:readError} = await bambooCloud.from('route_marks').select('id')
      .eq('submission_id',draft.submissionId).eq('owner_id',user.id).single();
    if(readError) throw readError;
    return submitted.id;
  }
  if(error) throw error;
  return data.id;
}

async function signRouteMedia(paths){
  const files = Object.entries(paths).filter(([,path]) => Boolean(path));
  const {data,error} = await bambooCloud.storage.from(routeBucket)
    .createSignedUrls(files.map(([,path]) => path),300);
  if(error) throw error;
  const urls = new Map(data.filter(file => file.signedUrl).map(file => [file.path,file.signedUrl]));
  return Object.fromEntries(files.map(([kind,path]) => [kind,urls.get(path)]));
}

async function getReviewQueue(){
  const {data:reviewer,error:roleError} = await bambooCloud.rpc('is_route_reviewer');
  if(roleError) throw roleError;
  if(!reviewer) return null;
  const {data,error} = await bambooCloud.from('route_marks').select(reviewFields)
    .eq('status','pending').order('id').limit(50);
  if(error) throw error;
  return data;
}

async function getOwnRoutes(){
  const {data,error} = await bambooCloud.from('route_marks').select(reviewFields)
    .eq('owner_id',cloudSession.user.id).order('id',{ascending:false}).limit(50);
  if(error) throw error;
  return data;
}

async function discardDraftUploads(draft){
  if(draft.stage === 4 || !draft.uploads?.size || !cloudSession) return;
  const paths = [...draft.uploads.values()].map(upload => upload.path);
  const {error} = await bambooCloud.storage.from(routeBucket).remove(paths);
  if(error) console.warn('Could not remove abandoned uploads',error);
  else draft.uploads.clear();
}

async function updateReview(id,status){
  const {data,error} = await bambooCloud.from('route_marks').update({status})
    .eq('id',id).eq('status','pending').select('id').maybeSingle();
  if(error) throw error;
  return Boolean(data);
}
