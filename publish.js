'use strict';
// Reliable Pawlido Instagram publisher for GitHub Actions.
const fs=require('fs'),path=require('path');
const PLAN=path.join(__dirname,'ig_plan.json'), SF=path.join(__dirname,'ig_scheduled.json');
const A=process.argv.slice(2), DRY=A.includes('--dry'), VALIDATE=A.includes('--validate');
const CHECK_AUTH=A.includes('--check-auth');
const INDEX=A.includes('--index')?Number(A[A.indexOf('--index')+1]):null;
const FORCE=A.includes('--force'), MIN_GAP=Number(process.env.MIN_GAP_MIN||120)*60000;
const VERSION=process.env.GRAPH_VERSION||'v26.0';
const BASE=(process.env.MEDIA_BASE||(process.env.GITHUB_REPOSITORY?
  'https://cdn.jsdelivr.net/gh/'+process.env.GITHUB_REPOSITORY+'@'+(process.env.GITHUB_REF_NAME||'main')+'/media':''))
  .replace(/\/+$/,'');
const log=m=>console.log(new Date().toISOString()+' '+m);
const read=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}};
function atomic(f,v){const t=f+'.tmp';fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n');fs.renameSync(t,f)}
const key=p=>p.kind+':'+p.code+':'+p.day+'T'+p.time+'+04';
function loadState(){const raw=read(SF,{});if(!Array.isArray(raw))return raw;
  const s={version:2,records:{}};for(const old of raw)s.records['legacy:'+old]={status:'legacy',at:null};return s}
function validate(P,needBase=true){const errors=[],seen=new Set();
  if(!P||!Array.isArray(P.plan))errors.push('ig_plan.json has no plan array');
  for(const [i,p] of (P?.plan||[]).entries()){
    const k=key(p);if(seen.has(k))errors.push('duplicate '+k);seen.add(k);
    if(!new RegExp('\\b'+p.code+'\\b','i').test(p.caption||''))errors.push('#'+i+' caption lacks code '+p.code);
    if(!Array.isArray(p.media)||!p.media.length)errors.push('#'+i+' has no media');
    for(const f of p.media||[]){if(!fs.existsSync(path.join(__dirname,'media',f)))errors.push('missing media/'+f)}
  }
  if(needBase&&!BASE)errors.push('MEDIA_BASE or GITHUB_REPOSITORY is required for publishing');
  if(errors.length)throw new Error('validation failed:\n- '+errors.join('\n- '));
  return {posts:P.plan.length,unique:seen.size};
}
async function api(endpoint,body){const r=await fetch('https://graph.instagram.com/'+VERSION+endpoint,{
  method:body?'POST':'GET',headers:{Authorization:'Bearer '+process.env.IG_TOKEN,
  'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const j=await r.json().catch(()=>({}));if(!r.ok||j.error)throw new Error(r.status+' '+JSON.stringify(j.error||j).slice(0,500));return j}
async function waitReady(id,label){for(let i=0;i<48;i++){await new Promise(r=>setTimeout(r,5000));
  const s=await api('/'+id+'?fields=status_code,status');if(s.status_code==='FINISHED')return;
  if(['ERROR','EXPIRED'].includes(s.status_code))throw new Error(label+' '+s.status_code+' '+(s.status||''));
  if(i%6===0)log(label+' '+s.status_code)}throw new Error(label+' processing timed out')}
async function recentMatch(code){const j=await api('/'+process.env.IG_USER_ID+'/media?fields=id,caption,timestamp&limit=50');
  const rx=new RegExp('\\b'+code+'\\b','i');return (j.data||[]).find(x=>rx.test(x.caption||''))||null}
async function publish(p,i){const urls=p.media.map(f=>BASE+'/'+f),k=key(p);
  if(DRY){log('DRY #'+i+' '+k);urls.forEach(u=>log('  '+u));return {id:null,dry:true}}
  const found=await recentMatch(p.code);if(found){log('RECOVERED '+p.code+' as '+found.id);return {id:found.id,recovered:true}}
  log('PUBLISH #'+i+' '+p.kind+' '+p.code);let creation;
  if(p.kind==='REEL'){
    creation=(await api('/'+process.env.IG_USER_ID+'/media',{media_type:'REELS',video_url:urls[0],caption:p.caption,share_to_feed:true})).id;
    await waitReady(creation,'reel');
  }else{
    const kids=[];for(const u of urls)kids.push((await api('/'+process.env.IG_USER_ID+'/media',{image_url:u,is_carousel_item:true})).id);
    creation=(await api('/'+process.env.IG_USER_ID+'/media',{media_type:'CAROUSEL',children:kids,caption:p.caption})).id;
    await waitReady(creation,'carousel');
  }
  const out=await api('/'+process.env.IG_USER_ID+'/media_publish',{creation_id:creation});log('PUBLISHED '+out.id);return {id:out.id,recovered:false}
}
(async()=>{
  const P=read(PLAN,null),check=validate(P,!DRY&&!VALIDATE&&!CHECK_AUTH);if(VALIDATE){console.log(JSON.stringify(check));return}
  if(!DRY&&(!process.env.IG_TOKEN||!process.env.IG_USER_ID))throw new Error('IG_TOKEN and IG_USER_ID are required');
  if(CHECK_AUTH){
    const me=await api('/me?fields=id,username,account_type');
    const expectedUser=process.env.EXPECTED_IG_USERNAME||'pawlido.store';
    log('AUTH IDENTITY '+(me.username||'unknown')+' '+(me.id||'unknown')+' '+(me.account_type||''));
    if(String(me.id)!==String(process.env.IG_USER_ID))throw new Error('Instagram user ID mismatch');
    if(String(me.username||'').toLowerCase()!==expectedUser.toLowerCase())throw new Error('Instagram username mismatch');
    log('AUTH OK '+me.username+' '+me.id+' '+(me.account_type||''));return;
  }
  const S=loadState();S.version=2;S.records=S.records||{};
  const done=p=>S.records[key(p)]?.status==='published';
  let i=INDEX;
  if(i!==null){if(!Number.isInteger(i)||!P.plan[i])throw new Error('invalid --index');if(done(P.plan[i])&&!FORCE){log('already complete '+key(P.plan[i]));return}}
  else{
    const latest=Object.values(S.records).filter(x=>x.status==='published'&&x.at).map(x=>Date.parse(x.at)).filter(Number.isFinite).sort((a,b)=>b-a)[0];
    if(latest&&Date.now()-latest<MIN_GAP){log('waiting for safe gap');return}
    i=P.plan.findIndex(p=>!done(p)&&new Date(p.day+'T'+p.time+':00+04:00').getTime()<=Date.now());
    if(i<0){log('nothing due');return}
  }
  const p=P.plan[i],result=await publish(p,i);if(DRY)return;
  const at=new Date().toISOString();S.records[key(p)]={status:'published',at,mediaId:result.id,recovered:!!result.recovered,code:p.code};
  p.publishedId=result.id;p.publishedAt=at;p.recovered=!!result.recovered;atomic(PLAN,P);atomic(SF,S);
})().catch(e=>{console.error('ERROR '+e.message);process.exit(1)});
