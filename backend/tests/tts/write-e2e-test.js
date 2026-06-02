import { writeFileSync } from 'fs';

const test = `/**
 * 全 TTS 引擎真实端到端测试
 * 运行: cd backend && external/node/node.exe --test tests/tts/e2e-real.test.js
 */
import { describe, it, before, after } from 'node:test';

const B = 'http://127.0.0.1:3001', A = B + '/api', V = B + '/v1';
async function G(p){const r=await fetch(A+p);if(!r.ok)throw Error('GET '+p+'->'+r.status);return r.json()}
async function P(p,b){const r=await fetch(A+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error('POST '+p+'->'+r.status+': '+JSON.stringify(d));return d}
async function S(p,b){const r=await fetch(V+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return{res:r,buf:Buffer.from(await r.arrayBuffer())}}
async function U(p,fd){const r=await fetch(A+p,{method:'POST',body:fd});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error('POST '+p+'->'+r.status);return d}
async function W(fn,iv,to){let s=Date.now();while(Date.now()-s<to){try{let r=await fn();if(r)return r}catch{}await new Promise(r=>setTimeout(r,iv))}throw Error('poll timeout '+to+'ms')}
function Ck(b){if(b.length<44)return{ok:false,reason:'small:'+b.length+'B'};if(b.toString('ascii',0,4)!=='RIFF')return{ok:false,reason:'no RIFF'};if(b.toString('ascii',8,12)!=='WAVE')return{ok:false,reason:'no WAVE'};let ds=b.readUInt32LE(40),br=b.readUInt32LE(28);if(br<=0)return{ok:false,reason:'byteRate=0'};return{ok:true,sampleRate:b.readUInt32LE(24),channels:b.readUInt16LE(22),bitDepth:b.readUInt16LE(34),duration:ds/br,totalSize:b.length}}
function ok(c,m){if(!c)throw Error('FAIL: '+m)}
function Wav(sr,dur){let ns=sr*dur,ds=ns*2,h=Buffer.alloc(44);h.write('RIFF',0);h.writeUInt32LE(36+ds,4);h.write('WAVE',8);h.write('fmt ',12);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(sr,24);h.writeUInt32LE(sr*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(ds,40);return Buffer.concat([h,Buffer.alloc(ds)])}

async function E(et,vc,vm,sr){let wss=await G('/tts-studio/workspaces');let ws=wss.find(w=>w.engine_type===et&&(w.voice_id||w.active_voice_id));if(ws){console.log('  ['+et+'] reuse: '+ws.name+' model='+ws.model_id);return{wsId:ws.id,mId:ws.model_id,vId:ws.active_voice_id||ws.voice_id,created:false}}let vid='';if(vm.includes('clone')){let f=new FormData();f.append('file',new Blob([Wav(sr,3)]),'e2e.wav');let r=await U('/tts-studio/reference-audios',f);vid=r.voice_id}let f2=new FormData();f2.append('name','E2E-'+et+'-'+Date.now());f2.append('engine_type',et);f2.append('voice_mode',vm[0]);if(vid)f2.append('voice_id',vid);f2.append('params','{}');let w=await U('/tts-studio/workspaces',f2);console.log('  ['+et+'] created: model_id='+w.model_id);return{wsId:w.id,mId:w.model_id,vId:vid,created:true}}

function makeTest(et,en,vm,fm,sr){
  describe(en+' ('+et+')',function(){
    let wsId,mId,vId,created,hasClone=vm.includes('clone');
    before(async function(){console.log('\n=== '+et+' ('+en+') ===');let d=await E(et,false,vm,sr);wsId=d.wsId;mId=d.mId;vId=d.vId;created=d.created});
    after(async function(){if(created&&wsId)try{await fetch(A+'/tts-studio/workspaces/'+wsId,{method:'DELETE'})}catch(e){}});
    it(et+' 1. start -> running',{timeout:600000},async function(){console.log('['+et+'] starting...');try{await P('/tts-studio/engines/'+encodeURIComponent(et)+'/stop')}catch(e){}await P('/tts-studio/engines/'+encodeURIComponent(et)+'/start');let r=await W(async()=>{try{let h=await G('/tts/health');let eng=h.engines[et];return eng&&eng.status==='running'}catch{return false}},3000,600000);ok(r,et+' running')});
    it(et+' 2. synth -> WAV',{timeout:300000},async function(){if(hasClone&&!vId){console.log('['+et+'] SKIP: no voice');return}let b={model:mId,input:'hello world e2e test.',voice:vId,response_format:'wav'};let r=await S('/audio/speech',b);ok(r.res.ok,'HTTP '+r.res.status);let w=Ck(r.buf);ok(w.ok,w.reason);ok(w.duration>0,'dur='+w.duration);console.log('['+et+'] synth: '+w.sampleRate+'Hz '+w.duration.toFixed(2)+'s '+w.totalSize+'B')});
    if(fm.length>=2){it(et+' 3. format: '+fm[1],{timeout:300000},async function(){let b={model:mId,input:'Format test.',voice:vId,response_format:fm[1]};let r=await S('/audio/speech',b);ok(r.res.ok,'HTTP '+r.res.status);ok(r.buf.length>0,fm[1]+' size: '+r.buf.length+'B');console.log('['+et+'] '+fm[1]+': '+r.buf.length+'B')})}
    it(et+' 4. empty -> 400',async function(){let r=await fetch(V+'/audio/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:mId,input:'',voice:vId})});ok(r.status===400,'status='+r.status)});
    it(et+' 5. history',async function(){let h=await G('/tts/history?workspace_id='+wsId+'&page_size=5');if(h.items.length>0){ok(h.items[0].status==='completed','status='+h.items[0].status);console.log('['+et+'] history: '+h.total+' records')}});
  });
}

makeTest('indextts2','IndexTTS-2',['clone','preset'],['wav','mp3','flac'],22050);
makeTest('indextts1.5','IndexTTS-1.5',['clone','preset'],['wav','mp3','flac','opus'],24000);
makeTest('omnivoice','OmniVoice',['design','auto'],['wav','mp3','flac','pcm'],24000);

describe('Global',function(){
  it('GET /v1/audio/models',async function(){let r=await fetch(V+'/audio/models');ok(r.ok,'HTTP '+r.status);let b=await r.json();ok(b.data.length>0,'models: '+b.data.length);console.log('[E2E] '+b.data.length+' models')});
  it('GET /v1/audio/voices',async function(){let r=await fetch(V+'/audio/voices');ok(r.ok,'HTTP '+r.status);let b=await r.json();ok(b.data.length>0,'voices: '+b.data.length);console.log('[E2E] '+b.data.length+' voices')});
  it('GET /v1/health',async function(){let r=await fetch(V+'/health');ok(r.ok,'HTTP '+r.status);let b=await r.json();ok(b.status==='ok','status='+b.status);console.log('[E2E] /v1/health: '+JSON.stringify(b))});
});
`;

writeFileSync('D:/TTS/novamax/backend/tests/tts/e2e-real.test.js', test);
console.log('Written, ' + test.length + ' bytes');
