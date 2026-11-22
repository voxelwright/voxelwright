import{a as ge}from"./chunk-2F74LXFG.js";var Vt=t=>[parseInt(t.slice(1,3),16)/255,parseInt(t.slice(3,5),16)/255,parseInt(t.slice(5,7),16)/255],Fn={enamel:{day:"#0e22ff",night:"#2b3dff",jitter:.018},signal:{day:"#fff600",night:"#fff600",jitter:.025,glow:1},chalk:{day:"#fbfcff",night:"#3a4692",jitter:.006},floor:{day:"#fbfcff",night:"#3a4692",jitter:.006},slate:{day:"#c3c9de",night:"#222963",jitter:.012},"spun-brass":{day:"#ba9765",night:"#b18f61",jitter:.002,grain(t,e){let n=t+.5,o=e+.5,r=Math.hypot(n,o);return .22*((.86*n-.51*o)/r)**6-.045+.015*Math.sin(r*2.6)}},"warm-metal":{day:"#d4b383",night:"#ac895b",jitter:.003},gasket:{day:"#565447",night:"#151c21",jitter:.008},steel:{day:"#aab1c9",night:"#33375a",jitter:.018},ivory:{day:"#fbfcff",night:"#ccd1f2",jitter:.006},walnut:{day:"#7c4a29",night:"#5a3520",jitter:.03,grain:(t,e,n)=>.05*Math.sin(e*2.4+Math.sin(t*.35+n)*1.7)},leaf:{day:"#23a84b",night:"#2ec25c",jitter:.06},stem:{day:"#5c8f2f",night:"#6aa53a",jitter:.04},soil:{day:"#3d2a20",night:"#2a1c15",jitter:.07},petal:{day:"#ff5c8a",night:"#ff6f98",jitter:.04},brick:{day:"#d42c18",night:"#ff5340",jitter:.025},lamp:{day:"#fff3c4",night:"#ffe9a0",jitter:.01,glow:1},ink:{day:"#0a0f3d",night:"#eceefb",jitter:0,seamless:!0},light:{day:"#388de6",night:"#458fe3",jitter:0,glow:1},"light-warm":{day:"#f1d9a8",night:"#c9a264",jitter:0,glow:.5},"light-go":{day:"#12b556",night:"#35e07a",jitter:0,glow:1},caution:{day:"#ac6615",night:"#efb664",jitter:0,glow:.55},"light-stop":{day:"#f0442e",night:"#ff5a44",jitter:0,glow:1},lens:{day:"#7a766c",night:"#14171b",jitter:.004},"stop-wash":{day:"#d39c86",night:"#3a1d1c",jitter:.004},key:{day:"#fffefa",night:"#2b3046",jitter:.004},"pointer-edge":{day:"#191b27",night:"#04050a",jitter:0}},X={},Gt={n:0},Qe={},be=0;for(let[t,e]of Object.entries(Fn))X[t]={name:t,id:be,day:Vt(e.day),night:Vt(e.night),jitter:e.jitter??.02,glow:e.glow??0,grain:e.grain??null,seamless:!!e.seamless,hex:e},Qe[be]=X[t],be++;function bt(t,e){let n=X[t],o=n?n.id:Object.keys(X).length;return X[t]={name:t,id:o,day:Vt(e.day),night:Vt(e.night??e.day),jitter:e.jitter??.02,glow:e.glow??0,grain:e.grain??null,seamless:!!e.seamless,hex:e},Qe[o]=X[t],Gt.n++,X[t]}var It={day:{toLight:$e([-.5,-.7,.6]),sun:.9,ambient:{top:.64,front:.485,side:.33,under:.26},ambientTint:[.9,.93,1],highlight:[1,1,.98],shadow:[.04,.07,.38,.3],seam:.05,glow:0},night:{toLight:$e([-.5,-.7,.6]),sun:.62,ambient:{top:.78,front:.646,side:.36,under:.3},ambientTint:[.82,.86,1],highlight:[.8,.85,1],shadow:[0,0,.05,.55],seam:.08,glow:1}};function $e(t){let e=Math.hypot(t[0],t[1],t[2]);return[t[0]/e,t[1]/e,t[2]/e]}function Z(t,e,n){let o=t*374761393+e*668265263+n*2147483647|0;return o=(o^o>>>13)*1274126177,o^=o>>>16,(o>>>0)/4294967295}var O=null,lt=null,pt=null,Rt=!1,ye=0;function to(t){ye!==t&&(ye=t,pt&&pt.gain.setTargetAtTime(t,O.currentTime,.012))}var Kt=new Map,Et=null,we=null,ke=0;function eo(t){return Et||(Et=Promise.all(["press","release"].map(async e=>{let n=await fetch(new URL(`./audio/${e}.wav`,import.meta.url));if(!n.ok)throw new Error(`Switch audio: ${n.status}`);Kt.set(e,await t.decodeAudioData(await n.arrayBuffer()))})).catch(()=>{Et=null}),Et)}function rr(){if(Et||Kt.size===2)return;let t=window.OfflineAudioContext||window.webkitOfflineAudioContext;t&&eo(new t(1,1,44100))}function xe(t,e){let n=Kt.get(t);if(!n){et(e,t==="press"?175:320,.03,.18);return}let o=O.createBufferSource();o.buffer=n,o.connect(pt),o.onended=()=>o.disconnect(),o.start(e)}function Nn(){if(O)return O;let t=window.AudioContext||window.webkitAudioContext;return t?(O=new t({latencyHint:"interactive"}),lt=O.createGain(),lt.gain.value=.32,lt.connect(O.destination),pt=O.createBiquadFilter(),pt.type="highshelf",pt.frequency.value=2450,pt.gain.value=ye,pt.connect(lt),O):null}function et(t,e,n=.07,o=.5,r=.7){let s=O.createOscillator(),a=O.createGain(),c=e*(.94+Math.random()*.12);s.type="sine",s.frequency.setValueAtTime(c,t),s.frequency.exponentialRampToValueAtTime(c*r,t+n),a.gain.setValueAtTime(1e-4,t),a.gain.exponentialRampToValueAtTime(o,t+.004),a.gain.exponentialRampToValueAtTime(1e-4,t+n),s.connect(a).connect(lt),s.start(t),s.stop(t+n+.02)}function Je(t,e=.12,n=.2){let o=Math.floor(O.sampleRate*e),r=O.createBuffer(1,o,O.sampleRate),s=r.getChannelData(0);for(let l=0;l<o;l++)s[l]=(Math.random()*2-1)*Math.pow(1-l/o,2);let a=O.createBufferSource(),c=O.createBiquadFilter(),i=O.createGain();a.buffer=r,c.type="bandpass",c.frequency.value=900+Math.random()*500,c.Q.value=.8,i.gain.value=n,a.connect(c).connect(i).connect(lt),a.start(t)}var oo={press:t=>xe("press",t),release:t=>xe("release",t),slide:t=>{et(t,240,.05,.35,.7),et(t+.11,330,.05,.3,.8)},tick:t=>et(t,760,.025,.14,.9),detent:t=>Kt.has("release")?xe("release",t):oo.tick(t),build:t=>{for(let e=0;e<9;e++)et(t+.03+e*.04*(1-e*.04),420+e*55,.035,.16,.85)},break:t=>{Je(t,.22,.3);for(let e=0;e<6;e++)et(t+e*.03,520-e*50,.04,.16,.7)},poke:t=>{Je(t,.1,.22),et(t,150,.09,.5,.5)},done:t=>{et(t,520,.09,.3,.98),et(t+.1,780,.14,.3,.98)},failed:t=>{et(t,300,.12,.3,.7),et(t+.13,210,.18,.3,.7)}};function Cn(t){return t===void 0||(Rt=!!t,Rt&&Nn()?(lt.gain.setValueAtTime(.32,O.currentTime),O.state==="suspended"&&(we=O.resume().catch(()=>{})),eo(O)):(ke++,lt&&lt.gain.setValueAtTime(0,O.currentTime))),Rt}function N(t){let e=oo[t];if(!Rt||!O||!e||document.hidden)return;if(O.state==="running")return e(O.currentTime+.001);if(O.state!=="suspended"||!we)return;let n=performance.now(),o=ke;we.then(()=>{O.state==="running"&&Rt&&o===ke&&!document.hidden&&performance.now()-n<120&&e(O.currentTime+.001)})}function In(t,e,n){let o=e*.73+.8*Math.sin(t*.031)+.42*Math.sin(t*.047+e*.11)+n*.23;return .022*Math.sin(o)+.009*Math.sin(o*4.2)}var J=(t,e=0)=>({chamfer:t,specular:e}),Xt={walnut:{name:"Walnut",treble:-3,plate:"#b98c65",ground:"#efece3",mat:"#355347",panel:"#e3d8be",grain:In,face:J(35,12),night:{ground:"#151a17",mat:"#16231d",panel:"#262b26"}},alloy:{name:"Anodized",treble:2,plate:"#445964",ground:"#26323a",mat:"#253e4e",panel:"#40545c",dark:!0,face:J(140,122),night:{ground:"#10171b",mat:"#0f1a21",panel:"#24323a"}},smoke:{name:"Smoke",treble:-1.5,plate:"#49505c",ground:"#25242d",mat:"#433e53",panel:"#363b49",dark:!0,transmission:.23,face:J(195,138),night:{ground:"#131218",mat:"#1c1a24",panel:"#272a34"}},frost:{name:"Frost",treble:-1,plate:"#ece9dd",ground:"#e5e9e5",mat:"#4c6560",panel:"#e3e7dd",transmission:.36,face:J(100,44),night:{ground:"#131918",mat:"#1d2a28",panel:"#283130"}},clear:{name:"Clear",treble:0,plate:"#c4e4df",ground:"#dfe8e7",mat:"#365b62",panel:"#d2e4dc",transmission:.56,face:J(220,145),night:{ground:"#10191b",mat:"#172629",panel:"#253234"}}},Me={field:{name:"Ridgeline PBT",key:"#e9dfc5",legend:"#352c23",face:J(48,16)},linen:{name:"Parchment",key:"#eee4cd",legend:"#352c23",face:J(48,16)},carbon:{name:"Carbon PBT",key:"#393f3f",legend:"#f7ead4",face:J(66,14)},opal:{name:"Opal",key:"#c8dfdf",legend:"#152c32",transmission:.24,face:J(130,90)}},ve={amber:{name:"Amber",hue:"#ffb45f"},tide:{name:"Tide",hue:"#71e2cd"},lilac:{name:"Lilac",hue:"#d5b0ff"},ember:{name:"Ember",hue:"#ff9479"}};function Se(t,e=!1){let n=Xt[t];if(e){let r=n.night;return{"--vx-look":"instrument","--vx-theme":"night","--mat":r.mat,"--vx-ground":r.ground,"--vx-chalk":n.plate,"--vx-ink":"#ece6d6","--vx-ink-quiet":"#c9c3b2","--vx-floor":"#0e110f","--panel":r.panel,"--vx-slate":"#3a403b","--vx-steel":"#5d5b52","--vx-knob":"#d8c5a1","--vx-enamel":"var(--lit-cap-night,#b9562f)","--vx-signal":"var(--lit-accent)","--vx-focus":"#ffb58f","--vx-shadow":"rgb(0 0 0 / 0.55)","--vx-danger-text":"#ffc2b5","--vx-link":"var(--lit-link-night,#9db8ff)","--vx-on-enamel":"#fff8e8","--lit-accent":"var(--lit-accent-night,#458fe3)","--lit-warm":"#c9a264","--lit-go":"#5fe894","--lit-stop":"#ff7a66","--lit-night":"1"}}let o=n.dark?"#fbf5e9":"#262b25";return{"--vx-look":"instrument","--vx-theme":"day","--mat":n.mat,"--vx-ground":n.ground,"--vx-chalk":n.plate,"--vx-ink":o,"--vx-ink-quiet":n.dark?"#e0e7e5":"#3e4037","--vx-floor":n.dark?"#313b40":"#d4cbb5","--panel":n.panel,"--vx-steel":"#a79d88","--vx-knob":"#d8c5a1","--vx-enamel":"var(--lit-cap-day,#aa4a27)","--vx-signal":"var(--lit-accent)","--vx-focus":n.dark?"#ffb58f":"#b95329","--vx-danger-text":n.dark?"#ffd4c9":"#85261c","--vx-link":n.dark?"var(--lit-link-night,#9db8ff)":"var(--lit-link-day,#1f40c4)","--vx-on-enamel":"#fff8e8"}}var no=t=>[parseInt(t.slice(1,3),16)/255,parseInt(t.slice(3,5),16)/255,parseInt(t.slice(5,7),16)/255],Ot={rise:4,travel:3,step:1,slab:2,float:4,dialog:6,well:2,groove:1,round:2,icons:null,inlay:!1,seam:1,grain:1,quiet:!1,materials:{},light:null,parts:{}},rt={default:Ot};function zt(t,e={}){let n=rt[e.from]??Ot,o={...n,...e,materials:{...n.materials,...e.materials},parts:{...n.parts,...e.parts}};return delete o.from,delete o._table,delete o._rev,delete o._lights,rt[t]=o,o}function Ae(t){return rt[t.getPropertyValue("--vx-look").trim()]??Ot}function so(t){if(t._table&&t._rev===Gt.n)return t._table;let e=Object.keys(X),n=[];for(let o of e){let r=X[o],s=t.materials[o];n[r.id]=s?{...r,day:s.day?no(s.day):r.day,night:s.night?no(s.night):r.night,jitter:s.jitter??r.jitter,glow:s.glow??r.glow,grain:s.grain??r.grain,transmission:s.transmission??0}:r}return t._table=n,t._rev=Gt.n,n}function ro(t,e){let n=t.light?.[e];return t.seam===1&&!n?It[e]:(t._lights??={})[e]??={...It[e],...n,seam:(n?.seam??It[e].seam)*t.seam}}var z=()=>typeof matchMedia=="function"&&matchMedia("(prefers-reduced-motion: reduce)").matches,_t=class{constructor(e=0,n=170,o=26){this.x=e,this.v=0,this.target=e,this.k=n,this.c=o}to(e,n,o){return this.target=e,n!==void 0&&(this.k=n),o!==void 0&&(this.c=o),this}snap(e){return this.x=e,this.target=e,this.v=0,this}step(e){let n=Math.min(e,.064);for(;n>0;){let o=Math.min(n,.004),r=-this.k*(this.x-this.target)-this.c*this.v;this.v+=r*o,this.x+=this.v*o,n-=o}return Math.abs(this.x-this.target)<.002&&Math.abs(this.v)<.02?(this.x=this.target,this.v=0,!1):!0}get moving(){return this.x!==this.target||this.v!==0}},D={k:1500,c:76},On=.51,j={k:1e3,c:2*Math.sqrt(1e3)*On},$={k:420,c:30},H={k:170,c:26},zn=(t,e=1.25)=>1+(e+1)*Math.pow(t-1,3)+e*Math.pow(t-1,2),_n=t=>1-Math.pow(1-t,4),xt=t=>t<0?0:t>1?1:t;function Dn(t,e,n,o,r,s){let a=Math.hypot(n,o,r)||1,c=Math.sin(s/2)/a;t[e]=n*c,t[e+1]=o*c,t[e+2]=r*c,t[e+3]=Math.cos(s/2)}function Ee(t,e){let n=t.count,o=t.rest,r=new Int32Array(n),s=new Map,a=[];for(let l=0;l<n;l++){let u=Math.floor(o[l*3+1]/e),d=Math.floor((o[l*3]+(u&1?e/2:0))/e),f=u*4096+d,g=s.get(f);g===void 0&&(g=a.length,s.set(f,g),a.push([0,0,0,0,d,u])),r[l]=g;let m=a[g];m[0]+=o[l*3],m[1]+=o[l*3+1],m[2]+=o[l*3+2],m[3]++}let c=new Float32Array(a.length*3),i=new Int32Array(a.length*2);return a.forEach((l,u)=>{c[u*3]=l[0]/l[3],c[u*3+1]=l[1]/l[3],c[u*3+2]=l[2]/l[3],i[u*2]=l[4],i[u*2+1]=l[5]}),{of:r,centre:c,cell:i,count:a.length}}var Re=(t,e)=>Math.max(2,Math.min(7,Math.round(Math.min(t,e)/2.6)));function Te(t,e={}){let n=t.count,o=t.rest,r=e.W,s=e.H,a=e.top;if(r===void 0||a===void 0){r=1,s=1,a=1;for(let b=0;b<n;b++)r=Math.max(r,o[b*3]+.5),s=Math.max(s,o[b*3+1]+.5),a=Math.max(a,o[b*3+2]+.5)}let c=e.brick??Re(r,s),i=Ee(t,c),l=e.each??.17,u=Math.max(l,e.duration??.4),d=e.from??[0,s],f=new Float32Array(i.count),g=0,m=Math.max(Math.hypot(d[0],d[1]),Math.hypot(r-d[0],d[1]),Math.hypot(d[0],s-d[1]),Math.hypot(r-d[0],s-d[1]))||1;for(let b=0;b<i.count;b++){let x=(i.centre[b*3]-d[0])/m,w=(i.centre[b*3+1]-d[1])/m;f[b]=Math.hypot(x*.55,w),g=Math.max(g,f[b])}let p=1/0;for(let b=0;b<i.count;b++)p=Math.min(p,f[b]);let h=u-l;for(let b=0;b<i.count;b++)f[b]=(e.delay??0)+h*Math.pow(g>p?(f[b]-p)/(g-p):0,.8);let y=a+.5;return{kind:"assemble",t:0,end:(e.delay??0)+u,write(b,x,w){let M=this.t;for(let k=0;k<n;k++,x+=8){let v=xt((M-f[i.of[k]])/l),S=v<=0?0:zn(v,1.35);b[x]=o[k*3]+w.tx,b[x+1]=o[k*3+1]+w.ty,b[x+2]=o[k*3+2]+w.tz-y*(1-S),b[x+3]=1,b[x+4]=0,b[x+5]=0,b[x+6]=0,b[x+7]=1}return M>=this.end}}}function Pe(t,e={}){let n=t.count,o=t.rest,r=e.W,s=e.H;if(r===void 0){r=1,s=1;for(let b=0;b<n;b++)r=Math.max(r,o[b*3]+.5),s=Math.max(s,o[b*3+1]+.5)}let a=Ee(t,e.brick??Re(r,s)),c=e.duration??.34,i=e.seed??7,l=e.from??[r/2,0],u=new Float32Array(a.count*3),d=new Float32Array(a.count*3),f=new Float32Array(a.count),g=new Float32Array(a.count),m=Math.hypot(r,s)||1;for(let b=0;b<a.count;b++){let x=a.cell[b*2],w=a.cell[b*2+1],M=Z(x+i,w,1),k=Z(x,w+i,2),v=Z(x,w,3+i);u[b*3]=(M-.5)*26,u[b*3+1]=-4-k*14,u[b*3+2]=5+v*14,d[b*3]=k-.5,d[b*3+1]=v-.5,d[b*3+2]=(M-.5)*.6,g[b]=(v-.5)*11,f[b]=.1*Math.hypot(a.centre[b*3]-l[0],a.centre[b*3+1]-l[1])/m+k*.02}let p=1/0;for(let b=0;b<a.count;b++)p=Math.min(p,f[b]);for(let b=0;b<a.count;b++)f[b]-=p;let h=300,y=[0,0,0,1];return{kind:"crumble",t:0,end:c+.1,write(b,x,w){let M=this.t;for(let k=0;k<n;k++,x+=8){let v=a.of[k],S=Math.max(0,M-f[v]),R=xt(S/c);Dn(y,0,d[v*3],d[v*3+1],d[v*3+2],g[v]*S);let A=o[k*3]-a.centre[v*3],E=o[k*3+1]-a.centre[v*3+1],L=o[k*3+2]-a.centre[v*3+2],P=y[1]*L-y[2]*E+y[3]*A,I=y[2]*A-y[0]*L+y[3]*E,U=y[0]*E-y[1]*A+y[3]*L,q=1-_n(xt((R-.7)/.3));b[x]=a.centre[v*3]+w.tx+u[v*3]*S+(A+2*(y[1]*U-y[2]*I))*q,b[x+1]=a.centre[v*3+1]+w.ty+u[v*3+1]*S+.5*h*S*S+(E+2*(y[2]*P-y[0]*U))*q,b[x+2]=Math.max(.5,a.centre[v*3+2]+w.tz+u[v*3+2]*S+(L+2*(y[0]*I-y[1]*P))*q),b[x+3]=q,b[x+4]=y[0],b[x+5]=y[1],b[x+6]=y[2],b[x+7]=y[3]}return M>=this.end}}}function ao(t,{W:e,H:n,top:o,duration:r,from:s,rim:a,still:c,out:i,start:l,previousRelease:u,contactPose:d}){let f=!!d||(l>0&&l<1?u??!1:i&&l===1),g=Math.max(.001,(c?.12:r)*Math.abs((i?0:1)-l)),m=a?3:Re(e,n),p=c?null:Ee(t,m),h=p?.count??0,y=new Float32Array(h),b=new Float32Array(h),x=new Float32Array(h),w=new Float32Array(h),M=f&&!a&&!c,k=M?new Float32Array(4*h):null,[v,S]=s,R=Math.hypot(Math.max(v,e-v),Math.max(S,n-S))||1;for(let A=0;A<h;A++){let E=p.cell[A*2],L=p.cell[A*2+1],P=(E+.5)*m-(L&1)*m/2,I=(L+.5)*m,U=Z(E,L,19),q=Math.min(1,Math.hypot(P-v,I-S)/R);y[A]=(f?.55:.34)*q+.08*U;let tt=Math.min(P,e-P,I,n-I)<m;b[A]=a?tt?2.5:0:o+1,x[A]=(U-.5)*(a?1.6:6)}return{kind:i?"crumble":"assemble",t:0,end:g,from:s,still:c,rim:a,release:f,get progress(){return l+((i?0:1)-l)*xt(this.t/g)},write(A,E){let L=d?1-xt(this.t/g):this.progress;for(let P=0;P<h;P++){let I=xt(((f?1-L:L)-y[P])/(1-y[P]));if(w[P]=b[P]?f?I:(1-I)**2:0,M){let U=x[P]*.22*I;k[P*4]=Math.cos(U),k[P*4+1]=Math.sin(U),k[P*4+2]=Math.sin(U/2),k[P*4+3]=Math.cos(U/2)}}for(let P=0;P<t.count;P++,E+=8){let I=p?.of[P],U=c?0:w[I];if(A[E]=t.rest[P*3]+t.tx+(c?0:x[I]*U),A[E+1]=t.rest[P*3+1]+t.ty,A[E+2]=t.rest[P*3+2]+t.tz-(c?0:b[I]*U),A[E+3]=t.scales?.[P]??1,A[E+4]=A[E+5]=A[E+6]=0,A[E+7]=1,M){let q=t.rest[P*3+1]-(p.cell[I*2+1]+.5)*m,tt=t.rest[P*3+2]-o/2,G=k[I*4]-1,Ct=k[I*4+1];A[E+1]+=G*q-Ct*tt+3*U,A[E+2]+=Ct*q+G*tt,A[E+4]=k[I*4+2],A[E+7]=k[I*4+3]}if(d){let q=P*8,tt=1-U;if(U===0)for(let G=0;G<8;G++)A[E+G]=d[q+G];else{A[E]+=tt*(d[q]-t.rest[P*3]-t.tx),A[E+1]+=tt*(d[q+1]-t.rest[P*3+1]-t.ty),A[E+2]+=tt*(d[q+2]-t.rest[P*3+2]-t.tz);let G=Math.atan2(d[q+4],d[q+7]);if(G){let Ct=Math.atan2(A[E+4],A[E+7])+tt*G;A[E+4]=Math.sin(Ct),A[E+7]=Math.cos(Ct)}}}}return this.t>=g}}}function io(t,e={}){let n=t.count,o=t.rest,r=e.duration??.16,s=!!e.out;return{kind:s?"crumble":"assemble",t:0,end:r,write(a,c,i){let l=xt(this.t/r),u=s?1-l:l;for(let d=0;d<n;d++,c+=8)a[c]=o[d*3]+i.tx,a[c+1]=o[d*3+1]+i.ty,a[c+2]=o[d*3+2]+i.tz,a[c+3]=u,a[c+4]=0,a[c+5]=0,a[c+6]=0,a[c+7]=1;return this.t>=this.end}}}var Dt=2.7777777777777777,T=t=>t/Dt,Yt=-.02,W=t=>t.theme==="day"?2.6:1,yt=t=>t.theme==="day"?1.5:2.1;function B(t,e="light"){let n=t.dataset.vxLight;return n==="go"?"light-go":n==="stop"?"light-stop":n==="warm"?"light-warm":n==="accent"?"light":e}function Zt(t){let e=t.dataset.vxKind,n=t.dataset.vxMaterial;return e==="main"||n==="enamel"?"main":e==="danger"||n==="brick"?"danger":"plain"}function _(t,e,n,o,r,s,a,c=0){return t.slab(e,n,o,r,s,1,a,c).carve(e+1,n+1,o,r-2,s-2,1),t}function at(t,e,n,o,r,s,a,c,i=1){if(a>=2&&r>=5&&s>=5){t.slab(e,n,o,r,s,a-1,c,i);let l=c==="key"&&Math.min(r,s)<=9?0:1;t.slab(e+l,n+1,o+a-1,r-2*l,s-2,1,c,i)}else t.slab(e,n,o,r,s,a,c,i);return t}function Tt(t,e,n,o,r,s,a="light",c=-1){let i=t.model,l=Math.max(1,Math.min(r-2,Math.max(3,Math.round(r/2)))),u=n+Math.floor((r-l)/2),d=o+s-2,f=c<0?d+1:d;i.part("guide"+e).slab(u-1,d-1,c-1,l+2,3,1,"gasket",1);let m=i.part("lens"+e);m.box(u,f,c,l,1,1,"ivory"),m.plot(u,f,c,a),m.plot(u+l-1,f,c,a);let p=i.part("tongue"+e);p.slab(u-1,f-1,c+1,l+2,2,1,"slate",1);let h,y;return b=>{let x=Math.max(0,Math.min(1,b));if(!(x===h&&t.tintRevision===y)){h=x,y=t.tintRevision,p.ty=-2*x,p.tz=-2*x,m.tint(t.theme,t.look);for(let w=0;w<m.col.length;w+=4){for(let M=w;M<w+3;M++)m.col[M]=.12+(m.col[M]-.12)*x;m.col[w+3]*=x}}}}function Pt(t,e,n,o,r){let{W:s,H:a,look:c}=t,i=Math.min(s,a)<9,l=n||i?1:c.rise+(o==="enamel"?2:0);e.keyTravel=Math.min(c.travel,Math.max(0,l-1));let u=e.part("cap");if(n)u.slab(0,0,0,s,a,1,"steel",1);else if(i){let d=a>2?1:0,f=a-2*d;C(t,e,{y:d,h:f,depth:2,wall:"gasket",floor:"slate"}),_(e.part("socket"),-1,0,0,s+2,a,"steel");let g=e.part("light");if(g.sunk=!0,_(g,0,d,-1,s,f,r),u.grounded=!1,u.sunk=!0,u.slab(0,d,0,s,f,1,o,Math.min(s,f)>2?1:0),c.tooling&&t.el.hasAttribute("data-vx-step")&&f>=3)return u.slab(0,d,1,s,f,1,o,1),u.box(1,d+1,2,s-2,f-2,1,o),t.state.top=t.faceZ=3,e.keyTravel=2,u;e.keyTravel=1}else if(_(e.part("socket"),-1,-1,0,s+2,a+2,"gasket",2),_(e.part("light"),0,0,0,s,a,c.tooling&&r==="light"?"backlight":r,1),u.grounded=!1,c.tooling&&s>=10&&a>=10&&l>=3){let d=l>=5,f=d?2:1,g=l-2;u.slab(0,0,1,s,a,Math.max(1,g-1),o,2),u.slab(1,1,g,s-2,a-2,1,o,2);let m=t.el.offsetLeft/t.vx;for(let p=f;p<s-f;p++){let h=d&&(p<f+2||p>=s-f-2),y=(m+p)*t.vx,b=a*(.74+.072*Math.sin(y*.025)+.038*Math.sin(y*.066));for(let x=2;x<a-2;x++){let w=o==="key"&&c.artwork&&x>=b;u.plot(p,x,l-1,w?x>b+2?"cap-ridge":"cap-inlay":o),h&&u.plot(p,x,l,w?"cap-ridge":o)}}}else at(u,0,0,1,s,a,l-1,o);return t.state.top=t.faceZ=l,u}function $t(t,e,n,o=0){t.glowStrength=T(.026)*W(t)*(1+e*1.2+n*2.6+o*1.3),t.glowRadius=2.3+n*.8}function wt(t,e,n,o,r,s,a="light"){return t.box(e,n,0,o,r,1,s?a:"lens"),t}function co(t,e,n,o){t.part("collar").slab(-1,-1,0,e+2,n+2,2,"steel",1).carve(0,0,0,e,n,2);let r=t.part("lamp");r.box(0,0,0,e,n,3,o),r.plot(0,0,2,"ivory")}function kt(t,e,n,o,r,{by:s=r<=8||o<=8?1:2,mat:a="steel",name:c="bezel"}={}){let i=t.part(c);return i.slab(e-s,n-s,0,o+s*2,r+s*2,2,a,1).carve(e,n,0,o,r,2),_(i,e-1,n-1,1,o+2,r+2,"slate"),i}function C(t,e,{x:n=0,y:o=0,w:r=t.W,h:s=t.H,depth:a=t.look.well,wall:c="slate",floor:i="floor"}={}){let l=e.part("walls");l.sunk=!0;let u=c==="light-warm"&&i==="floor"&&r>2&&s>2?"slate":c;l.box(n-1,o-1,-a,r+2,s+2,a,u).carve(n,o,-a,r,s,a),l.tz=Yt;let d=e.part("floor");return d.sunk=!0,d.box(n-1,o-1,-a-1,r+2,s+2,1,i),t.well=[n,o,n+r,o+s],t.faceZ=0,{walls:l,floor:d}}function Y(t,e="vx-label"){let n=t.querySelector(`:scope > .${e}`);if(n)return n;n=document.createElement("span"),n.className=e;for(let o of[...t.childNodes])o.nodeType===1&&o.classList.contains("vx-canvas")||n.append(o);return t.append(n),n}function F(){let t=[],e=(n,o,r,s)=>{n.addEventListener(o,r,s),t.push(()=>n.removeEventListener(o,r,s))};return e.watch=(n,o,r)=>{let s=new MutationObserver(r);s.observe(n,o),t.push(()=>s.disconnect())},e.heed=(n,o,r)=>{t.push(Hn(n,o,r))},e.done=()=>{for(let n of t)n()},e}function it(t,e,n){for(let o=t.closest("fieldset");o;o=o.parentElement?.closest("fieldset"))e.watch(o,{attributes:!0,attributeFilter:["disabled"]},n)}var ot=(t,e,n)=>t<e?e:t>n?n:t;function Hn(t,e,n){let o=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(t),e);return!o?.set||Object.hasOwn(t,e)?()=>{}:(Object.defineProperty(t,e,{configurable:!0,enumerable:o.enumerable,get(){return o.get.call(this)},set(r){let s=o.get.call(this);o.set.call(this,r),o.get.call(this)!==s&&n()}}),()=>{delete t[e]})}var ct=12;function Le(t,e,{side:n="bottom",align:o="start",gap:r=8,lift:s=0}={}){let a=e.getBoundingClientRect(),c=t.offsetWidth,i=t.offsetHeight,l=document.documentElement.clientWidth,u=window.innerHeight,d=o==="start"!=(getComputedStyle(e).direction==="rtl"),f=o==="center"?a.left+a.width/2-c/2:d?a.left:a.right-c;if(o!=="center"&&(f<ct||f+c>l-ct)){let w=d?a.right-c:a.left;w>=ct&&w+c<=l-ct&&(f=w)}f=Math.round(Math.max(ct,Math.min(f,l-ct-c)));let g=a.bottom+r+s,m=a.top-r-i,p=g+i<=u-ct,h=m>=ct,y=n==="top"?h||!p?m:g:p||!h?g:m,b=Math.round(t.matches('.vx-menu, [data-vx-fitting="service"]')?Math.max(ct,Math.min(y,u-ct-i)):y);return t.style.margin="0",t.style.inset=`${b}px auto auto ${f}px`,[Math.abs(f-a.left)<1?0:Math.abs(f+c-a.right)<1?c:Math.max(0,Math.min(c,a.left+a.width/2-f)),b<a.top?i:0]}function fo(t){t.visible=!0;let e=t.rebuild();for(let[n,o]of t.stage.lives)n===t.el||!t.el.contains(n)||(o.visible=!0,n.offsetWidth!==o.cssW||n.offsetHeight!==o.cssH?o.rebuild():o.invalidate());return e}function Wn(t,e){let{W:n,H:o,el:r}=t,s=t.look.float;_(e.part("light"),0,0,0,n,o,B(r,"light"),1);let a=e.part("body");a.grounded=!1,a.slab(0,0,1,n,o,s-1,t.look.readingPlate??"key",1),t.faceZ=s}function Bn(t,e){let{W:n,H:o}=t,r=e.part("body");if(r.slab(1,1,0,n-2,o-2,1,"gasket",2),r.slab(0,0,1,n,o,2,"chalk",2),r.slab(1,1,3,n-2,o-2,1,t.look.readingPlate??"key",1),n>=24){let s=getComputedStyle(t.el).direction==="rtl"?n-17:5;r.box(s,0,2,12,1,1,"gasket"),t.state.pipeX=s+1,r.box(s+1,0,2,10,1,1,"backlight")}t.state.litRevision=null,t.faceZ=4}function Un(t){if(t.state.litRevision===t.tintRevision)return;t.state.litRevision=t.tintRevision;let e=t.state.pipeX;if(e==null||!t.look.dimmer)return;let o=2+4*(t.look.materials.chalk?.transmission??0),r=[1,3,5].map(a=>parseInt(t.look.illuminant.slice(a,a+2),16)/255),s=t.model.byName.body;for(let a=0;a<s.count;a++){let c=s.rest[a*3],i=s.rest[a*3+1],l=s.rest[a*3+2];if(i>o||l<1||s.col[a*4+3]>0)continue;let u=Math.hypot(Math.max(e-c,0,c-e-10),i,l-2.5);if(u>=o)continue;let d=t.look.dimmer*.34*(1-u/o)**2;for(let f=0;f<3;f++){let g=a*4+f;s.col[g]+=(r[f]-s.col[g])*d}}}var ut=new Map,lo=()=>{for(let[t,e]of ut)t.isConnected&&t.matches(":popover-open")?e():ut.delete(t);ut.size||Qt(!1)};function Qt(t){let e=t?"addEventListener":"removeEventListener";window[e]("resize",lo),window[e]("scroll",lo,{capture:!0,passive:!0})}function ho(t,e,n,o=.12,r="rim",s){if(!t)return;let a=t.el,c,i=()=>{delete a.dataset.vxNativeExit;for(let l of["display","x","y","w","h"])a.style.removeProperty("--vx-exit-"+l)};e(a,"beforetoggle",l=>{let u=c=Symbol();if(i(),l.newState==="open"||!t.model)return;if(a.matches("[popover], .vx-dialog")&&a.style.setProperty("--vx-exit-display",getComputedStyle(a).display),a.matches("dialog.vx-dialog")){let f=a.getBoundingClientRect();for(let[g,m]of Object.entries({x:f.x,y:f.y,w:f.width,h:f.height}))a.style.setProperty("--vx-exit-"+g,m+"px")}a.dataset.vxNativeExit="";let d=typeof n=="function"?n():{parts:n,surface:r,from:s?.()};t.play("crumble",d.parts,{duration:d.closeDuration??o,surface:d.surface,from:d.from}).then(()=>{u===c&&(i(),t.clearSurface())})})}function qn(t,e,n,{trigger:o,side:r="bottom",align:s="start",gap:a=2,duration:c=.18,surface:i="rim",release:l=.12,still:u}={}){let d=()=>n?.vx??(parseFloat(getComputedStyle(t).getPropertyValue("--vx"))||4),f,g=()=>{let p=o();if(!p)return null;let h=Le(t,p,{side:t.dataset.vxSide||r,align:t.dataset.vxAlign||s,gap:a*d(),lift:n?n.faceZ*d()/2:0}),y=h[1]>0;return n&&n.state.above!==y&&(n.state.above=y,n.invalidate()),f=h.map(b=>b/d()),h},m=["body","panel","light"];return ho(n,e,m,l,i,i==="courses"?()=>f:void 0),e(t,"beforetoggle",p=>{if(p.newState!=="open")return;t.setAttribute("data-vx-measure","");let h=g();if(n){let y=fo(n);h&&!u?.()&&n.play("assemble",m,{surface:i,resume:y,from:f,duration:c})}t.removeAttribute("data-vx-measure")}),e(t,"toggle",p=>{if(p.newState!=="open"){ut.delete(t),ut.size||Qt(!1);return}ut.size||Qt(!0),ut.set(t,g)}),t.matches(":popover-open")&&(g(),ut.size||Qt(!0),ut.set(t,g)),g}var Ht=t=>t.id?[...document.querySelectorAll(`[popovertarget="${CSS.escape(t.id)}"]:not([popovertargetaction="hide"])`)]:[];function uo(t,e,n){if(!t.showPopover)return;let o=null;for(let s of Ht(t))s.hasAttribute("aria-expanded")||s.setAttribute("aria-expanded",String(t.matches(":popover-open")));e(t,"beforetoggle",s=>{let a=Ht(t);s.newState==="open"&&(o=a.includes(s.source)?s.source:a[0]??null);for(let c of a)c.setAttribute("aria-expanded",String(s.newState==="open"&&c===o))});let r=t.dataset.vxFitting==="service"?{gap:1,surface:"courses",duration:.24,release:.16}:{};qn(t,e,n,{trigger:()=>o??Ht(t)[0],...r}),e(t,"toggle",s=>{for(let a of Ht(t))a.setAttribute("aria-expanded",String(s.newState==="open"&&a===o))}),e(t,"focusout",s=>{let a=s.relatedTarget;t.popover==="manual"||!a||t.contains(a)||Ht(t).includes(a)||a.closest(":popover-open")||t.matches(":popover-open")&&t.hidePopover()})}var gr={name:"popover",selector:".vx-popover",pad:11,glowRadius:2.2,glowStrength:T(.15),build(t,e){t.el.dataset.vxFitting==="service"?Bn(t,e):Wn(t,e)},pose(t){t.glowStrength=T(t.theme==="day"?.04:.025),t.el.dataset.vxFitting==="service"&&Un(t)},bind(t){let e=F();return uo(t.el,e,t),e.watch(t.el,{attributes:!0,attributeFilter:["data-vx-light"]},()=>t.rebuild()),e.done},plain(t,e){uo(t,e,null)}};function po(t,e){let n,o,r=!1;e(t,"keydown",s=>{o=s.key==="Escape"?s:null}),e(t,"keyup",()=>{o=null}),e(t,"cancel",s=>{n=s,setTimeout(()=>{n===s&&(n=null,o=null)},0)}),e(t,"beforetoggle",s=>{let a=s.newState==="closed"&&n?.eventPhase===Event.NONE&&!n.defaultPrevented;r=a&&o?.eventPhase===Event.NONE&&!o.defaultPrevented,a&&(t.returnValue="cancel"),n=o=null}),e.watch(t,{attributes:!0,attributeFilter:["open"]},()=>{!t.open&&r&&!t.returnValue&&(t.returnValue="cancel"),r=!1}),e(t,"click",s=>{if(s.defaultPrevented)return;let a=s.target.closest("[data-vx-close]");a?(s.preventDefault(),t.close(a.value||a.dataset.vxClose||"")):s.target===t&&t.hasAttribute("data-vx-light-dismiss")&&t.close("cancel")})}var Jt=new WeakMap;function K({el:t,W:e}){return getComputedStyle(t).direction==="rtl"?(n,o=1)=>e-n-o:n=>n}function Q(t,e){let n=getComputedStyle(t.el).direction;e.watch(t.el.getRootNode(),{attributes:!0,subtree:!0,attributeFilter:["dir"]},o=>{if(!o.some(({target:s})=>s.contains(t.el)))return;let r=getComputedStyle(t.el).direction;r!==n&&(n=r,t.rebuild())})}function jn(t){return getComputedStyle(t).direction==="rtl"?["ArrowLeft","ArrowRight"]:["ArrowRight","ArrowLeft"]}function Vn(t,e,n){let o,r=()=>o??(t.id?document.querySelector(`[popovertarget="${CSS.escape(t.id)}"]`):null),s=()=>{if(t.offsetHeight>innerHeight-24&&!t.querySelector(":scope > .vx-menu-rows")){let c=document.createElement("div");c.className="vx-menu-rows";let i=[...t.childNodes].filter(u=>!u.classList?.contains("vx-canvas")),l=t.contains(document.activeElement)?document.activeElement:null;t.append(c);for(let u of i)c.append(u);l?.focus({preventScroll:!0}),l&&(c.scrollTop=Math.max(0,l.offsetTop+l.offsetHeight-c.clientHeight))}let a=r();return a?Le(t,a,{gap:n()}):[0,0]};return e(t,"beforetoggle",a=>{a.newState==="open"&&(o=a.source)}),e.watch(t.getRootNode(),{attributes:!0,subtree:!0,attributeFilter:["dir"]},a=>{if(!t.matches(":popover-open"))return;let c=r();c&&a.some(({target:i})=>i.contains(c))&&s()}),e(window,"resize",()=>{t.matches(":popover-open")&&r()&&s()}),{invoker:r,put:s}}function mo(t,e){t.forEach((n,o)=>{n.setAttribute("aria-selected",o===e?"true":"false"),n.tabIndex=o===e?0:-1;let r=document.getElementById(n.getAttribute("aria-controls"));r&&(r.hidden=o!==e)})}function Ne(t,e,n,[o,r]){return t===o?(e+1)%n:t===r?(e-1+n)%n:t==="Home"?0:t==="End"?n-1:-1}var Fe=t=>t&&!t.matches(':disabled, [aria-disabled="true"]');function Gn(t,e,n){if(!["Home","End","ArrowDown","ArrowUp"].includes(t))return null;let o=e.length,r=t==="End"||t==="ArrowUp",s=t==="Home"||t==="End"?-1:e.indexOf(n);s<0&&r&&(s=0);for(let a=0;a<o;a++)if(s=(s+(r?-1:1)+o)%o,Fe(e[s]))return e[s];return null}var go=[[".vx-tabs",(t,e)=>{let n=()=>[...t.querySelectorAll(':scope > [role="tab"]')],o=()=>Math.max(0,n().findIndex(s=>s.getAttribute("aria-selected")==="true")),r=s=>{s===o()&&n()[s]?.getAttribute("aria-selected")==="true"||(mo(n(),s),t.dispatchEvent(new CustomEvent("vx-change",{bubbles:!0,detail:{index:s}})))};mo(n(),o()),e(t,"click",s=>{let a=s.target.closest('[role="tab"]');a&&r(n().indexOf(a))}),e(t,"keydown",s=>{let a=Ne(s.key,o(),n().length,jn(t));a<0||(s.preventDefault(),r(a),n()[a].focus())})}],["dialog.vx-dialog",po],[".vx-menu",(t,e)=>{let n=()=>[...t.querySelectorAll('[role^="menuitem"]')],{invoker:o,put:r}=Vn(t,e,()=>12);e(t,"toggle",s=>{let a=o();a?.setAttribute("aria-expanded",String(s.newState==="open")),!(s.newState!=="open"||!a)&&(r(),a.matches(":focus-visible")&&n().find(Fe)?.focus())}),e(t,"keydown",s=>{let a=Gn(s.key,n(),document.activeElement);a&&(s.preventDefault(),a.focus())}),e(t,"click",s=>{if(!Fe(s.target.closest('[role^="menuitem"]')))return;let a=o();t.hidePopover?.(),a?.focus()})}]];function Ce(t,e){go.push([t,e])}function Ie(t=document,e=!0){for(let n of go){let[o,r]=n,s=e&&t.querySelectorAll?[...t.querySelectorAll(o)]:[];t.matches?.(o)&&s.unshift(t);for(let a of s){if(a.hasAttribute("data-vx-live"))continue;let c=Jt.get(a);if(c||Jt.set(a,c=new Map),c.has(n))continue;let i=F(),l=r(a,i);c.set(n,()=>{typeof l=="function"&&l(),i.done()})}}}function bo(t){for(let e of Jt.get(t)?.values()??[])e();Jt.delete(t)}var nt=7,te={name:"toggle",selector:".vx-switch:not(.ship-latch)",pad:6,build(t,e){let{W:n,H:o}=t,r=t.state.input=t.el.parentElement.querySelector("input"),s=r?.disabled;e.part("tray").slab(0,0,0,n,o,1,s?"steel":"slate",1);let a=e.part("lit");a.masked=!0,a.grounded=!1,a.covered=!0,a.slab(1,1,1,n-2,o-2,1,"signal",1);let c=e.part("knob");c.grounded=!1,c.slab(0,0,1,nt,o-2,3,s?"steel":"ivory",1),c.ty=1,t.faceZ=1,t.state.inlineX=K(t),t.state.travel=n-2-nt;let i=t.spring("at",r?.checked?1:0,$.k,$.c);i.moving||i.snap(r?.checked?1:0)},pose(t){let{knob:e,lit:n}=t.model.byName,o=t.spring("at").x,r=1+o*t.state.travel;e.tx=t.state.inlineX(r,nt),e.tz=t.spring("press").x;let s=r+nt/2;for(let a=0;a<n.count;a++){let c=t.state.inlineX(n.rest[a*3],0);n.scales[a]=o<=.001?0:Math.max(0,Math.min(1,s-c+.5))}},bind(t){let e=F();Q(t,e);let n=t.el.parentElement.querySelector("input"),o=t.spring("at",n.checked?1:0,$.k,$.c),r=t.spring("press"),s=!1;return e(n,"keydown",()=>{s=!0}),e(n,"pointerdown",()=>{s=!1,r.to(-1,D.k,D.c),t.invalidate()}),e(t.el.parentElement,"pointerdown",()=>{s=!1,r.to(-1,D.k,D.c),t.invalidate()}),e(window,"pointerup",()=>{r.target!==0&&(r.to(0,j.k,j.c),t.invalidate())}),e(n,"change",()=>{s?o.snap(n.checked?1:0):o.to(n.checked?1:0),N("slide"),t.invalidate()}),e.heed(n,"checked",()=>{o.snap(n.checked?1:0),t.invalidate()}),e.watch(n,{attributes:!0,attributeFilter:["disabled"]},()=>t.rebuild()),e.done}};var Kn=["..PPP..",".PPPPP.","PPPCPPP","PPCCCPP","PPPCPPP",".PPPPP.","..PPP.."],xo=["petal","signal","ivory","enamel","brick"];function Oe(t,e={}){let n=e.x??0,o=e.base??0,r=e.z??2,s=e.seed??1,a=e.height??17,c=b=>Z(s*13+b,s*7-b,b*3+s);t.masked=!0,t.plot(n,o-1,r,"walnut",0),t.plot(n+1,o-1,r,"walnut",0);let i=(c(1)-.5)*2.2,l=c(2)*6.28,u=b=>n+Math.round(Math.sin(b*.33+l)*i*Math.min(1,b/6)),d=b=>.1+.62*(b/a),f=n;for(let b=0;b<a;b++){let x=u(b),w=o-1-b;t.plot(x,w,r,"stem",d(b)),x!==f&&t.plot(f,w,r,"stem",d(b)),f=x}let g=c(3)>.5?1:-1;for(let b=2,x=0;b<a-2;b+=2+(x%3===2?1:0),x++){let w=3+Math.floor(c(10+x)*2.6)+(b>a*.55?0:2),M=r+(x%2?1:-1)*(c(20+x)>.3?1:0),k=u(b),v=o-1-b;for(let S=1;S<=w;S++){let R=Math.round(S*(.45+c(30+x)*.3)),A=d(b)+.04+.13*(S/w);t.plot(k+g*S,v-R,M,"leaf",A),S>1&&S<w&&t.plot(k+g*S,v-R-1,M,"leaf",A+.015),S>1&&S<w-1&&t.plot(k+g*S,v-R,M+1,"leaf",A+.03),w>4&&S>2&&S<w-1&&t.plot(k+g*S,v-R+1,M,"leaf",A+.045)}g=-g}let m=u(a-1),p=o-a;for(let b=-1;b<=1;b++)for(let x=-1;x<=1;x++)for(let w=0;w<=1;w++)b&&x||t.plot(m+b,p-1+x,r+w,"stem",.7+.08*(1-x)/2);let h=e.petal??xo[Math.floor(c(40)*xo.length)],y=h==="signal"?"walnut":"signal";for(let b=0;b<7;b++)for(let x=0;x<7;x++){let w=Kn[b][x];if(w===".")continue;let M=Math.hypot(x-3,b-3),k=m-3+x,v=p-4+b,S=.875+.075*(M/3.2);t.plot(k,v,r+2,h,S),M<2.3&&t.plot(k,v,r+3,h,S+.01),w==="C"&&t.plot(k,v,r+4,y,.9)}return{top:[m,p-4,r+2],height:a+4}}function ze(t,e,n,o,r=7,s="brick"){return t.box(e-1,n,o,r+2,2,5,s),t.box(e,n+2,o,r,4,5,s),t.carve(e,n,o+1,r,1,3),t.box(e,n,o+1,r,1,3,"soil"),t}var yo=t=>{let e=t.querySelector("progress, meter");if(!e)return Number(t.dataset.vxValue||0);let n=Number(e.getAttribute("max")||e.max||1),o=Number(e.getAttribute("min")||0);return ot((Number(e.getAttribute("value")??e.value)-o)/(n-o||1),0,1)},ee={name:"meter",selector:".vx-meter",pad:8,build(t,e){let{W:n,H:o,el:r}=t,s=t.state.growth=r.dataset.vxKind==="growth",a=yo(r),c=t.spring("v",a,H.k,H.c);if(t.state.built===void 0&&c.snap(a),t.state.built=!0,t.state.posed=!1,s){let l=Math.floor((n-7)/2),u=o-6;ze(e.part("pot"),l,u,0,7,r.dataset.vxPot||"brick");let d=e.part("plant");d.grounded=!1,Oe(d,{x:l+3,base:u,z:2,seed:Number(r.dataset.vxSeed||1),height:Math.max(8,Math.min(22,u-6)),petal:r.dataset.vxPetal}),t.faceZ=0}else{let i=Math.floor((o-5)/2);e.part("rail").slab(0,i,0,n,5,2,"steel",1).carve(1,i+1,1,n-2,3,1),e.part("floor").box(1,i+1,0,n-2,3,1,"slate");let l=e.part("fill");l.grounded=!1;let u=K(t),d=n-2;for(let f=0;f<d;f++)for(let g=0;g<3;g++)for(let m=1;m<=2;m++)l.plot(u(1+f),i+1+g,m,r.dataset.vxMaterial||"leaf",(f+.5)/d);t.faceZ=2}},pose(t){t.state.posed||(t.state.posed=!0,ee.step(t,0))},step(t,e){let n=t.spring("v").x;return(t.state.growth?t.model.byName.plant:t.model.byName.fill).grow(n+1e-4,e)},bind(t){let e=F();Q(t,e);let n=()=>{t.spring("v").to(yo(t.el)),t.invalidate()};return e.watch(t.el,{attributes:!0,subtree:!0,attributeFilter:["value","max","data-vx-value"]},n),e.watch(t.el,{attributes:!0,attributeFilter:["data-vx-kind","data-vx-seed","data-vx-petal","data-vx-pot"]},()=>t.rebuild()),e.done}};function _e(t,e,n,o=t.H){let r=t.el.dataset.vxEdge;if(!r)return;let s=t.look.round,a=e.part("spine");a.grounded=!1,a.box(K(t)(0,s),s,n,s,o-s*2,1,r)}var wo={name:"card",selector:".vx-card",pad:7,build(t,e){let{W:n,H:o}=t,r=e.part("body"),s=t.look.slab;r.slab(0,0,0,n,o,s,"chalk",t.look.round),_e(t,e,s),t.faceZ=s},bind(t){let e=F();return Q(t,e),e.watch(t.el,{attributes:!0,attributeFilter:["data-vx-edge"]},()=>t.rebuild()),e.done}};var oe={chevron:["#.....#",".#...#.","..#.#..","...#..."],plus:["..#..","..#..","#####","..#..","..#.."],check:["......#",".....##","#...##.","##.##..",".###...","..#...."],cross:["#...#",".#.#.","..#..",".#.#.","#...#"],drop:["..#..",".###.",".###.","#####","#####","#####",".###."],seed:[".##..","####.","#####",".####","..##."]};function De(t,e,n,o){let{W:r,H:s,el:a,look:c}=t,i=(c.icons??oe)[a.dataset.vxIcon];if(!i)return;let l=K(t),u=r-i[0].length-(c.icons?2:5),d=Math.round((s-i.length)/2);for(let f=0;f<i.length;f++)for(let g=0;g<i[f].length;g++)i[f][g]==="#"&&e.plot(l(u+g),d+f,n,o)}var Mo=t=>t.getAttribute("aria-expanded")==="true"||t.getAttribute("aria-pressed")==="true";function ko(t,e,{push:n,lift:o,momentary:r}={}){let s=null,a=i=>{s!==null||t.matches(':disabled, [aria-disabled="true"]')||(s=i,n?.(),N("press"))},c=(i,l)=>{s===null||s!==i||(s=null,!(!r&&Mo(t))&&(o?.(),l&&!t.matches(':disabled, [aria-disabled="true"]')&&N("release")))};return e(t,"pointerdown",i=>{i.button===0&&a(i.pointerId)}),e(t,"pointermove",i=>{i.pointerType==="mouse"&&!(i.buttons&1)&&c(i.pointerId,!0)}),e(t,"pointerup",i=>c(i.pointerId,!0)),e(t,"pointercancel",i=>c(i.pointerId,!1)),e(t,"pointerleave",i=>c(i.pointerId,!1)),e(t,"keydown",i=>{r&&i.repeat&&i.key==="Enter"&&i.preventDefault(),!i.repeat&&(i.key===" "||i.key==="Enter")&&a(i.key)}),e(t,"keyup",i=>c(i.key,!0)),e(t,"blur",()=>c(s,!1)),e(window,"blur",()=>c(s,!1)),()=>{s=null}}var Wt={name:"button",selector:".vx-button:not([data-lamp])",pad:7,build(t,e){let{W:n,H:o,el:r}=t,s=r.matches(":disabled")||r.getAttribute("aria-disabled")==="true",a=s?"steel":r.dataset.vxMaterial||"enamel",c=t.look,i=s?1:c.rise,l=Math.min(c.step,i-1),u=e.part("cap");s?u.slab(0,0,0,n,o,1,a,1):l?(u.slab(0,0,0,n,o,i-1,a,1),u.slab(l,l,i-1,n-l*2,o-l*2,1,a,1)):u.slab(0,0,0,n,o,i,a,1);let d=t.theme==="night",f=a==="enamel"||a==="walnut"||a==="brick"&&!d?"ivory":a==="brick"?"slate":"ink";De(t,u,c.inlay?i-1:i,s?"slate":f),t.state.off=s,t.state.top=i,t.faceZ=i,t.label(r.querySelector(":scope > .vx-label"),()=>t.state.top+u.tz)},pose(t){let e=t.model.byName.cap;e.tz=t.state.off?0:t.spring("press").x+t.spring("hover").x},bind(t){let e=t.el,n=F();Q(t,n),Y(e);let o=t.spring("press"),r=t.spring("hover"),s=()=>t.model.keyTravel??Math.min(t.look.travel,Math.max(0,(t.state.top??t.look.rise)-1)),a=(l,u)=>{z()?o.snap(l):o.to(l,u.k,u.c),t.invalidate()},c=t.def.momentary,i=ko(e,n,{momentary:c,push(){let l=-s();o.x=Math.min(o.x,l*.36),a(l,D)},lift:()=>a(0,j)});return it(e,n,()=>{e.matches(":disabled")&&(i(),o.snap(0),r.snap(0)),t.rebuild()}),n(e,"pointerenter",l=>{!c&&l.pointerType==="mouse"&&!t.state.off&&!z()&&(r.to(.5,H.k*2,H.c*1.4),t.invalidate())}),n(e,"pointerleave",()=>{r.to(0,H.k*2,H.c*1.4),t.invalidate()}),n.watch(e,{attributes:!0,attributeFilter:["disabled","aria-disabled","data-vx-material","data-vx-kind","data-vx-light","data-vx-icon","aria-expanded","aria-pressed"]},l=>{if(l.some(d=>d.attributeName!=="aria-expanded"&&d.attributeName!=="aria-pressed"))return e.matches(':disabled, [aria-disabled="true"]')&&(i(),o.snap(0),r.snap(0)),t.rebuild();if(c)return t.invalidate();let u=Mo(e);i(),a(u?-s():0,u?D:j)}),n.done},plain:ko};function Xn(t){let e={};for(let n of t.replace(/\r/g,"").split(/\n\s*\n/)){let o=n.split(`
`).map(i=>i.trimEnd()).filter(i=>i.length);if(!o.length)continue;let r=o[0].match(/^(space|\S)(?:\s+(-?\d+))?$/u);if(!r)throw new Error("bad glyph header: "+o[0]);let s=r[1]==="space"?" ":r[1],a=o.slice(1),c=Math.max(...a.map(i=>i.length));e[s]={ch:s,y:Number(r[2]||0),w:c,rows:a.map(i=>i.padEnd(c,"."))}}return e}function Mt(t){let e=typeof t.src=="string"?Xn(t.src):t.glyphs,n={gap:1,space:2,lineGap:3,descent:0,xHeight:t.cap,upper:!1,maxKern:1,kern:{},...t,glyphs:e};delete n.src;for(let[s,a]of Object.entries(t.alias||{}))e[a]&&!e[s]&&(e[s]={...e[a],ch:s});delete n.alias;let o=-3,r=n.cap+n.descent+1;for(let s of Object.values(e)){s.left=[],s.right=[],s.cells=[];for(let a=o;a<r;a++){let c=s.rows[a-s.y]||"",i=c.indexOf("#"),l=c.lastIndexOf("#");s.left.push(i<0?99:i),s.right.push(l<0?99:s.w-1-l)}for(let a=0;a<s.rows.length;a++)for(let c=0;c<s.w;c++)s.rows[a][c]==="#"&&s.cells.push([c,a+s.y]);s.top=s.y,s.bottom=s.y+s.rows.length}return n.pairs=new Map,n}var vo=/[0-9]/;function Ao(t,e,n){let o=e+n;if(o in t.kern)return t.kern[o];let r=t.pairs.get(o);if(r!==void 0)return r;let s=t.glyphs[e],a=t.glyphs[n];if(r=0,s&&a&&e!==" "&&n!==" "&&!(vo.test(e)&&vo.test(n))&&t.maxKern>0){let c=99;for(let i=0;i<s.right.length;i++)if(s.right[i]!==99)for(let l=Math.max(0,i-1);l<=Math.min(a.left.length-1,i+1);l++)a.left[l]!==99&&(c=Math.min(c,s.right[i]+a.left[l]));c===99&&(c=t.maxKern),r=-Math.max(0,Math.min(t.maxKern,c-(t.kernKeep??0)))}return t.pairs.set(o,r),r}var Eo=(t,e)=>[...t.upper?String(e).toUpperCase():String(e)],Ro=(t,e)=>t.glyphs[e]??t.glyphs[e.toUpperCase()]??t.glyphs["?"];function He(t,e){let n=0,o=null;for(let r of Eo(t,e)){if(r===" "){o!==null&&(n+=t.gap),n+=t.space,o=" ";continue}let s=Ro(t,r);o!==null&&(n+=t.gap+Ao(t,o,s.ch)),n+=s.w,o=s.ch}return n}function ne(t,e){let n=[],o=0,r=null,s=0,a=t.cap;for(let c of Eo(t,e)){if(c===" "){r!==null&&(o+=t.gap),o+=t.space,r=" ";continue}let i=Ro(t,c);r!==null&&(o+=t.gap+Ao(t,r,i.ch)),n.push({g:i,x:o}),s=Math.min(s,i.top),a=Math.max(a,i.bottom),o+=i.w,r=i.ch}return{glyphs:n,width:o,top:s,bottom:a}}var So=new WeakMap;function We(t,e,n=!0){let o=So.get(t);o||So.set(t,o=new Map);let r=e*2+(n?1:0),s=o.get(r);if(s)return s;s=[];let a=t.rows.length,c=t.w,i=(u,d)=>d>=0&&d<a&&u>=0&&u<c&&t.rows[d][u]==="#";for(let u=-1;u<=a;u++)for(let d=-1;d<=c;d++){if(i(d,u)){for(let f=0;f<e;f++)for(let g=0;g<e;g++)s.push([d*e+g,(u+t.y)*e+f]);continue}if(!(!n||e<2)){for(let[f,g]of[[-1,-1],[1,-1],[-1,1],[1,1]])if(!(!i(d+f,u)||!i(d,u+g)||i(d+f,u+g)))for(let m=0;m<e-1;m++)for(let p=0;p<e-1-m;p++){let h=f<0?p:e-1-p,y=g<0?m:e-1-m;s.push([d*e+h,(u+t.y)*e+y])}}}let l=new Set;return s=s.filter(([u,d])=>{let f=u*4096+d;return l.has(f)?!1:(l.add(f),!0)}),o.set(r,s),s}function To(t,e,n=1,o=!0){let r=ne(t,e),s=[];for(let{g:a,x:c}of r.glyphs)for(let[i,l]of We(a,n,o))s.push([c*n+i,l]);return{cells:s,width:r.width*n,top:r.top*n,bottom:r.bottom*n}}var Lt={};function vt(t){return Lt[t.id]=t,t}var ft=(t,e,n)=>t+1024<<21|e+4096<<8|n+128,Yn=[{n:[1,0,0],a:[0,1,0],b:[0,0,1]},{n:[-1,0,0],a:[0,1,0],b:[0,0,1]},{n:[0,1,0],a:[1,0,0],b:[0,0,1]},{n:[0,-1,0],a:[1,0,0],b:[0,0,1]},{n:[0,0,1],a:[1,0,0],b:[0,1,0]},{n:[0,0,-1],a:[1,0,0],b:[0,1,0]}],Zn=[[-1,-1],[1,-1],[1,1],[-1,1]];function $n(t,e){if(t.size<1024)return null;let n=1/0,o=1/0,r=1/0,s=-1/0,a=-1/0,c=-1/0;for(let m of t.keys()){let p=m>>>21,h=m>>>8&8191,y=m&255;n=Math.min(n,p),s=Math.max(s,p),o=Math.min(o,h),a=Math.max(a,h),r=Math.min(r,y),c=Math.max(c,y)}let i=s-n+3,l=a-o+3,u=c-r+3;if(u>32||i*l>t.size*2||n===0||s===2047||o===0||a===8191||r===0||c===255)return null;let d=new Uint32Array(i*l);e&&r<=128&&d.fill(2**Math.min(u,129-r)-1);let f=m=>((m>>>8&8191)-o+1)*i+(m>>>21)-n+1;for(let m of t.keys())d[f(m)]|=1<<(m&255)-r+1;let g=(m,p)=>d[m-1]>>>p&7|(d[m]>>>p&7)<<3|(d[m+1]>>>p&7)<<6;return m=>{let p=f(m),h=(m&255)-r;return g(p-i,h)|g(p,h)<<9|g(p+i,h)<<18}}function Qn(t,e){let n=new Int8Array(t.count*4),o=Math.round(e/2),r=[...new Set([-e,-o,0,o,e])];for(let s=0;s<t.count;s++){let a=Math.floor(t.rest[3*s]),c=Math.floor(t.rest[3*s+1]),i=Math.floor(t.rest[3*s+2]),l=0,u=0,d=0;for(let g of r)for(let m of r)l+=t.has(a-e,c+g,i+m)-t.has(a+e,c+g,i+m),u+=t.has(a+g,c-e,i+m)-t.has(a+g,c+e,i+m),d+=t.has(a+g,c+m,i-e)-t.has(a+g,c+m,i+e);let f=Math.hypot(l,u,d);f&&(n[s*4]=Math.round(127*l/f),n[s*4+1]=Math.round(127*u/f),n[s*4+2]=Math.round(127*d/f),n[s*4+3]=112)}return n}var se=class{constructor(e){this.name=e,this.cells=new Map,this.tx=0,this.ty=0,this.tz=0,this.fx=null,this.hidden=!1,this.count=0,this.grounded=!0,this.masked=!1}plot(e,n,o,r,s){let a=ft(e,n,o);return this.cells.set(a,X[r].id),s!==void 0&&((this.births??=new Map).set(a,s),this.masked=!0),this}grow(e,n=0){let o=this.scales,r=this.birth;if(!o||!r)return!1;let s=this.shown??=new Float32Array(this.count),a=n>0?n/.14:1,c=!1;for(let i=0;i<this.count;i++){let l=e>=r[i]?1:0,u=s[i];u!==l&&(u=l>u?Math.min(1,u+a):Math.max(0,u-a*1.6),s[i]=u,u!==l&&(c=!0)),o[i]=u<=0?0:u>=1?1:1-(1-u)*(1-u)*(1+1.2*u)+.1*Math.sin(Math.PI*u)*u*u}return c}box(e,n,o,r,s,a,c){let i=X[c].id;for(let l=0;l<r;l++)for(let u=0;u<s;u++)for(let d=0;d<a;d++)this.cells.set(ft(e+l,n+u,o+d),i);return this}slab(e,n,o,r,s,a,c,i=1){return this.box(e,n,o,r,s,a,c),i>0&&this.notch(e,n,o,r,s,a,i),this}notch(e,n,o,r,s,a,c=1){let i=c===1?[[0,0]]:c===2?[[0,0],[1,0],[0,1]]:[[0,0],[1,0],[2,0],[0,1],[0,2],[1,1]];for(let[l,u]of i)for(let d=0;d<a;d++)this.cells.delete(ft(e+l,n+u,o+d)),this.cells.delete(ft(e+r-1-l,n+u,o+d)),this.cells.delete(ft(e+l,n+s-1-u,o+d)),this.cells.delete(ft(e+r-1-l,n+s-1-u,o+d));return this}carve(e,n,o,r,s,a){for(let c=0;c<r;c++)for(let i=0;i<s;i++)for(let l=0;l<a;l++)this.cells.delete(ft(e+c,n+i,o+l));return this}text(e,n,o,r,s,a,c=1,i="sign"){let{cells:l,width:u}=To(Lt[i],e,c);for(let[d,f]of l)this.box(n+d,o+f,r,1,1,s,a);return u}has(e,n,o){return this.cells.has(ft(e,n,o))}bake(e,n){let o=this.cells,r=this.grounded,s=(m,p,h)=>r&&h<0&&!this.sunk||o.has(ft(m,p,h)),a=$n(o,r&&!this.sunk),c=new Map,i=(m,p,h)=>{if(s(m+1,p,h)&&s(m-1,p,h)&&s(m,p+1,h)&&s(m,p-1,h)&&s(m,p,h+1)&&s(m,p,h-1))return null;let y=0,b=0;for(let w=0;w<6;w++){let M=Yn[w],k=0;for(let v=0;v<4;v++){let[S,R]=Zn[v],A=s(m+M.n[0]+M.a[0]*S,p+M.n[1]+M.a[1]*S,h+M.n[2]+M.a[2]*S),E=s(m+M.n[0]+M.b[0]*R,p+M.n[1]+M.b[1]*R,h+M.n[2]+M.b[2]*R),L=s(m+M.n[0]+M.a[0]*S+M.b[0]*R,p+M.n[1]+M.a[1]*S+M.b[1]*R,h+M.n[2]+M.a[2]*S+M.b[2]*R),P=A&&E?3:(A?1:0)+(E?1:0)+(L?1:0);k|=P<<v*2}w<4?y|=k<<w*8:b|=k<<(w-4)*8}let x=!s(m,p,h+1)&&s(m+1,p,h)&&s(m-1,p,h)&&s(m,p+1,h)&&s(m,p-1,h);return[y,b,+x]},l=[],u=[],d=[],f=[],g=[];for(let[m,p]of o){let h=(m>>>21)-1024,y=(m>>>8&8191)-4096,b=(m&255)-128,x=a?.(m),w=a?c.get(x):void 0;w===void 0&&(w=i(h,y,b),a&&c.size<4096&&c.set(x,w)),w&&(l.push(h+.5,y+.5,b+.5),u.push(w[0],w[1]),d.push(p),f.push(this.births?.get(m)??0),g.push(w[2]))}return this.count=d.length,this.rest=new Float32Array(l),this.mouldRadius&&(this.normals=Qn(this,this.mouldRadius)),this.ao=new Uint32Array(u),this.mats=new Uint8Array(d),this.birth=new Float32Array(f),this.flat=new Uint8Array(g),this.col=new Float32Array(this.count*4),this.scales=this.masked?new Float32Array(this.count).fill(1):null,this.tint(e,n),this}tint(e,n=Ot){let{rest:o,mats:r,col:s,flat:a}=this,c=so(n);for(let i=0;i<this.count;i++){let l=c[r[i]];if(n.finishes){let h=n.finishes[l.name],y=h?.chamfer??255,b=h?.specular??0,x=i*2+1;this.ao[x]=this.ao[x]&65535|y<<16|b<<24}let u=e==="night"?l.night:l.day,d=Math.floor(o[i*3]),f=Math.floor(o[i*3+1]),g=Math.floor(o[i*3+2]),m=n.quiet&&a[i]&&!(l.glow>0),p=0;m||(p=(Z(d,f,g)-.5)*2*l.jitter,l.grain&&(p+=l.grain(d,f,g)),p*=n.grain),s[i*4]=Be(u[0]+p),s[i*4+1]=Be(u[1]+p),s[i*4+2]=Be(u[2]+p),s[i*4+3]=l.transmission?-1-l.transmission:l.seamless||m?-1:l.glow}}},Be=t=>t<0?0:t>1?1:t,Bt=class{constructor(){this.parts=[],this.byName={}}part(e){if(this.byName[e])return this.byName[e];let n=new se(e);return this.parts.push(n),this.byName[e]=n,n}bake(e,n){for(let o of this.parts)o.bake(e,n);return this}tint(e,n){for(let o of this.parts)o.tint(e,n)}get count(){let e=0;for(let n of this.parts)n.hidden||(e+=n.count);return e}};var Po=8192,mt=[.5,.5];var Ue=class{constructor(e,n,o){this.el=e,this.def=n,this.stage=o,this.springs={},this.labels=[],this.state={},this.visible=!0,this.dirty=!0,this.fxCount=0,this.tintRevision=0,this.canvas=document.createElement("canvas"),this.canvas.className="vx-canvas",this.canvas.setAttribute("aria-hidden","true"),this.ctx=o.renderer.ownsCanvas?null:this.canvas.getContext("2d"),(n.canvasHost?n.canvasHost(e):e).prepend(this.canvas),e.setAttribute("data-vx-live",""),this.unbind=n.bind?n.bind(this):null,this.rebuild()}rebuild(){let e=this.el,n=this.def,o=getComputedStyle(e);this.vx=parseFloat(o.getPropertyValue("--vx"))||4,this.theme=o.getPropertyValue("--vx-theme").trim()==="night"?"night":"day",this.look=Ae(o);let r=this.look.parts[n.name];this.form=r?{...n,...r}:n;let s=e.offsetWidth,a=e.offsetHeight;this.cssW=s,this.cssH=a,this.W=Math.max(1,Math.floor(s/this.vx+.01)),this.H=Math.max(1,Math.floor(a/this.vx+.01)),this.pad=this.form.pad??6,this.faceZ=0,this.well=null;let c=this.surface;this.stopMotion(),this.model=new Bt;for(let u of this.labels)u.node.style.transform="",u.last=void 0;this.labels.length=0,this.form.build(this,this.model),this.model.bake(this.theme,this.look);let i=0,l=!1;for(let u of this.model.parts){i+=u.count;for(let d=0;d<u.count;d++)if(u.col[d*4+3]>0){l=!0;break}}return this.normals=this.model.parts.some(u=>u.normals)?new Int8Array(i*4):null,this.capacity=i,this.pos=new Float32Array(i*8),this.col=new Float32Array(i*4),this.ao=new Uint32Array(i*2),this.glows=l,this.layout(),this.form.pose?.(this),this.invalidate(),c}retint(){let e=getComputedStyle(this.el),n=e.getPropertyValue("--vx-theme").trim()==="night"?"night":"day";if(Ae(e)!==this.look)return this.rebuild();n!==this.theme&&(this.theme=n,this.recolor())}recolor(){this.tintRevision++,this.model.tint(this.theme,this.look),this.glows=this.model.parts.some(e=>e.col.some((n,o)=>o%4===3&&n>0)),this.invalidate()}layout(){let e=this.pad*this.vx,n=this.cssW+e*2,o=this.cssH+e*2,r=Math.max(1,window.devicePixelRatio||1),s=Math.max(n,o);s*r>Po&&(r=Math.max(1,Math.floor(this.vx*Po/s))/this.vx);let a=this.canvas;this.wpx=Math.round(n*r),this.hpx=Math.round(o*r),a.width!==this.wpx&&(a.width=this.wpx),a.height!==this.hpx&&(a.height=this.hpx),a.style.width=n+"px",a.style.height=o+"px",this.base=-e,this.nudge??=[0,0],a.style.left=this.base+this.nudge[0]+"px",a.style.top=this.base+this.nudge[1]+"px",this.stage.resnapSoon(),this.s=this.vx*r;let c=this.faceZ,i=(this.cssW-this.W*this.vx)/2,l=(this.cssH-this.H*this.vx)/2;this.ox=Math.round((e+i-c*mt[0]*this.vx)*r),this.oy=Math.round((e+l-c*mt[1]*this.vx)*r),this.bounds=[-this.pad-c,-this.pad-c,this.W+this.pad+c,this.H+this.pad+c]}spring(e,n=0,o=170,r=26){return this.springs[e]??=new _t(n,o,r)}label(e,n){e&&this.labels.push({node:e,z:n})}play(e,n,o={}){let r=n?[].concat(n).map(f=>typeof f=="string"?this.model.byName[f]:f).filter(Boolean):this.model.parts,s=1;for(let f of this.model.parts)for(let g=0;g<f.count;g++)s=Math.max(s,f.rest[g*3+2]+.5);let a={W:this.W,H:this.H,top:s,...o},c=e==="crumble"||e==="lower",i=z(),l=o.surface??this.form.surface,u=this.surface??o.resume,d=o.contact&&u?Number(this.el.style.getPropertyValue("--vx-surface-ink")):void 0;this.clearSurface(),this.waiters=(this.waiters??[]).filter(f=>f.list.some(g=>r.includes(g))?(f.resolve(!1),!1):!0);for(let f of r){if(l){let g;!i&&o.contact&&c&&u?.kind==="assemble"&&f.fx&&(g=new Float32Array(f.count*8),f.fx.write(g,0,f)),f.fx=ao(f,{duration:.3,...a,out:c,still:i,contactPose:g,rim:l==="rim",previousRelease:u?.release,start:u?.progress??(c?1:0),from:g?o.from:u?.from??o.from??[0,this.H]})}else i?f.fx=io(f,{out:c}):f.fx=(c?Pe:Te)(f,a);f.hidden=!1}return l&&r.length&&(this.surface=r[0].fx,d!==void 0&&(this.surface.contactInk=d),this.el.dataset.vxSurface=i?"still":l,this.paintSurface()),this.invalidate(),r.length?new Promise(f=>this.waiters.push({list:r,resolve:f})):Promise.resolve(!0)}paintSurface(){let{progress:e,still:n,rim:o,release:r}=this.surface,s=n?e:o&&r?Math.min(1,e*2):1,a=r?(e-.9)/.1:(e-.78)/.18,c=n||o?s:Math.max(0,Math.min(1,a));!n&&this.surface.contactInk!==void 0&&(c=this.surface.contactInk*Math.max(0,1-this.surface.t/Math.min(.1,this.surface.end))),this.el.style.setProperty("--vx-surface-alpha",s),this.el.style.setProperty("--vx-surface-ink",c)}stopMotion(){this.clearSurface();for(let e of this.model?.parts??[])e.fx=null;for(let e of this.waiters??[])e.resolve(!1);this.waiters=[]}clearSurface(){this.surface&&(this.surface=null,delete this.el.dataset.vxSurface,this.el.style.removeProperty("--vx-surface-alpha"),this.el.style.removeProperty("--vx-surface-ink"))}invalidate(){this.destroyed||(this.dirty=!0,this.stage.wake(this))}step(e){let n=!1;for(let o of Object.values(this.springs))o.moving&&(this.dirty=!0,o.step(e)&&(n=!0));for(let o of this.model.parts)o.fx&&(o.fx.t+=e,o.fx.t>=o.fx.end&&(!this.visible||o.hidden||!o.count)?(o.fx.kind==="crumble"&&(o.hidden=!0),o.fx=null,this.dirty=!0,this.settled(o)):n=!0);return this.form.step&&this.form.step(this,e)&&(n=!0),n&&(this.dirty=!0),n}draw(){if(!this.dirty||!this.visible)return;this.form.pose?.(this);let e=this.pos,n=this.col,o=this.ao,r=0,s=0;for(let i of this.model.parts){if(i.hidden||!i.count)continue;let l=i.count;if(i.fx){if(i.fx.write(e,r,i)){let d=i.fx.kind;if(i.fx=null,d==="crumble"&&(i.hidden=!0),this.settled(i),i.hidden)continue;this.writeRest(i,r)}}else this.writeRest(i,r);this.normals&&(i.normals?this.normals.set(i.normals,s*4):this.normals.fill(0,s*4,(s+l)*4)),n.set(i.col,s*4),o.set(i.ao,s*2),r+=l*8,s+=l}let a=this.stage.renderer.draw({pos:e,col:n,ao:o,normals:this.normals,count:s,wpx:this.wpx,hpx:this.hpx,ox:this.ox,oy:this.oy,s:this.s,bounds:this.bounds,light:ro(this.look,this.theme),shear:mt,glows:this.glows,soft:this.form.soft,groundSoft:this.look.groundSoft,surfaceBytes:!!this.look.finishes,glowRadius:this.glowRadius??this.form.glowRadius,glowStrength:this.glowStrength??this.form.glowStrength,well:this.well,groundShadow:this.well?0:1},this.ctx??this.canvas);a&&this.surface&&(this.paintSurface(),this.surface.t>=this.surface.end&&this.surface.kind!=="crumble"&&this.clearSurface());let c=this.vx;for(let i of this.labels){let l=i.z()-this.faceZ,u=l*mt[0]*c,d=l*mt[1]*c;i.ax=u+(i.nx??0),i.ay=d+(i.ny??0);let f=Math.abs(i.ax)<.01&&Math.abs(i.ay)<.01?"":`translate(${i.ax.toFixed(3)}px, ${i.ay.toFixed(3)}px)`;i.last!==f&&(i.node.style.transform=f,i.last=f)}a&&(this.dirty=!1)}writeRest(e,n){let o=this.pos,r=e.rest,s=e.scales;if(e.axle){let{x:a,y:c,angle:i}=e.axle,l=Math.cos(i),u=Math.sin(i),d=Math.sin(i/2),f=Math.cos(i/2);for(let g=0;g<e.count;g++,n+=8){let m=r[g*3]-a,p=r[g*3+1]-c;o[n]=a+l*m-u*p+e.tx,o[n+1]=c+u*m+l*p+e.ty,o[n+2]=r[g*3+2]+e.tz,o[n+3]=1,o[n+4]=o[n+5]=0,o[n+6]=d,o[n+7]=f}return}for(let a=0;a<e.count;a++,n+=8)o[n]=r[a*3]+e.tx,o[n+1]=r[a*3+1]+e.ty,o[n+2]=r[a*3+2]+e.tz,o[n+3]=s?s[a]:1,o[n+4]=0,o[n+5]=0,o[n+6]=0,o[n+7]=1}settled(e){this.waiters&&(this.waiters=this.waiters.filter(n=>n.list.some(o=>o.fx)?!0:(n.resolve(!0),!1)))}destroy(){this.destroyed=!0,this.stopMotion(),this.unbind?.(),this.canvas.remove(),this.el.removeAttribute("data-vx-live"),this.el.removeAttribute("data-vx-cover-legends");for(let e of this.labels)e.node.style.transform=""}},re=class{constructor(e){this.renderer=e,this.renderer.onrestore=()=>{for(let s of this.lives.values())s.invalidate()},this.renderer.onfail=()=>this.onfail?.(),this.lives=new Map,this.bindings=new WeakMap,this.shadowRoots=new WeakMap;let n=new Set,o=0;this.removals=new MutationObserver(s=>{for(let a of s)for(let c of a.removedNodes)if(!(c.nodeType!==1||c.isConnected&&c.ownerDocument===document))for(let i of this.boundUnder(c))n.add(i);n.size&&!o&&(o=setTimeout(()=>{o=0;for(let a of n)(!a.isConnected||a.ownerDocument!==document)&&this.remove(a);n.clear()},0))}),this.removals.observe(document,{childList:!0,subtree:!0}),this.awake=new Set,this.raf=0,this.last=0,this.tick=this.tick.bind(this),this.resizing=new Map,this.resize=new ResizeObserver(s=>{for(let a of s){let c=this.lives.get(a.target);c&&(a.target.offsetWidth!==c.cssW||a.target.offsetHeight!==c.cssH?this.resizing.set(c,!1):this.resizing.delete(c))}this.settleSizes()}),this.seen=new IntersectionObserver(s=>{for(let a of s){let c=this.lives.get(a.target);c&&(c.visible=a.isIntersecting,c.visible&&this.resnapSoon(),c.visible&&c.dirty&&this.wake(c))}},{rootMargin:"200px"}),this.dpr=window.devicePixelRatio,addEventListener("resize",()=>{if(this.resnapSoon(),window.devicePixelRatio!==this.dpr){this.dpr=window.devicePixelRatio;for(let s of this.lives.values())s.layout(),s.invalidate()}}),document.fonts?.addEventListener?.("loadingdone",()=>this.resnapSoon()),document.body&&new ResizeObserver(()=>this.resnapSoon()).observe(document.body);let r=()=>{for(let s of this.lives.values())s.retint()};matchMedia("(prefers-color-scheme: dark)").addEventListener("change",r),new MutationObserver(r).observe(document.documentElement,{attributes:!0,attributeFilter:["data-theme","data-vx-look","class"],subtree:!0}),document.addEventListener("visibilitychange",()=>{!document.hidden&&this.awake.size&&this.schedule()})}resnap(){this.snapping=0;let e=Math.max(1,window.devicePixelRatio||1),n=s=>Math.round(s*e)/e-s,o=[],r=document.createRange();for(let s of this.lives.values()){if(!s.canvas.isConnected||!s.el.offsetParent&&getComputedStyle(s.el).position!=="fixed")continue;let a=s.canvas.getBoundingClientRect(),c=s.labels.map(i=>{r.selectNodeContents(i.node);let l=r.getBoundingClientRect();return[i,n(l.left-(i.ax??0)),n(l.top-(i.ay??0))]});o.push([s,n(a.left-s.nudge[0]),n(a.top-s.nudge[1]),c])}for(let[s,a,c,i]of o){let l=!1;(Math.abs(a-s.nudge[0])>.005||Math.abs(c-s.nudge[1])>.005)&&(s.nudge=[a,c],s.canvas.style.left=s.base+a+"px",s.canvas.style.top=s.base+c+"px");for(let[u,d,f]of i){if(Math.abs(d-(u.nx??0))<=.005&&Math.abs(f-(u.ny??0))<=.005)continue;let g=(u.ax??0)-(u.nx??0),m=(u.ay??0)-(u.ny??0);u.nx=d,u.ny=f,u.ax=g+d,u.ay=m+f;let p=Math.abs(u.ax)<.01&&Math.abs(u.ay)<.01?"":`translate(${u.ax.toFixed(3)}px, ${u.ay.toFixed(3)}px)`;u.last!==p&&(u.node.style.transform=p,u.last=p),l=!0}l&&s.invalidate()}}resnapSoon(){this.snapping||(this.snapping=requestAnimationFrame(()=>this.resnap()))}settleSizes(){this.resizeFrame||!this.resizing.size||(this.resizeFrame=requestAnimationFrame(()=>{this.resizeFrame=0;for(let[e,n]of this.resizing){if(!n){this.resizing.set(e,!0);continue}this.resizing.delete(e),e.el.isConnected&&(e.el.offsetWidth!==e.cssW||e.el.offsetHeight!==e.cssH)&&e.rebuild()}this.settleSizes()}))}add(e,n){for(let r=e.getRootNode();r.nodeType===11&&r.host&&!this.shadowRoots.has(r.host);r=r.host.getRootNode())this.shadowRoots.set(r.host,r),this.removals.observe(r,{childList:!0,subtree:!0});if(!n.build||n.draws&&!n.draws(e)){if(!n.bind&&!n.plain)return null;let r=this.bindings.get(e);if(r||this.bindings.set(e,r=new Map),r.has(n))return r.get(n);let s={el:e,def:n,stage:this,state:{}};if(r.set(n,s),n.bind)s.unbind=n.bind(s);else{let a=F(),c=n.plain(e,a);s.unbind=()=>{typeof c=="function"&&c(),a.done()}}return s}if(this.lives.has(e))return this.lives.get(e);let o=new Ue(e,n,this);return this.lives.set(e,o),this.resize.observe(e,{box:"border-box"}),this.seen.observe(e),o}remove(e){let n=this.bindings.get(e);if(this.bindings.delete(e),n)for(let r of n.values())r.unbind?.();let o=this.lives.get(e);o&&(this.resize.unobserve(e),this.seen.unobserve(e),this.awake.delete(o),this.resizing.delete(o),o.destroy(),this.lives.delete(e))}boundUnder(e){let n=new Set(e===document?this.lives.keys():[]),o=r=>{for(let s of[r,...r.querySelectorAll("*")]){(this.lives.has(s)||this.bindings.has(s))&&n.add(s);let a=this.shadowRoots.get(s);a&&o(a)}};return o(e),n}wake(e){this.awake.add(e),this.schedule()}schedule(){this.manual||!this.raf&&!document.hidden&&(this.raf=requestAnimationFrame(this.tick))}advance(e){for(let n of[...this.awake]){let o=n.step(e);n.draw(),!o&&!n.dirty?this.awake.delete(n):!n.visible&&!o&&this.awake.delete(n)}}tick(e){this.raf=0;let n=this.last?Math.min(.05,(e-this.last)/1e3):1/60;this.last=e;for(let o of this.awake){let r=o.step(n);o.draw(),!r&&!o.dirty?this.awake.delete(o):!o.visible&&!r&&this.awake.delete(o)}this.awake.size?this.schedule():this.last=0}};var ie=t=>getComputedStyle(t).direction==="rtl",dt=7,Ut=7,qe=4,Jn={pad:7,glowRadius:3,glowStrength:T(.05),build(t,e){let{W:n,H:o,el:r}=t,s=t.look,a=s.well,i=!!(t.state.input=r.querySelector("input"))?.matches(":disabled"),l=t.state.y=Math.floor((o-Ut)/2),u=!!s.tooling,d=u?l+2:l,f=u?3:Ut;if(kt(e,0,d,n,f),u){let x=e.part("scale");x.tx=-mt[0],x.box(0,l-2,0,n,2,1,"steel");for(let w=0;w<=10;w++){let M=1+Math.floor(dt/2)+Math.round((n-dt-2)*w/10),k=w%5===0?2:1;x.box(M,l-k,0,1,k,1,"gasket")}}C(t,e,{y:d,h:f,depth:a,wall:"gasket",floor:"slate"});let g=e.part("lit");g.masked=!0,g.grounded=!1,g.sunk=!0,g.box(0,u?l+3:l,u?-1:-a,n,u?1:Ut,1,i?"steel":u?"backlight":"light");let m=e.part("thumb");m.grounded=!1;let p=i?"steel":"ivory",h=u?Ut+1:Ut-2,y=a+s.travel,b=1-a+y;if(u){m.box(2,2,-a,dt-4,3,a+2,"steel"),m.slab(0,0,2,dt,h,2,i?"steel":"gasket",1);for(let x of[1,dt-2])m.box(x,1,4,1,h-2,1,i?"steel":"slate");if(m.box(3,0,qe-1,1,h,1,i?"slate":"ivory"),!i)for(let x of[0,h-1])m.plot(3,x,qe-1,"enamel")}else i||_(m,0,0,-a,dt,h,"light"),at(m,0,0,1-a,dt,h,y,p,0),m.box(3,1,b-s.groove,1,h-2,s.groove,i?"slate":"enamel");m.ty=u?l-1:l+1,t.state.travel=Math.max(0,n-2-dt),t.state.flip=ie(r)},pose(t){let e=t.state.input,{thumb:n,lit:o}=t.model.byName,r=Number(e?.min||0),s=Number(e?.max||100),a=s>r?ot((Number(e?.value)-r)/(s-r),0,1):0,i=1+(t.state.flip?1-a:a)*t.state.travel;n.tz=t.spring("press").x,n.tx=t.look.tooling?i-mt[0]*(qe+n.tz):i;let l=i+dt/2;for(let u=0;u<o.count;u++){let d=t.state.flip?o.rest[u*3]-l:l-o.rest[u*3];o.scales[u]=a<=.001?0:ot(d+.5,0,1)}t.glowStrength=T(.05)*W(t)}},ts={pad:6,glowRadius:2.8,glowStrength:T(.06),build(t,e){let{W:n,el:o,vx:r}=t,s=t.state.rows=[],a=e.part("lens"),c=ie(o)?n-2:1;[...o.children].filter(i=>i.tagName==="LI").forEach((i,l)=>{let u=Math.round(i.offsetTop/r),d=Math.max(2,Math.round(i.offsetHeight/r)),f=i.getAttribute("aria-current")==="true"||i.getAttribute("aria-selected")==="true",g={li:i,part:null,current:f,press:t.spring("row"+l)};s.push(g);let m=d>4?2:0;wt(a,c,u+m,1,d-m*2,f),t.label(Y(i,"vx-row"),()=>g.press.x)}),t.faceZ=0},pose(t){let e=0;for(let n of t.state.rows)n.current&&(e=Math.max(e,-n.press.x));t.glowStrength=T(.06)*W(t)*(1+e*1.6)}},Lo=.027,ae=2,es={pad:11,glowRadius:2.2,glowStrength:T(Lo),build(t,e){let{W:n,H:o,el:r,vx:s}=t,a=t.look.float,c=t.look.groove,i=e.part("panel");_(i,0,0,0,n,o,"light",1),i.slab(0,0,1,n,o,a-1,t.look.readingPlate??"key",1);let l=t.state.items=[...r.querySelectorAll('[role^="menuitem"]')],u=l[0]?Math.max(2,Math.round(l[0].offsetHeight/s)):2;t.state.ys=l.map(g=>Math.round(g.offsetTop/s));let d=e.part("pick");d.grounded=!1,d.box(ie(r)?n-1-ae:ae,Math.min(2,u-1),a-c,1,Math.max(1,u-4),c,"light"),d.tz=.03;let f=e.part("danger");f.grounded=!1,f.box(ie(r)?n-1-ae:ae,Math.min(2,u-1),a-c,1,Math.max(1,u-4),c,"light-stop"),f.tz=d.tz,t.faceZ=a},pose(t){let{pick:e}=t.model.byName,n=t.state.active;e.hidden=!(n>=0);let o=t.model.byName.danger;o.hidden=e.hidden||t.state.items[n]?.dataset.vxKind!=="danger",o.hidden||(e.hidden=!0),n>=0&&(o.ty=e.ty=(t.state.ys[n]??0)-(t.state.scrollY??0)),t.glowStrength=T(Lo)*(t.theme==="day"?1.2:1)}},Fo=.025,je=4,os={pad:16,glowRadius:2.2,glowStrength:T(Fo),build(t,e){let{W:n,H:o,el:r,vx:s}=t,a=t.look.dialog,c=t.look.round,i=t.look.groove,l=e.part("panel"),u=r.querySelector(":scope[data-vx-command-deck] > .vx-command-scroll");if(u){let g=Math.round(u.offsetLeft/s),m=Math.round(u.offsetTop/s),p=Math.round(u.offsetWidth/s),h=Math.round(u.offsetHeight/s);if(l.slab(1,1,0,n-2,o-2,1,"gasket",c),l.slab(0,0,1,n,o,3,"chalk",c),l.slab(0,0,4,n,o,1,"gasket",c),l.slab(0,0,5,n,o,1,t.look.readingPlate??"chalk",c),l.carve(g,m,4,p,h,2).box(g,m,3,p,h,1,"gasket"),n>=28){let y=e.part("keepers");for(let b of[6,n-12])l.carve(b,0,3,6,2,3),y.box(b,0,3,6,2,2,"steel").box(b+1,0,5,4,2,1,"steel")}t.faceZ=6;return}_(l,0,0,0,n,o,B(r,"light"),c),l.slab(0,0,1,n,o,a-1,t.look.readingPlate??"chalk",c);let d=r.querySelector(":scope > header"),f=d?Math.round((d.offsetTop+d.offsetHeight)/s)-1:0;if(f>1&&f<o-2&&n>je*2+2){let g=je,m=n-je*2;l.carve(g,f,a-i-1,m,1,i+1);let p=e.part("groove");p.grounded=!1,p.box(g,f,a-i-1,m,1,1,"light-warm").box(g,f+1,a-i,m,1,i,"light-warm"),p.ty=Yt,p.tz=Yt}t.faceZ=a},pose(t){t.glowStrength=T(Fo)*(t.theme==="day"?1.25:1)}},No={slider:Jn,list:ts,menu:es,dialog:os};var ns={pad:9,soft:.65,build(t,e){let{el:n}=t,o=n.matches(":disabled")||n.getAttribute("aria-disabled")==="true",r=Zt(n),s=Pt(t,e,o,r==="main"?"enamel":"key",B(n,r==="danger"?"light-stop":"light"));De(t,s,t.faceZ-1,!o&&r==="main"?"ivory":"ink"),t.state.off=o,t.label(n.querySelector(":scope > .vx-label"),()=>t.state.top+s.tz),(t.state.first===void 0||t.state.pressTravel!==e.keyTravel)&&(t.state.first=!1,t.state.pressTravel=e.keyTravel,!o&&(n.getAttribute("aria-expanded")==="true"||n.getAttribute("aria-pressed")==="true")&&t.spring("press").snap(-e.keyTravel))},pose(t){let e=t.model.byName.cap,n=t.spring("press").x,o=t.spring("hover").x;e.tz=t.state.off?0:n+o;let r=t.state.flare??0;$t(t,o,r),Zt(t.el)==="main"&&!t.state.off&&(t.glowStrength*=2.6,t.glowRadius+=1),t.el.style.setProperty("--lit",r.toFixed(3))},step(t,e){if(t.state.off)return!1;let n=t.spring("press").x<-.4,o=t.state.flare??0,r=n?Math.min(1,o+e/.06):Math.max(0,o-e/.55);return t.state.flare=r,r>0&&r!==o}},ce=.05,ss={pad:7,glowRadius:3.2,glowStrength:T(ce),build(t,e){let{W:n,H:o,el:r}=t,s=t.look.well,a=r.querySelector("input, textarea"),c=a?.getAttribute("aria-invalid")==="true",i=!!a?.matches(":focus"),l=a?.matches(":disabled"),u=t.look.tooling,d=u&&getComputedStyle(r).direction==="rtl",f=u?Math.min(2,s):s,g=u||c&&!i?"gasket":i?"light":B(r,"light-warm");if(C(t,e,{depth:f,wall:g,floor:l?"slate":"floor"}),u){let m=e.part("frame");_(m,-1,-1,0,n+2,o+2,"steel",1);let p=Math.min(5,n-2);m.box(d?n-p-1:1,-1,0,p,1,1,i?"light":"lens")}if(r.hasAttribute("data-vx-mail-pilot")){let m=Math.min(7,n),p=d?0:n-m,h=Math.floor((o-2)/2),y=p+Math.floor(m/2),b=e.part("socket");if(b.sunk=!0,b.box(p,0,-f,m,o,f,"slate"),b.box(p,0,-1,m,o,1,"chalk"),m>=5){b.box(y-2,h-1,-1,5,4,1,"gasket"),b.carve(y-1,h,-f,3,2,f);let x=e.part("tell");x.sunk=!0;let w=c&&!l;x.box(y-1,h,-1,3,2,1,w?"brick":"lens"),w&&(x.box(y-1,h,-1,2,1,1,"light-stop"),x.plot(y+1,h,-1,"stop-wash")),b.carve(y-1,h-2,-f,3,3,1),x.box(y-1,h-2,-f,3,3,1,w?"light-stop":"gasket")}}else if(c||u&&r.closest(".vx-field")?.querySelector(".vx-field-error")){let m=e.part("tell");m.sunk=!0;let p=u?Math.min(9,n-2):n,h=d?n-p-1:u?1:0;m.box(h,o-1,-f,p,1,1,c&&!l?"light-stop":"lens"),c&&!l&&e.byName.floor.box(h,o-2,-f-1,p,1,1,"stop-wash")}t.state.bad=c,t.spring("lit").snap(i?1:0)},pose(t){let e=t.spring("lit").x;t.glowStrength=T(ce)*(.2+e*(t.theme==="day"?2.2:1.6))+(t.state.bad?T(.006):0),t.glowRadius=3.2+e*1.2}},Io={name:"groove",selector:".vx-groove",pad:6,glowRadius:2.6,glowStrength:T(.05),build(t,e){let{W:n,H:o,el:r}=t;if(r.hasAttribute("data-vx-lens")){let i=Co(r);if(t.state.lens=i,r.dataset.vxLens==="flush"){C(t,e,{depth:2,wall:"steel",floor:"gasket"}),t.state.resinTint=null;let d=e.part("core");d.sunk=!0,d.box(1,1,-2,n-2,o-2,1,"gasket");let f=i?B(r):"lens",g=o>=n,m=g?1:2,p=g?2:1,h=Math.max(1,n-2*m),y=Math.max(1,o-2*p);d.box(m,p,-2,h,y,1,f);let b=e.part("lens");b.sunk=!0,b.box(1,1,-1,n-2,o-2,1,"groove-resin"),b.box(m,p,-1,g?1:h,g?y:1,1,f);return}let l=Math.min(n,o),u=Math.max(n,o);n>=o?wt(e.part("lens"),0,0,u,l,i,B(r,"light")):wt(e.part("lens"),0,0,l,u,i,B(r,"light")),t.faceZ=0;return}t.state.lens=void 0;let s=B(r,"light-warm"),a=!r.dataset.vxLight&&n>o&&r.parentElement?.matches(".vx-card")&&r.parentElement.querySelector(":scope > .vx-groove")===r,{floor:c}=C(t,e,{depth:t.look.groove,wall:s,floor:s});if(a){let i=Math.min(n-2,Math.max(6,Math.round(n/4)));i>0&&c.box(1,0,-t.look.groove-1,i,o,1,"lamp")}},pose(t){if(t.el.dataset.vxLens==="flush"){if(t.state.lens&&t.state.resinTint!==t.tintRevision){t.state.resinTint=t.tintRevision;let{core:e,lens:n}=t.model.byName,o=e.col.findIndex((r,s)=>s%4===3&&r>0)-3;if(o>=0)for(let r=0;r<n.count;r++){if(n.col[4*r+3]>=0)continue;let s=t.H>=t.W?1:0,a=n.rest[3*r+s],c=Math.max(0,2.5-a,a-(Math.max(t.W,t.H)-2.5)),i=.45/(1+c*c);for(let l=0;l<3;l++){let u=4*r+l;n.col[u]+=(e.col[o+l]-n.col[u])*i}}}t.glowRadius=1.5,t.glowStrength=t.state.lens?T(.018)*W(t):0;return}if(t.state.lens!==void 0){t.glowStrength=t.state.lens?T(.05)*W(t):0;return}t.glowStrength=T(.05)*(t.el.dataset.vxLight?W(t):yt(t))},bind(t){if(!t.el.hasAttribute("data-vx-lens"))return null;let e=Oo(t.el);if(!e)return null;let n=F();return n.watch(e,{attributes:!0,attributeFilter:["aria-current","aria-selected"]},()=>{Co(t.el)!==t.state.lens&&t.rebuild?.()}),n.done}},Oo=t=>t.closest('li, a, [role="option"], [role="tab"], [role="treeitem"]');function Co(t){let e=Oo(t);if(!e)return!1;let n=e.getAttribute("aria-current"),o=e.getAttribute("aria-selected");return n!==null&&n!=="false"||o==="true"}var rs=t=>{let e=t.querySelector("progress, meter");if(!e)return Number(t.dataset.vxValue||0);let n=Number(e.getAttribute("max")||e.max||1),o=Number(e.getAttribute("min")||0);return Math.max(0,Math.min(1,(Number(e.getAttribute("value")??e.value)-o)/(n-o||1)))},as={pad:7,glowRadius:3.4,glowStrength:T(.04),build(t,e){let{W:n,H:o,el:r}=t;if(r.dataset.vxKind==="growth")return ee.build(t,e);let s=rs(r),a=t.spring("v",s,H.k,H.c);t.state.built===void 0&&a.snap(s),t.state.built=!0,t.state.posed=!1,t.state.growth=!1;let c=3,i=Math.floor((o-c)/2),l=t.look.well;C(t,e,{y:i,h:c,depth:l,wall:"slate",floor:"slate"});let u=K(t),d=e.part("studs");d.sunk=!0,d.grounded=!1;let f=e.part("fill");f.sunk=!0,f.grounded=!1;let g=B(r,"light"),m=Math.max(1,Math.floor((n+2)/4));for(let p=0;p<m;p++){let h=u(p*4,2);d.box(h,i,-l,2,c,1,"steel");for(let y=0;y<2;y++)for(let b=0;b<c;b++)for(let x=-l;x<0;x++)f.plot(h+y,i+b,x,g,(p+.5)/m)}},pose(t){if(t.state.growth)return ee.pose(t);t.glowStrength=T(.04)*W(t),t.state.posed||(t.state.posed=!0,t.model.byName.fill.grow(t.spring("v").x+1e-4,0))}},zo={name:"recess",selector:".vx-recess",pad:7,glowRadius:3.2,glowStrength:T(ce),build(t,e){let{W:n,H:o,el:r}=t,s=t.look.well;if(r.dataset.vxTray==="build-log"){let{walls:c}=C(t,e,{depth:s,wall:"steel",floor:"floor"});_(c,0,0,-1,n,o,"steel",1);for(let i=-s+1;i<-1;i++)_(c,0,0,i,n,o,"slate");_(c,0,0,-s,n,o,"gasket"),r.dataset.vxReflection==="warm"&&c.box(2,o-1,-s+1,n-4,1,1,"warm-metal");return}let{walls:a}=C(t,e,{depth:s,wall:B(r,"light-warm"),floor:"floor"});r.dataset.vxReflection==="warm"&&n>4&&a.box(2,o,-s,n-4,1,Math.min(s,2),"warm-metal")},pose(t){t.glowStrength=T(ce)*.2}},_o={name:"lamp",selector:'.vx-lamp:not([data-vx-rail="pilot-strip"] > li > .vx-lamp)',pad:6,glowRadius:3.4,glowStrength:T(.16),build(t,e){let{W:n,H:o,el:r}=t;co(e,n,o,B(r,"light-go")),t.faceZ=2},pose(t){t.glowStrength=T(.032)*W(t)*(1+2*t.spring("pulse").x)},bind(t){let e=new MutationObserver(()=>{t.rebuild();let n=t.spring("pulse",0,H.k,H.c*.8);n.snap(1.4),n.to(0),t.invalidate()});return e.observe(t.el,{attributes:!0,attributeFilter:["data-vx-light"]}),()=>e.disconnect()}},is={pad:14,soft:1,glowRadius:3,glowStrength:T(.02),build(t,e){let{W:n,el:o}=t,r=o.clientTop/t.vx,s=Math.max(1,t.H-Math.round(r)),a=n>=48&&s>=22,c=n>100&&s>=46,i=c?14:a?8:t.look.slab,l=r?Math.min(i,2*r):i,u=a?3:t.look.round,d=e.part("body");if(d.slab(2,2,0,n-4,s-4,2,"gasket",u),d.slab(0,0,2,n,s,l-4,"chalk",u),_(d,0,0,l-3,n,s,"gasket",u),d.slab(1,1,l-2,n-2,s-2,2,"chalk",u),t.look.tooling&&n>=16&&s>=12&&(d.slab(4,4,l-1,n-8,s-8,1,"panel",1),a&&e.part("pipe").box(8,s-1,l-3,n-16,1,1,"backlight")),o.dataset.vxLight&&_(e.part("light"),1,1,0,n-2,s-2,B(o),u),c&&o.dataset.vxBolts!=="none")for(let f of[4,n-5])for(let g of[4,s-5])d.slab(f-1,g-1,l-1,3,3,1,"steel",1),d.slab(f-1,g-1,l,3,3,1,"steel",1),d.box(f,g,l,1,1,1,"slate");_e(t,e,l,s),t.faceZ=l},pose(t){t.glowStrength=T(.012)*W(t)}},cs={done:"light-go",failed:"light-stop",note:"light"};function ls(t,e){let{W:n,H:o}=t,r=K(t),s=e.part("body");s.slab(1,1,0,n-2,o-2,2,"gasket",2),s.slab(0,0,2,n,o,2,"steel",2),s.slab(1,1,4,n-2,o-2,1,"warm-metal",1),s.carve(r(11,n-14),2,4,n-14,o-4,1),s.box(r(11,n-14),2,3,n-14,o-4,1,"gasket");let a=Math.floor((o-5)/2);s.box(r(2,7),a,4,7,5,1,"steel"),s.carve(r(3,5),a+1,4,5,3,1),s.box(r(3,5),a+1,3,5,3,1,"lens"),s.box(r(4,3),a+2,4,3,1,1,"light-go"),t.faceZ=4}var us={pad:11,glowRadius:2.2,glowStrength:T(.035),build(t,e){let{W:n,H:o,el:r}=t,s=t.look.float;if(r.dataset.vxSpecimen==="deploy")return ls(t,e);_(e.part("light"),0,0,0,n,o,cs[r.dataset.vxKind]||"light",1);let a=e.part("body");a.grounded=!1,a.slab(0,0,1,n,o,s-1,t.look.readingPlate??"key",1),t.faceZ=s},pose(t){t.glowStrength=T(t.theme==="day"?.04:.025)}};var fs={pad:7,glowRadius:3,glowStrength:T(.05),build(t,e){let{W:n,H:o}=t,r=t.look.well,s=t.state.input=t.el.parentElement.querySelector("input"),a=s?.disabled;kt(e,0,0,n,o),C(t,e,{depth:r,wall:"slate",floor:"slate"});let c=e.part("lit");c.masked=!0,c.grounded=!1,c.sunk=!0,c.covered=!0,c.box(1,Math.floor((o-2)/2),-r,n-2,2,1,"light-go");let i=e.part("knob");i.grounded=!1,a||_(i,0,0,-r,nt,o-2,"light"),i.slab(0,0,1-r,nt,o-2,r+1,a?"steel":"ivory",1);let l=a?"steel":"ivory";i.slab(0,0,2,nt,o-2,1,l,1),i.box(1,1,3,nt-2,2,1,l),i.box(2,1,3,nt-4,1,1,a?"slate":"key"),i.ty=1,t.state.inlineX=K(t),t.state.travel=n-2-nt;let u=t.spring("at",s?.checked?1:0);u.moving||u.snap(s?.checked?1:0)},pose(t){te.pose(t),t.glowStrength=T(.05)*W(t)}},ds={pad:7,glowRadius:3.4,glowStrength:T(.07),build(t,e){let{W:n,H:o,el:r,vx:s}=t,a=t.look.well,c=t.state.tabs=[...r.querySelectorAll(':scope > [role="tab"]')];C(t,e,{depth:a,wall:"slate",floor:"slate"});let i=t.state.seat=c.length?Math.round(c[0].offsetWidth/s):n,l=e.part("block");l.grounded=!1,_(l,1,1,-a,i-2,o-4,"light"),at(l,1,1,1-a,i-2,o-4,a-1,"key");let u=Math.max(0,c.findIndex(f=>f.getAttribute("aria-selected")==="true"));t.state.index=u;let d=t.state.xs=c.map(f=>Math.round(f.offsetLeft/s)+1);t.state.indicators=d.map((f,g)=>Tt(t,g,f,1,i-2,o-2)),t.spring("x",d[u]??1,$.k*1.25,$.c*1.12).snap(d[u]??1),c.forEach(f=>t.label(Y(f),()=>t.faceZ))},pose(t){let e=t.spring("x").x;t.model.byName.block.tx=e-1,t.state.indicators.forEach((n,o)=>{let r=Math.abs(e-t.state.xs[o]);n(Math.max(0,1-r/(t.state.seat/2)))}),t.glowStrength=T(.07)*W(t)}},Do={day:"#999b90",night:"#737b7a",jitter:.004,transmission:.64};bt("groove-resin",Do);zt("lit",{quiet:!1,groundSoft:1,finishes:{"groove-resin":{chamfer:55,specular:105},chalk:{chamfer:75},floor:{chamfer:0},slate:{chamfer:80},steel:{chamfer:195,specular:165},enamel:{chamfer:175,specular:105},key:{chamfer:135,specular:30},ivory:{chamfer:150,specular:38},lens:{chamfer:40,specular:150}},rise:6,travel:4,step:1,slab:5,round:2,float:6,dialog:7,well:4,light:{day:{glow:Dt,seam:.008,shadow:[.13,.1,.07,.34]},night:{glow:Dt,seam:.016,sun:.63,shadow:[0,0,.02,.6]}},materials:{"groove-resin":Do,chalk:{day:"#e9dcc5",night:"#23313b",jitter:.006},floor:{day:"#c8bda7",night:"#141a1f",jitter:.004},slate:{day:"#9f998a",night:"#283038",jitter:.008},"light-warm":{day:"#c1ac83",night:"#87704e",glow:.2},steel:{day:"#aba58f",night:"#535b5b",jitter:.012},enamel:{day:"#174ec6",night:"#315aca",jitter:.012},key:{day:"#f2ebda",night:"#505966",jitter:.006},ivory:{day:"#fffefa",night:"#d7dbf0",jitter:.006},light:{day:"#388de6",night:"#458fe3",glow:.68},signal:{day:"#388de6",night:"#458fe3",glow:1}},parts:{button:ns,field:ss,meter:as,card:is,toast:us,toggle:fs,tabs:ds,...No}});for(let[t,e]of Object.entries({panel:"#e2d8c1",backlight:"#ffb45f","cap-inlay":"#909b80","cap-ridge":"#637a6c"}))bt(t,{day:e,jitter:.006});var st=(t,e={})=>({day:t,night:t,...e}),le={shell:"walnut",caps:"field",profile:"high",lamp:"amber",level:7,rail:"steady"};function Ho(t={}){let e=(n,o)=>Object.hasOwn(n,o);return{shell:e(Xt,t?.shell)?t.shell:le.shell,caps:e(Me,t?.caps)?t.caps:le.caps,profile:t?.profile==="low"?"low":"high",lamp:e(ve,t?.lamp)?t.lamp:le.lamp,rail:t?.rail==="spectrum"?"spectrum":"steady",level:Number.isFinite(t?.level)?Math.max(0,Math.min(10,Math.round(t.level))):le.level}}function Wo(t,e,n){let o=t.shell,r=Xt[o],s=Me[t.caps],a=ve[t.lamp].hue;to(r.treble);let c=Se(o),i=Se(o,!0),l=b=>({day:c[b],night:i[b]}),u=l("--vx-ink"),d=l("--panel"),f={"--case-lamp":a,"--lamp-level":t.level/10},g=[o,t.caps,t.profile].join("/"),m=rt.instrument?.tooling!==g,p=rt.instrument;m&&(p=zt("instrument",{from:"lit",tooling:g,readingPlate:"panel",artwork:t.caps==="field",rise:t.profile==="high"?7:3,travel:t.profile==="high"?4:2,grain:1,seam:.45,finishes:{...rt.lit.finishes,chalk:r.face,key:s.face,"lamp-cap":s.face,"warm-metal":J(65,105),"spun-brass":J(10,85)},materials:{panel:{...d},chalk:st(r.plate,{grain:r.grain,transmission:r.transmission,jitter:.004}),"lamp-cap":st(s.key,{transmission:s.transmission,jitter:.007}),key:st(s.key,{transmission:s.transmission,jitter:.009}),ink:{...u},steel:st("#9d998a"),gasket:st("#232824"),slate:st("#515754"),floor:l("--vx-floor"),ivory:st("#dcd5c1"),enamel:rt.lit.appliedTheme?.cap??st("#aa4a27"),"warm-metal":st("#baaa8b",{grain:(b,x)=>.013*Math.sin(Math.hypot(b,x)*2.5)})}}));let h=t.level/10,y=p.illuminant!==a||p.dimmer!==h;if(y){p.illuminant=a,p.dimmer=h;let b=[1,3,5].map(w=>parseInt(a.slice(w,w+2),16)),x="#"+b.map(w=>Math.round(42+(w-42)*h).toString(16).padStart(2,"0")).join("");if(p.materials.backlight=st(x,{glow:h}),s.transmission){let w="#"+b.map((M,k)=>{let v=parseInt(s.key.slice(1+2*k,3+2*k),16);return Math.round(v+(M-v)*h*.35).toString(16).padStart(2,"0")}).join("");p.materials.key=st(w,{transmission:s.transmission})}delete p._table}s.transmission?f["--vx-key"]=p.materials.key.day:e.style.removeProperty("--vx-key");for(let[b,x]of Object.entries(f))e.style.setProperty(b,x);if(e.dataset.rail=t.rail,e.dataset.shell=t.shell,e.dataset.caps=t.caps,e.dataset.profile=t.profile,n)for(let b of n.lives.values())m?b.retint():b.look===p&&y&&b.recolor()}var hs=`#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aFace;   // face index, corner index
layout(location=3) in vec2 aUv;
layout(location=4) in vec4 iPos;    // centre xyz, scale
layout(location=5) in vec4 iQuat;
layout(location=6) in vec4 iColor;  // rgb, glow
layout(location=7) in uvec2 iAo;
layout(location=8) in vec4 iMould;
uniform vec4 uView;   // origin x, origin y (device px), px per voxel, 0
uniform vec2 uShear;
uniform vec2 uSize;
out float vSpecular; out float vBias; out vec3 vN; out vec3 vP; out vec2 vUv; out float vAo; out vec4 vColor;
vec3 rot(vec3 v, vec4 q) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main() {
  vec3 p = iPos.xyz + rot(aPos * iPos.w, iQuat);
  vSpecular = float(iAo.y >> 24u) / 255.0;
  vBias = iMould.w;
  vN = rot(mix(aNormal, iMould.xyz, iMould.w), iQuat);
  vP = p; vUv = aUv; vColor = iColor;
  int f = int(aFace.x); int c = int(aFace.y);
  uint bits = f < 4 ? (iAo.x >> uint(f * 8 + c * 2)) : (iAo.y >> uint((f - 4) * 8 + c * 2));
  vAo = float(bits & 3u) * (1.0 - iMould.w * 0.8);
  float px = uView.x + (p.x + uShear.x * p.z) * uView.z;
  float py = uView.y + (p.y + uShear.y * p.z) * uView.z;
  gl_Position = vec4(px / uSize.x * 2.0 - 1.0, 1.0 - py / uSize.y * 2.0, -p.z / 512.0, 1.0);
}`,Uo=`
uniform highp sampler2DShadow uShadow;
uniform vec2 uLShear;   // how far a shadow travels per voxel of height
uniform vec4 uLRect;    // u0, v0, 1/width, 1/height of the shadow map, in voxels
uniform float uSoft;    // penumbra radius, voxels
float lit(vec3 p, vec3 n) {
  vec3 q = p + n * 0.08;
  vec2 uv = (vec2(q.x + uLShear.x * q.z, q.y + uLShear.y * q.z) - uLRect.xy) * uLRect.zw;
  float ref = 0.5 - (q.z + 0.06) / 1024.0;
  vec2 r = uSoft * uLRect.zw;
  float s = 0.0;
  for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++)
    s += texture(uShadow, vec3(uv + vec2(float(i), float(j)) * r * 0.5, ref));
  return s / 25.0;
}`,ps=`#version 300 es
precision highp float;
in float vSpecular; in float vBias; in vec3 vN; in vec3 vP; in vec2 vUv; in float vAo; in vec4 vColor;
uniform vec3 uToLight;
uniform float uSun;
uniform vec4 uAmbient;      // top, front, side, under
uniform vec3 uAmbientTint;
uniform vec3 uHighlight;
uniform float uSeam;
uniform float uGlow;
uniform float uPx;          // device px per voxel
uniform vec4 uWell;         // the hole in the page, on the page plane: x0, y0, x1, y1 (voxels)
uniform vec2 uWellShear;
${Uo}
out vec4 o;
void main() {
  if (vP.z < -0.001) { // the page hides whatever sinks into it, except through a well cut for it
    vec2 s = vP.xy + uWellShear * vP.z;
    if (s.x < uWell.x || s.y < uWell.y || s.x > uWell.z || s.y > uWell.w) discard;
  }
  vec3 n = normalize(vN);
  vec3 n2 = n * n;
  float amb = n2.x * uAmbient.z
            + n2.y * (n.y < 0.0 ? uAmbient.x : uAmbient.w)
            + n2.z * (n.z > 0.0 ? uAmbient.y : uAmbient.w);
  float ndl = max(dot(n, uToLight), 0.0);
  float sh = ndl > 0.0 ? lit(vP + n * vBias * 0.65, n) : 0.0;
  float ao = 1.0 - vAo * 0.17;
  float direct = uSun * ndl * sh;
  float l = amb * ao + direct;
  // Shadowed faces lean toward the ambient tint; lit faces above 1 lean toward the highlight.
  vec3 base = vColor.rgb;
  vec3 c = base * min(l, 1.0);
  c = mix(c * uAmbientTint, c, clamp(direct / (uSun * 0.6), 0.0, 1.0));
  c = mix(c, uHighlight, mix(1.0, vSpecular, vBias) * clamp((l - 1.0) * 1.5, 0.0, 0.55));
  if (vBias > 0.0 && direct > 0.0) {
    vec3 halfVector = normalize(uToLight + normalize(vec3(-uWellShear, 1.0)));
    c += uHighlight * (vSpecular * direct * pow(max(dot(n, halfVector), 0.0), 6.0));
  }
  // Seams: one device pixel along every voxel edge, so the grid stays countable.
  vec2 e = min(vUv, 1.0 - vUv) * uPx;
  float seam = vColor.a < 0.0 ? 0.0 : 1.0 - smoothstep(0.0, 1.0, min(e.x, e.y));
  c *= 1.0 - seam * uSeam;
  // Voxels that glow keep their colour whatever the light does.
  float g = max(vColor.a, 0.0) * uGlow;
  c = mix(c, base * (0.86 + 0.14 * min(l, 1.15)) * (1.0 - seam * uSeam * 0.5), g * 0.36);
  float through = clamp(-1.0 - vColor.a, 0.0, 1.0);
  float facing = abs(dot(n, normalize(vec3(-uWellShear, 1.0))));
  float grazing = pow(1.0 - min(facing, 1.0), 3.0) * through;
  float opacity = 1.0 - through + grazing * .65;
  o = vec4(mix(c, uHighlight, grazing * .45) * opacity, opacity);
}`,ms=`#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=4) in vec4 iPos;
layout(location=5) in vec4 iQuat;
uniform vec2 uLShear; uniform vec4 uLRect;
vec3 rot(vec3 v, vec4 q) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main() {
  vec3 p = iPos.xyz + rot(aPos * iPos.w, iQuat);
  vec2 uv = (vec2(p.x + uLShear.x * p.z, p.y + uLShear.y * p.z) - uLRect.xy) * uLRect.zw;
  gl_Position = vec4(uv * 2.0 - 1.0, -p.z / 512.0, 1.0);
}`,gs=`#version 300 es
precision highp float;
void main() {}`,bs=`#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner; // 0..1
uniform vec4 uView; uniform vec2 uSize;
out vec3 vP;
void main() {
  vec2 px = aCorner * uSize;
  vP = vec3((px - uView.xy) / uView.z, 0.0);
  gl_Position = vec4(aCorner.x * 2.0 - 1.0, 1.0 - aCorner.y * 2.0, 0.0, 1.0);
}`,xs=`#version 300 es
precision highp float;
in vec3 vP;
uniform vec4 uShadowColor;
${Uo}
out vec4 o;
void main() {
  float a = (1.0 - lit(vP, vec3(0.0, 0.0, 1.0))) * uShadowColor.a;
  o = vec4(uShadowColor.rgb * a, a);
}`,ys=`#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner; // -1..1
layout(location=4) in vec4 iPos;
layout(location=6) in vec4 iColor;
uniform vec4 uView; uniform vec2 uShear; uniform vec2 uSize; uniform float uRadius;
out vec2 vC; out vec4 vColor;
void main() {
  vC = aCorner; vColor = iColor;
  float r = iColor.a > 0.0 ? uRadius * iPos.w : 0.0; // glow of 0 or the no-seam mark: no halo
  float px = uView.x + (iPos.x + uShear.x * iPos.z + aCorner.x * r) * uView.z;
  float py = uView.y + (iPos.y + uShear.y * iPos.z + aCorner.y * r) * uView.z;
  gl_Position = vec4(px / uSize.x * 2.0 - 1.0, 1.0 - py / uSize.y * 2.0, -(iPos.z + 0.6) / 512.0, 1.0);
}`,ws=`#version 300 es
precision highp float;
in vec2 vC; in vec4 vColor;
uniform float uStrength;
out vec4 o;
void main() {
  float d = dot(vC, vC);
  float g = exp(-d * 3.2) * (1.0 - smoothstep(0.7, 1.0, d)) * uStrength * vColor.a;
  o = vec4(vColor.rgb * g, g * 0.35);
}`;function Bo(t,e,n){let o=t.createShader(e);if(t.shaderSource(o,n),t.compileShader(o),!t.getShaderParameter(o,t.COMPILE_STATUS))throw new Error(t.getShaderInfoLog(o)+`
`+n);return o}function ue(t,e,n){let o=t.createProgram();if(t.attachShader(o,Bo(t,t.VERTEX_SHADER,e)),t.attachShader(o,Bo(t,t.FRAGMENT_SHADER,n)),t.linkProgram(o),!t.getProgramParameter(o,t.LINK_STATUS))throw new Error(t.getProgramInfoLog(o));let r={},s=t.getProgramParameter(o,t.ACTIVE_UNIFORMS);for(let a=0;a<s;a++){let c=t.getActiveUniform(o,a);r[c.name]=t.getUniformLocation(o,c.name)}return{p:o,u:r}}function ks(){let t=[{n:[1,0,0],a:[0,1,0],b:[0,0,1]},{n:[-1,0,0],a:[0,1,0],b:[0,0,1]},{n:[0,1,0],a:[1,0,0],b:[0,0,1]},{n:[0,-1,0],a:[1,0,0],b:[0,0,1]},{n:[0,0,1],a:[1,0,0],b:[0,1,0]},{n:[0,0,-1],a:[1,0,0],b:[0,1,0]}],e=[[-1,-1],[1,-1],[1,1],[-1,1]],n=[0,1,2,0,2,3],o=[];return t.forEach((r,s)=>{for(let a of n){let[c,i]=e[a];o.push(.5*(r.n[0]+r.a[0]*c+r.b[0]*i),.5*(r.n[1]+r.a[1]*c+r.b[1]*i),.5*(r.n[2]+r.a[2]*c+r.b[2]*i),r.n[0],r.n[1],r.n[2],s,a,(c+1)/2,(i+1)/2)}}),new Float32Array(o)}var St=class{static supported(){try{return!!document.createElement("canvas").getContext("webgl2")}catch{return!1}}constructor(){this.canvas=document.createElement("canvas"),this.canvas.width=512,this.canvas.height=256;let e=this.canvas.getContext("webgl2",{alpha:!0,premultipliedAlpha:!0,antialias:!0,depth:!0,stencil:!1,powerPreference:"low-power"});if(!e)throw new Error("WebGL2 is not available");this.gl=e,this.lost=!1,this.canvas.addEventListener("webglcontextlost",n=>{n.preventDefault(),this.lost=!0}),this.canvas.addEventListener("webglcontextrestored",()=>{this.lost=!1,this.init(),this.onrestore?.()}),this.init()}init(){let e=this.gl;this.main=ue(e,hs,ps),this.shadow=ue(e,ms,gs),this.ground=ue(e,bs,xs),this.glow=ue(e,ys,ws),this.bufPos=e.createBuffer(),this.bufCol=e.createBuffer(),this.bufNormals=e.createBuffer(),this.bufAo=e.createBuffer(),this.capacity=0,this.vaoCube=e.createVertexArray(),e.bindVertexArray(this.vaoCube);let n=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,n),e.bufferData(e.ARRAY_BUFFER,ks(),e.STATIC_DRAW);let o=40;e.enableVertexAttribArray(0),e.vertexAttribPointer(0,3,e.FLOAT,!1,o,0),e.enableVertexAttribArray(1),e.vertexAttribPointer(1,3,e.FLOAT,!1,o,12),e.enableVertexAttribArray(2),e.vertexAttribPointer(2,2,e.FLOAT,!1,o,24),e.enableVertexAttribArray(3),e.vertexAttribPointer(3,2,e.FLOAT,!1,o,32),this.bindInstances(),this.vaoGround=e.createVertexArray(),e.bindVertexArray(this.vaoGround);let r=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,r),e.bufferData(e.ARRAY_BUFFER,new Float32Array([0,0,1,0,1,1,0,0,1,1,0,1]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0),this.vaoGlow=e.createVertexArray(),e.bindVertexArray(this.vaoGlow);let s=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,s),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,1,1,-1,-1,1,1,-1,1]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0),this.bindInstances(),e.bindVertexArray(null),this.shadowTex=e.createTexture(),e.bindTexture(e.TEXTURE_2D,this.shadowTex),e.texImage2D(e.TEXTURE_2D,0,e.DEPTH_COMPONENT24,2048,2048,0,e.DEPTH_COMPONENT,e.UNSIGNED_INT,null),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_COMPARE_MODE,e.COMPARE_REF_TO_TEXTURE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_COMPARE_FUNC,e.LEQUAL),this.shadowFbo=e.createFramebuffer(),e.bindFramebuffer(e.FRAMEBUFFER,this.shadowFbo),e.framebufferTexture2D(e.FRAMEBUFFER,e.DEPTH_ATTACHMENT,e.TEXTURE_2D,this.shadowTex,0),e.drawBuffers([e.NONE]),e.readBuffer(e.NONE),e.bindFramebuffer(e.FRAMEBUFFER,null)}bindInstances(){let e=this.gl;e.bindBuffer(e.ARRAY_BUFFER,this.bufPos),e.enableVertexAttribArray(4),e.vertexAttribPointer(4,4,e.FLOAT,!1,32,0),e.vertexAttribDivisor(4,1),e.enableVertexAttribArray(5),e.vertexAttribPointer(5,4,e.FLOAT,!1,32,16),e.vertexAttribDivisor(5,1),e.bindBuffer(e.ARRAY_BUFFER,this.bufCol),e.enableVertexAttribArray(6),e.vertexAttribPointer(6,4,e.FLOAT,!1,0,0),e.vertexAttribDivisor(6,1),e.bindBuffer(e.ARRAY_BUFFER,this.bufAo),e.enableVertexAttribArray(7),e.vertexAttribIPointer(7,2,e.UNSIGNED_INT,0,0),e.vertexAttribDivisor(7,1)}draw(e,n){if(this.lost)return!1;let o=this.gl,{wpx:r,hpx:s,count:a,light:c}=e;if(r<1||s<1)return!1;(this.canvas.width<r||this.canvas.height<s)&&(this.canvas.width=Math.max(this.canvas.width,Math.ceil(r/256)*256),this.canvas.height=Math.max(this.canvas.height,Math.ceil(s/256)*256));let i=this.canvas.height;o.bindBuffer(o.ARRAY_BUFFER,this.bufPos),o.bufferData(o.ARRAY_BUFFER,e.pos.subarray(0,a*8),o.DYNAMIC_DRAW),o.bindBuffer(o.ARRAY_BUFFER,this.bufCol),o.bufferData(o.ARRAY_BUFFER,e.col.subarray(0,a*4),o.DYNAMIC_DRAW),o.bindBuffer(o.ARRAY_BUFFER,this.bufAo),o.bufferData(o.ARRAY_BUFFER,e.ao.subarray(0,a*2),o.DYNAMIC_DRAW);let l=c.toLight,u=-l[0]/l[2],d=-l[1]/l[2],f=6,[g,m,p,h]=e.bounds,y=g-f,b=m-f,x=p-g+f*2,w=h-m+f*2,M=Math.min(2048/x,2048/w,12),k=Math.max(1,Math.round(x*M)),v=Math.max(1,Math.round(w*M)),S=[y,b,k/2048/x,v/2048/w];o.bindFramebuffer(o.FRAMEBUFFER,this.shadowFbo),o.viewport(0,0,k,v),o.enable(o.SCISSOR_TEST),o.scissor(0,0,Math.min(2048,k+8),Math.min(2048,v+8)),o.enable(o.DEPTH_TEST),o.depthFunc(o.LEQUAL),o.depthMask(!0),o.clearDepth(1),o.clear(o.DEPTH_BUFFER_BIT),o.disable(o.BLEND),o.disable(o.CULL_FACE),o.colorMask(!1,!1,!1,!1),a&&(o.useProgram(this.shadow.p),o.uniform2f(this.shadow.u.uLShear,u,d),o.uniform4f(this.shadow.u.uLRect,y,b,1/x,1/w),o.bindVertexArray(this.vaoCube),o.drawArraysInstanced(o.TRIANGLES,0,36,a)),o.colorMask(!0,!0,!0,!0),o.bindFramebuffer(o.FRAMEBUFFER,null),o.viewport(0,0,r,s),o.scissor(0,0,r,s),o.clearColor(0,0,0,0),o.clear(o.COLOR_BUFFER_BIT|o.DEPTH_BUFFER_BIT),o.activeTexture(o.TEXTURE0),o.bindTexture(o.TEXTURE_2D,this.shadowTex);let R=[e.ox,e.oy,e.s,0],A=e.soft??.22;if(o.useProgram(this.ground.p),o.uniform4fv(this.ground.u.uView,R),o.uniform2f(this.ground.u.uSize,r,s),o.uniform4f(this.ground.u.uShadowColor,c.shadow[0],c.shadow[1],c.shadow[2],c.shadow[3]*(e.groundShadow??1)),o.uniform1i(this.ground.u.uShadow,0),o.uniform2f(this.ground.u.uLShear,u,d),o.uniform4fv(this.ground.u.uLRect,S),o.uniform1f(this.ground.u.uSoft,A*1.25),o.disable(o.DEPTH_TEST),o.depthMask(!1),o.enable(o.BLEND),o.blendFunc(o.ONE,o.ONE_MINUS_SRC_ALPHA),o.bindVertexArray(this.vaoGround),o.drawArrays(o.TRIANGLES,0,6),a){o.bindVertexArray(this.vaoCube),e.normals?(o.bindBuffer(o.ARRAY_BUFFER,this.bufNormals),o.bufferData(o.ARRAY_BUFFER,e.normals.subarray(0,a*4),o.DYNAMIC_DRAW),o.enableVertexAttribArray(8),o.vertexAttribPointer(8,4,o.BYTE,!0,0,0),o.vertexAttribDivisor(8,1)):(o.disableVertexAttribArray(8),o.vertexAttrib4f(8,0,0,0,0)),o.useProgram(this.main.p);let E=this.main.u;if(o.uniform4fv(E.uView,R),o.uniform2fv(E.uShear,e.shear),o.uniform2f(E.uSize,r,s),o.uniform3fv(E.uToLight,l),o.uniform1f(E.uSun,c.sun),o.uniform4f(E.uAmbient,c.ambient.top,c.ambient.front,c.ambient.side,c.ambient.under),o.uniform3fv(E.uAmbientTint,c.ambientTint),o.uniform3fv(E.uHighlight,c.highlight),o.uniform1f(E.uSeam,c.seam),o.uniform1f(E.uGlow,c.glow),o.uniform1f(E.uPx,e.s),o.uniform4fv(E.uWell,e.well??[0,0,-1,-1]),o.uniform2fv(E.uWellShear,e.shear),o.uniform1i(E.uShadow,0),o.uniform2f(E.uLShear,u,d),o.uniform4fv(E.uLRect,S),o.uniform1f(E.uSoft,A),o.enable(o.DEPTH_TEST),o.depthMask(!0),o.disable(o.BLEND),o.bindVertexArray(this.vaoCube),o.drawArraysInstanced(o.TRIANGLES,0,36,a),c.glow>0&&e.glows){o.useProgram(this.glow.p);let L=this.glow.u;o.uniform4fv(L.uView,R),o.uniform2fv(L.uShear,e.shear),o.uniform2f(L.uSize,r,s),o.uniform1f(L.uRadius,e.glowRadius??2.4),o.uniform1f(L.uStrength,c.glow*(e.glowStrength??.11)),o.depthMask(!1),o.enable(o.BLEND),o.blendFunc(o.ONE,o.ONE_MINUS_SRC_ALPHA),o.bindVertexArray(this.vaoGlow),o.drawArraysInstanced(o.TRIANGLES,0,6,a),o.depthMask(!0)}}return o.bindVertexArray(null),o.disable(o.SCISSOR_TEST),n.clearRect(0,0,r,s),n.drawImage(this.canvas,0,i-s,r,s,0,0,r,s),!0}};for(let[t,e]of Object.entries({"lamp-cap":"#eee4cd","key-plate":"#353b35","key-liner":"#222722","key-bed":"#191e1b","pilot-glass":"#50564b"}))bt(t,{day:e,jitter:.006});function Ms(t,e,n,o,r,s,a){let c=Math.max(2,Math.round(r*.12)),i=Math.max(3,Math.round(s*.29)),l=t.el.offsetLeft/t.vx,u;for(let d=0;d<a;d++){let f=d/(a-1),g=n+Math.round(f*c*.35),m=n+r-1-Math.round(f**2*c*1.3),p=o+Math.round(f*2),h=o+s-1-Math.round(f*i),y=Math.max(2,Math.round(r*(.06+.05*f)));for(let b=g;b<=m;b++){let x=(b-g)/(m-g),w=Math.abs(x*2-1),M=Math.max(0,y-Math.min(b-g,m-b)-.5),k=Math.round(y-Math.sqrt(y*y-M*M)),v=p+k,S=h-k-Math.round(f*w**2*s*.05);if(e.box(b,v,d,1,S-v+1,1,"lamp-cap"),d!==a-1)continue;let R=b===g+Math.round((m-g)*.2),A=Math.min(S,Math.max(v,p+Math.round((h-p)*.14))),E=.82+.09*Math.sin((l+b)*.13)+.05*Math.sin((l+b)*.31);for(let L=v;L<=S;L++){let P=(L-p)/Math.max(1,h-p),I=Math.round(w**3+.09*P);e.box(b,L,d+1,1,1,I,"lamp-cap"),t.look.artwork&&P>=E&&e.plot(b,L,d+I,P>E+.08?"cap-ridge":"cap-inlay"),R&&L===A&&(u={x:b,y:L,z:d+I})}}}return u}function vs(t,e,n,o,r,s,a){let[c,i,l]=r,u=o.x+.5,d=Math.max(o.y+.5,Math.min(o.end-.5,i)),f=o.z+.5,g=c-u,m=i-d,p=l-f,h=Math.hypot(g,m,p);if(h>7)return 0;let y=.52/(1+h*h*.17);for(let b=.55;b<h-.65;b+=.65){let x=b/h,w=Math.floor(u+g*x),M=Math.floor(d+m*x),k=f+p*x;if(e.has(w,M,Math.floor(k))||n.has(w,M,Math.floor(k-n.tz)))return 0;if(t.has(w,M,Math.floor(k-s))){if(!a)return 0;y*=a}}return y}function Ss(t,e,n,o){let{cap:r,plate:s,walls:a,floor:c,emitter:i,diffuser:l,pilot:u}=t.model.byName,d=t.look.materials["lamp-cap"]?.transmission??0,f=[.2,.23,.21],g=[.33,.37,.34],m,p,h,y,b;return()=>{let x=!t.state.off&&t.el.getAttribute("aria-pressed")==="true",w=x?t.look.dimmer??1:0,M=x&&t.el.dataset.vxPilot==="status"?1:w,k=Math.round(r.tz*2)/2;if(m===t.tintRevision&&p===w&&h===M&&(!w||y===k))return;if(m!==t.tintRevision){b=[];for(let R of[a,c,r])for(let A=0;A<R.count;A++){let[E,L,P]=R.rest.subarray(A*3,A*3+3),I=Math.max(n.x+.5,Math.min(n.x+o-.5,E)),U=R===r&&d?Math.hypot(E-I,L-n.y-.5,P-n.z-.5):1/0,q=U<9?d*Math.exp(-U/3):0;!q&&(Math.abs(E-e.x)>8||L<e.y-7||L>e.end+7)||b.push({part:R,i:A,x:E,y:L,z:P,frost:q,base:R.col.slice(A*4,A*4+3)})}m=t.tintRevision}let v=t.look.illuminant??"#71e2cd",S=[1,3,5].map(R=>parseInt(v.slice(R,R+2),16)/255);for(let R of[i,l,u]){let A=R===u?M:w,E=R===u?g:f;for(let L=0;L<R.count;L++){for(let P=0;P<3;P++)R.col[L*4+P]=E[P]*(1-A)+S[P]*A;R.col[L*4+3]=A}}for(let{part:R,i:A,x:E,y:L,z:P,base:I,frost:U}of b){let q=w&&vs(r,s,a,e,[E,L,P+(R===r?k:0)],k,d),tt=M*U+w*q;for(let G=0;G<3;G++)R.col[A*4+G]=I[G]+(S[G]-I[G])*tt}p=w,h=M,y=k,t.glows=!1}}var qo={...Wt,name:"lamp-key",selector:".vx-button[data-lamp]",momentary:!0,soft:.22,pad:3,plain(t,e){return Y(t),Wt.plain(t,e,{momentary:!0})},build(t,e){let{W:n,H:o,el:r}=t;if(n<12||o<12){t.state.lightPocket=null;return}let s=Math.max(1,Math.round(Math.min(n,o)*.045)),a=n-s*2,c=o-s*2,i=t.look.rise>=6,l=Math.max(3,Math.min(i?10:5,Math.round(c*(i?.24:.14))));e.keyTravel=i?l-1:Math.max(2,l-2);let u=e.keyTravel+2,{walls:d,floor:f}=C(t,e,{x:s,y:s,w:a,h:c,depth:u,wall:"key-liner",floor:"key-bed"}),g=Math.max(2,Math.round(Math.min(a,c)*.15)),m=Math.floor((n-g)/2),p=Math.floor((o-g)/2),h=-u-e.keyTravel-2,y=-e.keyTravel,b=e.part("guide");b.grounded=!1,f.carve(m-2,p-2,-u-1,g+4,g+4,1),b.box(m-2,p-2,h,g+4,g+4,y-h,"key-liner"),b.carve(m-1,p-1,h+1,g+2,g+2,y-h-1);let x=e.part("stem");x.grounded=!1,x.box(m,p,-u,g,g,u,"steel"),e.part("plate").box(0,0,0,n,o,1,"key-plate").carve(s,s,0,a,c,1);let M=Math.max(1,Math.round(Math.min(a,c)*.055)),k={x:s+a-M,y:s+Math.floor(c*.42),z:-2};k.end=k.y+Math.max(2,Math.round(c*.21)),d.box(k.x+1,k.y,k.z-1,M-1,k.end-k.y,2,"key-liner");for(let[E,L]of[["emitter",k.z-1],["diffuser",k.z]]){let P=e.part(E);P.grounded=!1,P.box(k.x,k.y,L,1,k.end-k.y,1,"pilot-glass")}let v=e.part("cap");v.grounded=!1,v.mouldRadius=4;let S=Math.max(2,M),R=Ms(t,v,s+S,s+M,a-S-M,c-2*M,l),A=Math.max(2,Math.round(a*.12));v.carve(R.x,R.y,R.z,A,1,3),e.part("pilot").box(R.x,R.y,R.z,A,1,1,"pilot-glass").grounded=!1,t.label(r.querySelector(":scope > .vx-label"),()=>v.tz),t.state.off=r.matches(':disabled,[aria-disabled="true"]'),t.state.lightPocket=Ss(t,k,R,A),t.glowStrength=0},pose(t){if(!t.state.lightPocket)return;let{cap:e,stem:n,pilot:o}=t.model.byName;e.tz=n.tz=o.tz=t.state.off?0:Math.max(-t.model.keyTravel,Math.min(0,t.spring("press").x)),t.state.lightPocket()}};function As(t,e){let{el:n,vx:o,cssW:r,cssH:s,W:a,H:c}=t,i=n.parentElement.querySelector(".faceplate");if(!i)return;let l=i.offsetLeft-n.offsetLeft-(r-a*o)/2,u=i.offsetTop-n.offsetTop-(s-c*o)/2,d=Math.round(l/o)-1,f=Math.round(u/o)-1,g=Math.round((l+i.offsetWidth)/o),m=Math.round((u+i.offsetHeight)/o),p=e.part("casting"),h=l<3*o?6:3;for(let y=f;y<=m;y++){let b=Math.min(y-f,m-y);for(let x=d;x<=g;x++){let w=Math.min(x-d,g-x),M=Math.min(w,b,Math.floor((w+b-h)/1.5));M===0&&p.box(x,y,0,1,1,2,"slate"),(M===1||M===2)&&p.plot(x,y,0,"gasket")}}t.faceZ=2}var jo={name:"backplane",selector:".vx-backplane",pad:4,build(t,e){let{W:n,H:o}=t;if(n<20||o<12||(t.el.hasAttribute("data-vx-casting")&&As(t,e),!t.look.materials.chalk?.transmission))return;let r=e.part("traces"),s=e.part("solder"),a=e.part("packages"),c=e.part("emitters");if(e.byName.casting){t.well=[0,0,n,o];for(let l of[r,s,a,c])l.tz=-4,l.tx=l.ty=(t.faceZ-l.tz)/2,l.sunk=!0}let i=Math.floor(o*.57);for(let l=0;l<4;l++){let u=Math.floor((l+.5)*n/4),d=i+l*2;r.box(u,d,0,n-3-u,1,1,"warm-metal"),r.box(u,d,0,1,o-4-d,1,"warm-metal");for(let f of[d,o-5])s.slab(u-1,f-1,1,3,3,1,"steel",1),a.box(u-1,f,2,3,1,1,"gasket");c.box(u-1,o-5,3,2,1,1,t.look.tooling?"backlight":"light")}for(let l of[3,n-8])for(let u=6;u<i;u+=5)s.box(l,u,0,4,2,1,"steel"),a.box(l+1,u,1,2,2,1,"gasket")}};var Go=Math.PI*1.5,Ko=t=>ot((t.valueAsNumber-Number(t.min||0))/(Number(t.max||100)-Number(t.min||0)||1),0,1),Xo=t=>(Ko(t)-.5)*Go;function Vo(t,e,n=()=>{}){let o=t.querySelector("input"),r;function s(){t.style.setProperty("--angle",Xo(o)+"rad"),n()}let a=(i,l)=>Math.atan2(i,-l);e(o,"pointerdown",i=>{if(i.button!==0||r||o.disabled)return;i.preventDefault(),o.focus({preventScroll:!0});let l=o.getBoundingClientRect(),u=l.left+l.width/2,d=l.top+l.height/2;r={id:i.pointerId,cx:u,cy:d,y:i.clientY,span:Math.max(96,l.height),angular:Math.hypot(i.clientX-u,i.clientY-d)>l.width*.19,last:a(i.clientX-u,i.clientY-d),t:Ko(o),start:o.value},o.setPointerCapture(i.pointerId)}),e(o,"pointermove",i=>{if(r?.id!==i.pointerId)return;let l=a(i.clientX-r.cx,i.clientY-r.cy),u=l-r.last;r.t=ot(r.t+(r.angular?Math.atan2(Math.sin(u),Math.cos(u))/Go:(r.y-i.clientY)/r.span),0,1),r.y=i.clientY,r.last=l;let d=o.value,f=Number(o.min||0);o.value=f+r.t*(Number(o.max||100)-f),o.value!==d&&o.dispatchEvent(new Event("input",{bubbles:!0}))});function c(i){if(r?.id!==i.pointerId)return;let l=r.start!==o.value;r=null,l&&o.dispatchEvent(new Event("change",{bubbles:!0}))}for(let i of["pointerup","pointercancel","lostpointercapture"])e(o,i,c);e(o,"input",i=>{s();let l=(Number(o.max||100)-Number(o.min||0))/Number(o.step||1);l>0&&l<=32&&(i.isTrusted||r)&&N(t.dataset.vxDetent==="release"?"detent":"tick")}),e.heed(o,"value",s),e.watch(o,{attributes:!0,attributeFilter:["min","max","step","value"]},s),s()}var Yo={name:"rotary",selector:".vx-rotary",pad:6,build(t,e){let{W:n,H:o}=t,r=n/2,s=o/2,a=Math.max(3,Math.min(r,s)-2),c=e.part("collar"),i=e.part("drum"),l=e.part("face");l.tx=Math.floor(r),l.ty=Math.floor(s);let u=e.part("index");u.axle=i.axle={x:r,y:s,angle:0};for(let d=0;d<o;d++)for(let f=0;f<n;f++){let g=f+.5-r,m=d+.5-s,p=Math.hypot(g,m),h=Math.atan2(g,-m);if(p<=a+1.5&&c.box(f,d,0,1,1,2,"gasket"),p>a)continue;let y=Math.cos(h*24);(p<a-1||y>-.3)&&i.box(f,d,2,1,1,5,y>.25?"steel":"slate"),p<a-1&&(l.plot(f-l.tx,d-l.ty,7,"warm-metal"),p<a-2&&l.plot(f-l.tx,d-l.ty,8,"spun-brass")),Math.abs(g)<.85&&m<-a*.38&&p<a-3&&u.plot(f,d,9,"gasket")}t.faceZ=6},pose(t){t.model.byName.drum.axle.angle=Xo(t.el.querySelector("input"))},bind(t){let e=F();return Vo(t.el,e,()=>t.invalidate()),e.done},plain:Vo};var fe=5,Zo={name:"slider",selector:".vx-slider:not(.contour-fader)",pad:6,build(t,e){let{W:n,H:o}=t,r=Math.floor((o-5)/2);e.part("rail").slab(0,r,0,n,5,2,"steel",1).carve(1,r+1,1,n-2,3,1),e.part("floor").box(1,r+1,0,n-2,3,1,"slate");let s=e.part("lit");s.masked=!0,s.grounded=!1,s.covered=!0,s.box(1,r+1,0,n-2,3,1,"signal"),s.tz=.03;let a=e.part("thumb");a.grounded=!1,a.slab(0,1,1,fe,o-2,4,t.el.querySelector("input")?.matches(":disabled")?"steel":"enamel",1),t.faceZ=2,t.state.inlineX=K(t),t.state.travel=n-fe},pose(t){let e=t.el.querySelector("input"),{thumb:n,lit:o}=t.model.byName,r=Number(e.min||0),s=Number(e.max||100),c=(s>r?ot((Number(e.value)-r)/(s-r),0,1):0)*t.state.travel;n.tx=t.state.inlineX(c,fe),n.tz=t.spring("press").x;let i=c+fe/2;for(let l=0;l<o.count;l++)o.scales[l]=Math.max(0,Math.min(1,i-t.state.inlineX(o.rest[l*3],0)+.5))},bind(t){let e=F();Q(t,e);let n=t.el.querySelector("input"),o=t.spring("press");e(n,"input",()=>{N("tick"),t.invalidate()}),e(n,"change",()=>t.invalidate()),e.heed(n,"value",()=>t.invalidate());let r=(c,i)=>{z()?o.snap(c):o.to(c,i.k,i.c),t.invalidate()};e(n,"pointerdown",c=>{c.button===0&&!n.matches(":disabled")&&r(-1.5,D)});let s=()=>{o.target!==0&&r(0,j)};for(let c of["pointerup","pointercancel","blur"])e(window,c,s);n.form&&e(n.form,"reset",()=>queueMicrotask(()=>t.invalidate()));let a=()=>{n.matches(":disabled")&&o.snap(0),t.rebuild()};return it(n,e,a),e.watch(n,{attributes:!0,attributeFilter:["disabled","min","max","value"]},a),e.done}};var Es=new WeakSet;async function Rs(t,e,n){if(t.setAttribute("data-vx-leaving",""),!e)return;let o=t.getBoundingClientRect(),r=n&&(n.clientX||n.clientY)?[(n.clientX-o.left)/e.vx,(n.clientY-o.top)/e.vx]:void 0;r&&N("break");let s=t.dataset.vxSpecimen==="deploy"?.29:.19;await e.play("crumble",null,{duration:s,from:r,contact:!!r})}var gt=null;function $o(t,e){return function(o,r={}){(!gt||!gt.isConnected)&&(gt=document.createElement("div"),gt.className="vx-toasts",gt.setAttribute("role","region"),gt.setAttribute("aria-label","Notifications"),document.body.append(gt));let s=document.createElement("div");s.className="vx-toast",s.setAttribute("role",r.kind==="failed"?"alert":"status"),s.dataset.vxKind=r.kind||"note",r.specimen==="deploy"&&(s.dataset.vxSpecimen="deploy");let a=document.createElement("span");a.className="vx-toast-text",a.textContent=o,s.append(a),gt.append(s),Es.add(s),t(s);let c=e(s);c?.play("assemble",null,{duration:r.specimen==="deploy"?.4:.25}),N(r.kind==="failed"?"failed":r.kind==="done"?"done":"tick");let i=r.duration??4200,l=performance.now(),u=0,d=!1,f=async m=>{d||(d=!0,clearTimeout(u),document.removeEventListener("visibilitychange",g),await Rs(s,c,m),s.dispatchEvent(new CustomEvent("vx-dismiss",{bubbles:!0})),s.remove())};s.addEventListener("click",f);let g=()=>{d||i===1/0||(document.hidden||s.matches(":hover, :focus-within")?(u&&(i-=performance.now()-l),clearTimeout(u),u=0):u||(l=performance.now(),u=setTimeout(f,i)))};for(let m of["pointerenter","pointerleave","focusin","focusout"])s.addEventListener(m,()=>queueMicrotask(g));return document.addEventListener("visibilitychange",g),g(),f}}var Ft={\u0410:"A",\u0412:"B",\u0415:"E",\u0406:"I",\u041A:"K",\u041C:"M",\u041D:"H",\u041E:"O",\u0420:"P",\u0421:"C",\u0422:"T",\u0425:"X",\u0417:"3",\u02BC:"'"},Qo={\u0430:"a",\u0435:"e",\u0456:"i",\u043E:"o",\u0440:"p",\u0441:"c",\u0443:"y",\u0445:"x",\u0433:"r"},de=`
\u0411
#####
#....
#....
####.
#...#
#...#
####.

\u0413
#####
#....
#....
#....
#....
#....
#....

\u0490
....#
#####
#....
#....
#....
#....
#....

\u0414
..###
.#..#
.#..#
.#..#
.#..#
#####
#...#

\u0404
.####
#....
#....
###..
#....
#....
.####

\u0416
#.#.#
#.#.#
.###.
..#..
.###.
#.#.#
#.#.#

\u0418
#...#
#...#
#..##
#.#.#
##..#
#...#
#...#

\u0419 -2
.#.#.
..#..
#...#
#...#
#..##
#.#.#
##..#
#...#
#...#

\u041B
..###
.#..#
.#..#
.#..#
.#..#
.#..#
#...#

\u041F
#####
#...#
#...#
#...#
#...#
#...#
#...#

\u0423
#...#
#...#
#...#
.####
....#
#...#
.###.

\u0424
...#...
.#####.
#..#..#
#..#..#
#..#..#
.#####.
...#...

\u0426
#..#.
#..#.
#..#.
#..#.
#..#.
#####
....#

\u0427
#...#
#...#
#...#
.####
....#
....#
....#

\u0428
#.#.#
#.#.#
#.#.#
#.#.#
#.#.#
#.#.#
#####

\u0429
#.#.#.
#.#.#.
#.#.#.
#.#.#.
#.#.#.
######
.....#

\u042C
#....
#....
#....
####.
#...#
#...#
####.

\u042E
#..##.
#.#..#
#.#..#
###..#
#.#..#
#.#..#
#..##.

\u042F
.####
#...#
#...#
.####
..#.#
.#..#
#...#
`,Jo=`
\u0407 -2
#.#
...
.#.
.#.
.#.
.#.
.#.
.#.
.#.
`,tn=`
\u0407 -2
#.#
...
###
.#.
.#.
.#.
.#.
.#.
###
`,en=`
\u0431
.###
#...
###.
#..#
#..#
#..#
.##.

\u0432 2
###.
#..#
###.
#..#
###.

\u0491 1
..#
###
#..
#..
#..
#..

\u0434 2
..###
.#..#
.#..#
.#..#
#####
#...#

\u0454 2
.###
#...
###.
#...
.###

\u0436 2
#.#.#
#.#.#
.###.
#.#.#
#.#.#

\u0437 2
###.
...#
.##.
...#
###.

\u0438 2
#..#
#..#
#.##
##.#
#..#

\u0439
.##.
....
#..#
#..#
#.##
##.#
#..#

\u0457
#.#
...
.#.
.#.
.#.
.#.
.#.

\u043A 2
#..#
#.#.
##..
#.#.
#..#

\u043B 2
.###
.#.#
.#.#
.#.#
#..#

\u043C 2
#...#
##.##
#.#.#
#...#
#...#

\u043D 2
#..#
#..#
####
#..#
#..#

\u043F 2
####
#..#
#..#
#..#
#..#

\u0442 2
###
.#.
.#.
.#.
.#.

\u0444
..#..
..#..
.###.
#.#.#
#.#.#
#.#.#
.###.
..#..
..#..

\u0446 2
#..#.
#..#.
#..#.
#..#.
#####
....#

\u0447 2
#..#
#..#
.###
...#
...#

\u0448 2
#.#.#
#.#.#
#.#.#
#.#.#
#####

\u0449 2
#.#.#.
#.#.#.
#.#.#.
#.#.#.
######
.....#

\u044C 2
#...
#...
###.
#..#
###.

\u044E 2
#..##.
#.#..#
###..#
#.#..#
#..##.

\u044F 2
.###
#..#
.###
.#.#
#..#
`,on=`
\u0411
#######
#######
##.....
##.....
######.
#######
##...##
##...##
##...##
#######
######.

\u0413
######
######
##....
##....
##....
##....
##....
##....
##....
##....
##....

\u0490
....##
....##
######
######
##....
##....
##....
##....
##....
##....
##....

\u0414
..#####.
..#####.
..##.##.
..##.##.
..##.##.
..##.##.
.###.##.
.##..##.
.##..##.
########
########
##....##
##....##

\u0404
.#####.
#######
##...##
##.....
#####..
#####..
##.....
##.....
##...##
#######
.#####.

\u0416
##..##..##
##..##..##
###.##.###
.########.
..######..
..######..
..######..
.########.
###.##.###
##..##..##
##..##..##

\u0418
##...##
##..###
##..###
##.####
##.####
####.##
####.##
###..##
###..##
##...##
##...##

\u0419 -3
.##.##.
..###..
.......
##...##
##..###
##..###
##.####
##.####
####.##
####.##
###..##
###..##
##...##
##...##

\u0407 -3
##..##
##..##
......
..##..
..##..
..##..
..##..
..##..
..##..
..##..
..##..
..##..
..##..
..##..

\u041B
..#####
..#####
..##.##
..##.##
..##.##
..##.##
..##.##
.###.##
.##..##
###..##
##...##

\u041F
#######
#######
##...##
##...##
##...##
##...##
##...##
##...##
##...##
##...##
##...##

\u0423
##...##
##...##
##...##
##...##
##...##
#######
.######
.....##
##...##
#######
.#####.

\u0424
....##....
.########.
##########
##..##..##
##..##..##
##..##..##
##..##..##
##########
.########.
....##....
....##....

\u0426
##...##.
##...##.
##...##.
##...##.
##...##.
##...##.
##...##.
##...##.
##...##.
########
########
......##
......##

\u0427
##...##
##...##
##...##
##...##
##...##
#######
.######
.....##
.....##
.....##
.....##

\u0428
##..##..##
##..##..##
##..##..##
##..##..##
##..##..##
##..##..##
##..##..##
##..##..##
##..##..##
##########
##########

\u0429
##..##..##.
##..##..##.
##..##..##.
##..##..##.
##..##..##.
##..##..##.
##..##..##.
##..##..##.
##..##..##.
###########
###########
.........##
.........##

\u042C
##.....
##.....
##.....
##.....
######.
#######
##...##
##...##
##...##
#######
######.

\u042E
##...####.
##..######
##..##..##
##..##..##
##..##..##
######..##
######..##
##..##..##
##..##..##
##..######
##...####.

\u042F
.######
#######
##...##
##...##
##...##
#######
.######
.###.##
###..##
##...##
##...##
`;var Ve=`
A
.###.
#...#
#...#
#####
#...#
#...#
#...#

B
####.
#...#
#...#
####.
#...#
#...#
####.

C
.####
#....
#....
#....
#....
#....
.####

D
####.
#...#
#...#
#...#
#...#
#...#
####.

E
#####
#....
#....
####.
#....
#....
#####

F
#####
#....
#....
####.
#....
#....
#....

G
.####
#....
#....
#..##
#...#
#...#
.###.

H
#...#
#...#
#...#
#####
#...#
#...#
#...#

I
#
#
#
#
#
#
#

J
...#
...#
...#
...#
...#
#..#
.##.

K
#...#
#..#.
#.#..
##...
#.#..
#..#.
#...#

L
#....
#....
#....
#....
#....
#....
#####

M
#...#
##.##
#.#.#
#...#
#...#
#...#
#...#

N
#...#
#...#
##..#
#.#.#
#..##
#...#
#...#

O
.###.
#...#
#...#
#...#
#...#
#...#
.###.

P
####.
#...#
#...#
####.
#....
#....
#....

Q
.###.
#...#
#...#
#...#
#.#.#
#..#.
.##.#

R
####.
#...#
#...#
####.
#.#..
#..#.
#...#

S
.####
#....
#....
.###.
....#
....#
####.

T
#####
..#..
..#..
..#..
..#..
..#..
..#..

U
#...#
#...#
#...#
#...#
#...#
#...#
.###.

V
#...#
#...#
#...#
#...#
.#.#.
.#.#.
..#..

W
#.....#
#.....#
#..#..#
#..#..#
#.#.#.#
#.#.#.#
.#...#.

X
#...#
#...#
.#.#.
..#..
.#.#.
#...#
#...#

Y
#...#
#...#
.#.#.
..#..
..#..
..#..
..#..

Z
#####
....#
...#.
..#..
.#...
#....
#####
`,Ge=`
0
.###.
#...#
#..##
#.#.#
##..#
#...#
.###.

1
.#.
##.
.#.
.#.
.#.
.#.
###

2
.###.
#...#
....#
...#.
..#..
.#...
#####

3
####.
....#
....#
.###.
....#
....#
####.

4
#...#
#...#
#...#
#####
....#
....#
....#

5
#####
#....
#....
####.
....#
....#
####.

6
.###.
#....
#....
####.
#...#
#...#
.###.

7
#####
....#
...#.
..#..
..#..
..#..
..#..

8
.###.
#...#
#...#
.###.
#...#
#...#
.###.

9
.###.
#...#
#...#
.####
....#
....#
.###.
`,Ke=`
. 6
#

, 6
#
#

! 0
#
#
#
#
#
.
#

?
.###.
#...#
....#
...#.
..#..
.....
..#..

- 3
###

\u2013 3
#####

+ 2
.#.
###
.#.

= 2
###
...
###

: 2
#
.
.
#

; 2
#
.
.
.
#
#

/
..#
..#
.#.
.#.
.#.
#..
#..

'
#
#

"
#.#
#.#

(
.#
#.
#.
#.
#.
#.
.#

)
#.
.#
.#
.#
.#
.#
#.

&
.##..
#..#.
#.#..
.#...
#.#.#
#..#.
.##.#

%
#...#
#..#.
...#.
..#..
.#...
.#..#
#...#

#
.#.#.
.#.#.
#####
.#.#.
#####
.#.#.
.#.#.

*
#.#
.#.
#.#

@
.###.
#...#
#.###
#.#.#
#.###
#....
.####

_ 6
#####

\u2019
#
#

\u2018
#
#

\u201C
#.#
#.#

\u201D
#.#
#.#

\u2014 3
#######

\u2026 6
#.#.#

\xB7 3
#

\u2022 2
##
##

< 1
..#
.#.
#..
.#.
..#

> 1
#..
.#.
..#
.#.
#..

[
##
#.
#.
#.
#.
#.
##

]
##
.#
.#
.#
.#
.#
##

{
.##
.#.
.#.
#..
.#.
.#.
.##

}
##.
.#.
.#.
..#
.#.
.#.
##.

$ -1
..#..
.####
#.#..
#.#..
.###.
..#.#
..#.#
####.
..#..

\u2190 2
..#..
.#...
#####
.#...
..#..

\u2191 1
..#..
.###.
#.#.#
..#..
..#..

\u2193 1
..#..
..#..
#.#.#
.###.
..#..

\xD7 2
#.#
.#.
#.#

\u2192 2
..#..
...#.
#####
...#.
..#..
`,$a=vt(Mt({id:"sign",name:"Vox Sign 2",cap:7,descent:1,gap:1,space:3,lineGap:3,upper:!0,maxKern:2,kernKeep:1,depth:t=>t<3?t:t-1,src:Ve+Ge+Ke+de+Jo,alias:Ft,kern:{LT:-2,LY:-2,LV:-1,"L'":-2,"T,":0,"T.":0,"P,":0,"P.":0,"F,":0,"F.":0,"Y,":0,"Y.":0,"V,":0,"V.":0,"\u0413,":0,"\u0413.":0,"\u0422,":0,"\u0422.":0,"\u0420,":0,"\u0420.":0,"\u0423,":0,"\u0423.":0,"\u0427,":0,"\u0427.":0}}));var Ts=`
A
..#..
.#.#.
#...#
#...#
#####
#...#
#...#

I
###
.#.
.#.
.#.
.#.
.#.
###
`,Ps=`
a 2
.##.
...#
.###
#..#
.###

b
#...
#...
###.
#..#
#..#
#..#
###.

c 2
.###
#...
#...
#...
.###

d
...#
...#
.###
#..#
#..#
#..#
.###

e 2
.##.
#..#
####
#...
.###

f
.##
#..
###
#..
#..
#..
#..

g 2
.###
#..#
#..#
#..#
.###
...#
.##.

h
#...
#...
###.
#..#
#..#
#..#
#..#

i
#
.
#
#
#
#
#

j
.#
..
.#
.#
.#
.#
.#
.#
#.

k
#...
#...
#..#
#.#.
##..
#.#.
#..#

l
#
#
#
#
#
#
#

m 2
###.##.
#..#..#
#..#..#
#..#..#
#..#..#

n 2
###.
#..#
#..#
#..#
#..#

o 2
.##.
#..#
#..#
#..#
.##.

p 2
###.
#..#
#..#
#..#
###.
#...
#...

q 2
.###
#..#
#..#
#..#
.###
...#
...#

r 2
###
#..
#..
#..
#..

s 2
.###
#...
.##.
...#
###.

t 1
.#.
###
.#.
.#.
.#.
..#

u 2
#..#
#..#
#..#
#..#
.###

v 2
#...#
#...#
.#.#.
.#.#.
..#..

w 2
#.....#
#..#..#
#.#.#.#
#.#.#.#
.#...#.

x 2
#...#
.#.#.
..#..
.#.#.
#...#

y 2
#..#
#..#
#..#
#..#
.###
...#
.##.

z 2
####
...#
.##.
#...
####
`,Ls=`
: 3
#
.
.
#

; 3
#
.
.
#
#
`,oi=vt(Mt({id:"sentence",name:"Vox Sentence",cap:7,xHeight:5,descent:2,gap:1,space:2,lineGap:4,upper:!1,maxKern:2,kernKeep:1,depth:t=>t<3?t:t-1,src:Ve+Ts+Ge+Ke+Ls+Ps+de+tn+en,alias:{...Ft,...Qo},kern:{LT:-2,LY:-2,"L'":-2,rn:0,rm:0,"T,":0,"T.":0,"P,":0,"P.":0,"F,":0,"F.":0,"Y,":0,"Y.":0,"V,":0,"V.":0,"r,":-1,"r.":-1,"\u0413,":0,"\u0413.":0,"\u0422,":0,"\u0422.":0,"\u0420,":0,"\u0420.":0,"\u0423,":0,"\u0423.":0,"\u0427,":0,"\u0427.":0,"\u0433,":-1,"\u0433.":-1,"\u0442,":0,"\u0442.":0}}));var Fs=`
A
..###..
.#####.
##...##
##...##
##...##
##...##
#######
#######
##...##
##...##
##...##

B
######.
#######
##...##
##...##
######.
######.
##...##
##...##
##...##
#######
######.

C
.#####.
#######
##...##
##.....
##.....
##.....
##.....
##.....
##...##
#######
.#####.

D
######.
#######
##...##
##...##
##...##
##...##
##...##
##...##
##...##
#######
######.

E
######
######
##....
##....
#####.
#####.
##....
##....
##....
######
######

F
######
######
##....
##....
#####.
#####.
##....
##....
##....
##....
##....

G
.#####.
#######
##...##
##.....
##.####
##.####
##...##
##...##
##...##
#######
.#####.

H
##...##
##...##
##...##
##...##
#######
#######
##...##
##...##
##...##
##...##
##...##

I
##
##
##
##
##
##
##
##
##
##
##

J
....##
....##
....##
....##
....##
....##
....##
##..##
##..##
######
.####.

K
##...##
##..###
##.###.
#####..
####...
####...
####...
#####..
##.###.
##..###
##...##

L
##....
##....
##....
##....
##....
##....
##....
##....
##....
######
######

M
##.....##
###...###
####.####
#########
##.###.##
##..#..##
##.....##
##.....##
##.....##
##.....##
##.....##

N
##...##
###..##
###..##
####.##
####.##
##.####
##.####
##..###
##..###
##...##
##...##

O
.#####.
#######
##...##
##...##
##...##
##...##
##...##
##...##
##...##
#######
.#####.

P
######.
#######
##...##
##...##
##...##
#######
######.
##.....
##.....
##.....
##.....

Q
.#####.
#######
##...##
##...##
##...##
##...##
##...##
##...##
##...##
#######
.#####.
....##.
.....##

R
######.
#######
##...##
##...##
##...##
#######
######.
##.###.
##..###
##...##
##...##

S
.#####.
#######
##...##
##.....
.#####.
.#####.
.....##
.....##
##...##
#######
.#####.

T
########
########
...##...
...##...
...##...
...##...
...##...
...##...
...##...
...##...
...##...

U
##...##
##...##
##...##
##...##
##...##
##...##
##...##
##...##
##...##
#######
.#####.

V
##...##
##...##
##...##
##...##
###.###
.##.##.
.##.##.
.#####.
..###..
..###..
...#...

W
##.....##
##.....##
##.....##
##.....##
##.....##
##..#..##
##.###.##
#########
####.####
###...###
##.....##

X
##...##
##...##
###.###
.#####.
..###..
..###..
..###..
.#####.
###.###
##...##
##...##

Y
##....##
##....##
##....##
###..###
.######.
..####..
...##...
...##...
...##...
...##...
...##...

Z
#######
#######
....###
...###.
...###.
...###.
..###..
.###...
###....
#######
#######
`,Ns=`
0
.#####.
#######
##...##
##...##
##..###
##.####
####.##
###..##
##...##
#######
.#####.

1
..##..
.###..
####..
..##..
..##..
..##..
..##..
..##..
..##..
######
######

2
.#####.
#######
##...##
##...##
.....##
....###
..####.
.####..
###....
#######
#######

3
######.
#######
.....##
.....##
.#####.
.#####.
.....##
.....##
.....##
#######
######.

4
##...##
##...##
##...##
##...##
##...##
#######
#######
.....##
.....##
.....##
.....##

5
#######
#######
##.....
##.....
######.
#######
.....##
.....##
.....##
#######
######.

6
.#####.
#######
##.....
##.....
######.
#######
##...##
##...##
##...##
#######
.#####.

7
#######
#######
.....##
....###
....##.
...###.
...##..
...##..
...##..
...##..
...##..

8
.#####.
#######
##...##
##...##
.#####.
.#####.
##...##
##...##
##...##
#######
.#####.

9
.#####.
#######
##...##
##...##
##...##
#######
.######
.....##
.....##
#######
.#####.
`,Cs=`
. 9
##
##

, 9
##
##
.#
#.

!
##
##
##
##
##
##
##
##
..
##
##

?
.#####.
#######
##...##
.....##
....###
...###.
...##..
...##..
.......
...##..
...##..

- 5
####
####

+ 3
..##..
..##..
######
######
..##..
..##..

: 3
##
##
..
..
..
..
##
##

/
....##
....##
...##.
...##.
...##.
..##..
..##..
.##...
.##...
##....
##....

'
##
##
.#

"
##.##
##.##
.#..#

= 3
######
######
......
......
######
######

; 3
##
##
..
..
..
..
##
##
.#
#.

(
..##
.##.
##..
##..
##..
##..
##..
##..
##..
.##.
..##

)
##..
.##.
..##
..##
..##
..##
..##
..##
..##
.##.
##..

%
##...##
##..###
....##.
...###.
...##..
..###..
..##...
.###...
.##....
###..##
##...##

#
.##.##.
.##.##.
#######
#######
.##.##.
.##.##.
.##.##.
#######
#######
.##.##.
.##.##.

&
.####..
######.
##..##.
##..##.
######.
.####..
######.
##..####
##...##.
#######.
.####.##
`,ai=vt(Mt({id:"block",name:"Vox Block",cap:11,descent:2,gap:2,space:3,lineGap:4,upper:!0,maxKern:3,kernKeep:2,depth:t=>t,src:Fs+Ns+Cs+on,alias:Ft,kern:{LT:-3,LY:-3,LV:-2,"T,":0,"T.":0,"P,":0,"P.":0,"F,":0,"F.":0,"Y,":0,"Y.":0,"V,":0,"V.":0,"\u0413,":0,"\u0413.":0,"\u0422,":0,"\u0422.":0,"\u0420,":0,"\u0420.":0,"\u0423,":0,"\u0423.":0,"\u0427,":0,"\u0427.":0}}));var Is=t=>Math.round(t.cap*.42);function nn(t,e){let n=(t.dataset.vxText||t.textContent).trim().replace(/\s+/g," "),o=t.dataset.vxBoard==="none",r=(t.parentElement?.clientWidth||innerWidth)/e,s=n.split(" "),a=Number(t.dataset.vxScale),c=a||Number(t.dataset.vxMax||(o?1:2)),i=(t.dataset.vxFont||"block sign").split(/\s+/).map(u=>Lt[u]).filter(Boolean),l=null;for(let u of i){let d=o?0:Is(u);for(let f=c;f>=1;f--){let g=Math.floor((r-(o?0:2))/f)-d*2,m=k=>{let v=[],S="";for(let R of s){let A=S?S+" "+R:R;He(u,A)<=k||!S?S=A:(v.push(S),S=R)}return S&&v.push(S),v},p=m(g);for(let k=g-1;k>0&&p.length>1;k--){let v=m(k);if(v.length>p.length)break;p=v}let h=p.map(k=>ne(u,k)),y=Math.max(...h.map(k=>k.width)),b=h.slice(1).map((k,v)=>Math.max(u.lineGap,h[v].bottom-u.cap-k.top+1)),x=p.length*u.cap+b.reduce((k,v)=>k+v,0),w=o?0:-h[0].top,M=o?0:h[h.length-1].bottom-u.cap;if(l={text:n,font:u,lines:p,laid:h,gaps:b,width:y,rows:x,over:w,under:M,scale:f,margin:d,bare:o},!(y>g)&&!(!a&&!o&&p.length>1&&(f>1||u!==i[i.length-1])))return l}}return l}function sn(t){let e=t.bare?0:t.margin*2*t.scale+2;return{w:t.width*t.scale+e,h:(t.rows+t.over+t.under)*t.scale+e}}function Os(t){let e=t.count,n=t.rest,o=new Float32Array(e*3),r=new Float32Array(e*3),s=new Float32Array(e),a=new Float32Array(e),c=new Float32Array(e),i=new Float32Array(e*3);return{kind:"physics",t:0,last:0,end:1/0,busy:!1,brush:null,frame:0,onkick:null,poke(l,u,d,f){for(let g=0;g<e;g++){let m=n[g*3]-l,p=n[g*3+1]-u,h=Math.hypot(m,p);if(h>d)continue;let y=1-h/d,b=Z(g,Math.round(l*7),Math.round(u*5)),x=Z(Math.round(u*3),g,9);r[g*3]+=m/(h+.5)*f*y*(.5+b)+(x-.5)*8,r[g*3+1]+=p/(h+.5)*f*y*(.5+x)-f*.45*y,r[g*3+2]+=f*(.5+b)*y,a[g]=(b-.5)*26,i[g*3]=b-.5,i[g*3+1]=x-.5,i[g*3+2]=.3,c[g]=.55+x*.5+(1-y)*.2}this.busy=!0},write(l,u,d){let f=Math.min(.04,Math.max(0,this.t-this.last));this.last=this.t;let g=!1,m=this.brush,p=0;if(m){this.frame++;let h=m.x-m.px,y=m.y-m.py,b=h*h+y*y;for(let x=0;x<e;x++){let w=n[x*3]-m.px,M=n[x*3+1]-m.py,k=b?Math.max(0,Math.min(1,(w*h+M*y)/b)):0,v=w-h*k,S=M-y*k,R=Math.hypot(v,S);if(R>m.r)continue;if(c[x]>0){c[x]=Math.max(c[x],.3);continue}let A=1-R/m.r,E=Z(x,this.frame,3),L=Z(this.frame,x,11);r[x*3]=v/(R+.5)*m.f*(.4+A)*(.5+E)+(L-.5)*6,r[x*3+1]=S/(R+.5)*m.f*(.4+A)*(.5+L)-m.f*.5,r[x*3+2]=m.f*(.5+E),a[x]=(E-.5)*26,i[x*3]=E-.5,i[x*3+1]=L-.5,i[x*3+2]=.3,c[x]=.45+L*.4,p++}m.px=m.x,m.py=m.y,g=!0,p&&this.onkick&&this.onkick(p)}for(let h=0;h<e;h++,u+=8){let y=o[h*3],b=o[h*3+1],x=o[h*3+2];if(c[h]>0)c[h]-=f,r[h*3+1]+=95*f,y+=r[h*3]*f,b+=r[h*3+1]*f,x+=r[h*3+2]*f,b>240&&(b=240,r[h*3+1]=0),r[h*3+2]-=30*f,x<.2&&(x=.2,r[h*3+2]*=-.3),s[h]+=a[h]*f,g=!0;else if(y||b||x||s[h]){for(let R=0;R<3;R++){let A=R===0?y:R===1?b:x;r[h*3+R]+=(-150*A-24*r[h*3+R])*f}y+=r[h*3]*f,b+=r[h*3+1]*f,x+=r[h*3+2]*f,s[h]*=Math.exp(-9*f),Math.abs(y)+Math.abs(b)+Math.abs(x)<.02&&Math.abs(r[h*3])+Math.abs(r[h*3+1])+Math.abs(r[h*3+2])<.3?(y=b=x=0,s[h]=0,r[h*3]=r[h*3+1]=r[h*3+2]=0):g=!0}o[h*3]=y,o[h*3+1]=b,o[h*3+2]=x;let w=1,M=x;if(d.inlayDepth){let v=Math.hypot(y,b,x),S=d.inlayDepth+(Math.sqrt(3)-1)/2;M=Math.max(M,Math.min(v,S)),w=Math.min(1,Math.max(0,(v-S)*2))}l[u]=n[h*3]+d.tx+y*w,l[u+1]=n[h*3+1]+d.ty+b*w,l[u+2]=n[h*3+2]+d.tz+M,l[u+3]=1;let k=s[h]*w;if(k){let v=Math.hypot(i[h*3],i[h*3+1],i[h*3+2])||1,S=Math.sin(k/2)/v;l[u+4]=i[h*3]*S,l[u+5]=i[h*3+1]*S,l[u+6]=i[h*3+2]*S,l[u+7]=Math.cos(k/2)}else l[u+4]=0,l[u+5]=0,l[u+6]=0,l[u+7]=1}return this.busy=g,!g}}}var rn={name:"lettering",selector:".vx-sign, .vx-lettering",pad:14,build(t,e){let{W:n,H:o,el:r}=t,s=nn(r,t.vx),{scale:a,font:c,bare:i}=s,l=i?0:2;if(!i){e.part("board").slab(0,0,0,n,o,2,r.dataset.vxMaterial||"enamel",2);let x=r.dataset.vxFrame||"signal";if(x!=="none"){let w=e.part("frame");w.grounded=!1,w.box(1,1,2,n-2,o-2,1,x).carve(2,2,2,n-4,o-4,1).notch(1,1,2,n-2,o-2,1,1)}}let u=e.part("letters");u.grounded=i;let d=Number(r.dataset.vxDepth)||(c.depth?c.depth(a):a),f=r.dataset.vxRefine!=="off",g=r.dataset.vxInk||(i?"ink":"signal"),m=sn(s),p=K(t),h=Math.round((o-m.h)/2)+(i?0:s.margin*a+1)+s.over*a;s.laid.forEach((x,w)=>{let M=x.width*a,k=i?p(0,M):Math.round((n-M)/2);for(let{g:v,x:S}of x.glyphs)for(let[R,A]of We(v,a,f))u.box(k+S*a+R,h+A,l,1,1,d,g);h+=(c.cap+(s.gaps[w]??c.lineGap))*a}),t.faceZ=l,t.state.scale=a,t.state.fit=s;let y=Y(r,"vx-lettering-text"),b=Math.round((o-m.h)/2)+(i?0:s.margin*a+1)+s.over*a;y.dataset.vxSet=c.id,y.toggleAttribute("data-vx-caps",!!c.upper);for(let[x,w]of[["--_s",a],["--_gap",c.gap],["--_lh",(c.cap+c.lineGap)/10],["--_pt",b],["--_pi",i?0:Math.round((n-s.width*a)/2)]])y.style.setProperty(x,w)},bind(t){let e=F();Q(t,e);let n=t.el,o=()=>{let h=parseFloat(getComputedStyle(n).getPropertyValue("--vx"))||4,y=sn(nn(n,h));n.style.inlineSize=y.w*h+"px",n.style.blockSize=y.h*h+"px"};o(),e(window,"resize",o);let r=()=>t.model.byName.letters,s=()=>{let h=r();return(!h.fx||h.fx.kind!=="physics")&&(h.fx=Os(h)),h.fx},a=h=>{let y=n.getBoundingClientRect();return[(h.clientX-y.left)/t.vx,(h.clientY-y.top)/t.vx]},c=()=>(n.dataset.vxPress||(n.dataset.vxBoard==="none"?"text":"play"))==="play",i=()=>n.dispatchEvent(new CustomEvent("vx-poke",{bubbles:!0})),l=h=>{let[y,b]=a(h);s().poke(y,b,5+t.state.scale*2.2,34),N("poke"),t.invalidate()},u=200,d=300,f=null,g=0,m=h=>{let[y,b]=a(h),x=s();x.brush={x:y,y:b,px:y,py:b,r:3+t.state.scale*1.6,f:20},x.onkick=()=>{let M=performance.now();M-g>120&&(g=M,N("poke"))},f.mode="brush";try{n.setPointerCapture(h.pointerId)}catch{}let w=getSelection();w&&(w.isCollapsed||n.contains(w.anchorNode))&&w.removeAllRanges(),document.documentElement.setAttribute("data-vx-brushing",""),t.invalidate()},p=()=>{if(f){if(clearTimeout(f.timer),f.mode==="brush"){let h=r();h.fx?.kind==="physics"&&(h.fx.brush=null),document.documentElement.removeAttribute("data-vx-brushing")}f=null}};return e(n,"pointerdown",h=>{if(!(!h.isPrimary||h.button!==0||h.shiftKey||h.ctrlKey||z())&&(p(),f={id:h.pointerId,touch:h.pointerType==="touch",x:h.clientX,y:h.clientY,t:performance.now(),mode:"wait",last:h},!f.touch)){if(c()){l(h),i(),m(h);return}f.timer=setTimeout(()=>{f?.mode==="wait"&&(i(),m(f.last))},u)}}),e(n,"mousedown",h=>{h.button===0&&!h.shiftKey&&!h.ctrlKey&&!z()&&c()&&h.preventDefault()}),e(n,"contextmenu",p),e(window,"blur",p),e(n,"pointermove",h=>{if(!f||h.pointerId!==f.id)return;if(f.last=h,f.mode==="brush"){let x=r().fx?.brush;x&&([x.x,x.y]=a(h),t.invalidate());return}if(f.mode!=="wait")return;let y=h.clientX-f.x,b=h.clientY-f.y;if(f.touch){if(Math.hypot(y,b)<10)return;Math.abs(y)>=Math.abs(b)?(i(),m(h)):f.mode="left"}else Math.hypot(y,b)>4&&(clearTimeout(f.timer),f.mode="left")}),e(n,"pointerup",h=>{!f||h.pointerId!==f.id||(f.mode==="wait"&&performance.now()-f.t<(f.touch?d:u+50)&&(l(h),i()),p())}),e(n,"pointercancel",h=>{f&&h.pointerId===f.id&&p()}),e(n,"lostpointercapture",h=>{h.target===n&&f&&h.pointerId===f.id&&f.mode==="brush"&&p()}),()=>{p(),e.done(),n.style.inlineSize="",n.style.blockSize="";let h=n.querySelector(":scope > .vx-lettering-text");h&&h.replaceWith(...h.childNodes)}}};var an={note:"light",done:"light-go",warning:"caution",failed:"light-stop"};function zs(t,e,n,o){let{walls:r,floor:s}=C(t,e,{x:n,y:1,w:5,h:3,depth:2,wall:"steel",floor:"gasket"});s.box(n+1,2,-2,3,1,1,"gasket");let a=e.part("lens");a.sunk=!0,a.box(n+1,2,-1,3,1,1,"lens"),a.plot(n+2,2,-1,o);let c;return()=>{if(c===t.tintRevision)return;c=t.tintRevision;let i=a.mats.indexOf(X[o].id);if(i<0)return;let l=a.col.subarray(i*4,i*4+3);for(let u of[a,r])for(let d=0;d<u.count;d++){if(u===a&&d===i)continue;let f=u.rest[d*3]-(n+2.5),g=u.rest[d*3+1]-2.5,m=(u===a?.8:.22)/(1+f*f+g*g);for(let p=0;p<3;p++){let h=d*4+p;u.col[h]+=(l[p]-u.col[h])*m}}}}var cn={name:"callout",selector:".vx-callout",pad:6,glowRadius:2.6,glowStrength:T(.05),build(t,e){let{W:n,el:o}=t,r=t.state.mat=an[o.dataset.vxKind]??an.note,s=getComputedStyle(o).direction==="rtl"?n-1:0;if(o.dataset.vxFitting==="pilot"){t.state.lightPilot=zs(t,e,s===0?0:n-5,r);return}t.state.lightPilot=null,C(t,e,{x:s,w:1,depth:t.look.groove,wall:r,floor:r})},pose(t){t.state.lightPilot?.(),t.glowStrength=T(.05)*W(t)},bind(t){let e=F();return e.watch(t.el,{attributes:!0,attributeFilter:["data-vx-kind","dir"]},()=>t.rebuild()),e.done}};var _s=t=>[...t.children].filter(e=>e.tagName==="LI"),ln=t=>!!t&&t.hasAttribute("aria-current")&&t.getAttribute("aria-current")!=="false",Ds=t=>ln(t)||[...t.children].some(ln),un={name:"list-group",selector:".vx-list-group",pad:6,glowRadius:2.6,glowStrength:T(.05),build(t,e){let{W:n,el:o,vx:r}=t,s=getComputedStyle(o).direction==="rtl"?n-2:1,a=e.part("lens"),c=!1;for(let i of _s(o)){let l=Math.round(i.offsetTop/r),u=Math.max(1,Math.round(i.offsetHeight/r)),d=u>4?2:0,f=!c&&Ds(i);c||=f,wt(a,s,l+d,1,u-d*2,f)}t.state.lit=c},pose(t){t.glowStrength=t.state.lit?T(.05)*W(t):0},bind(t){let e=F();return e.watch(t.el,{subtree:!0,childList:!0,characterData:!0,attributes:!0,attributeFilter:["aria-current","dir"]},n=>{n.filter(r=>r.target!==t.canvas&&!(r.type==="childList"&&[...r.addedNodes,...r.removedNodes].every(s=>s===t.canvas))).length&&(t.canvas.isConnected||t.el.prepend(t.canvas),t.rebuild())}),e.done}};var fn={name:"prose-quote",selector:".vx-prose blockquote",pad:6,glowRadius:2.6,glowStrength:T(.05),build(t,e){let{W:n,H:o,el:r}=t,s=getComputedStyle(r).direction==="rtl";C(t,e,{x:s?n-1:0,y:0,w:1,h:o,depth:t.look.groove??1,wall:"light-warm",floor:"light-warm"})},pose(t){t.glowStrength=T(.05)*yt(t)}};var dn=.075,hn=4.2,Xe=5,Hs=[" ","Enter","ArrowDown","ArrowUp"],Ws=.14;function Bs(t){try{return t.matches(":open")}catch{return null}}var pn={name:"select",selector:".vx-select",pad:9,glowRadius:hn,glowStrength:T(dn),build(t,e){let{W:n,H:o,el:r}=t,s=r.querySelector("select"),a=!s||s.matches(":disabled"),c=Pt(t,e,a,"key",B(r)),i=t.faceZ,l=oe.chevron,d=getComputedStyle(r).direction==="rtl"?Xe:n-l[0].length-Xe,f=Math.round((o-l.length)/2);if(n>=l[0].length+Xe*2){c.slab(d-1,f-1,i-1,l[0].length+2,l.length+2,1,"gasket",1);for(let g=0;g<l.length;g++)for(let m=0;m<l[g].length;m++)l[g][m]==="#"&&c.plot(d+m,f+g,i-1,a?"steel":"ivory")}a&&(t.state.held=!1,t.spring("press").snap(0)),t.state.off=a,t.state.top=i,t.faceZ=i,t.label(r.querySelector(":scope > .vx-select-face"),()=>t.state.top+c.tz)},pose(t){let e=t.model.byName.cap,n=t.spring("press").x,o=t.spring("hover").x;e.tz=t.state.off?0:n+o;let r=t.state.flare??0;t.glowStrength=T(dn)*W(t)*(1+o*1.2+r*2.6),t.glowRadius=hn+r*2.2,t.el.style.setProperty("--lit",r.toFixed(3))},step(t,e){let n=t.state;if(n.off)return!1;let o=!1;if(n.held){n.t+=e;let c=Bs(n.control);n.t>=Ws&&(c===null?n.heard:!c)&&n.up(),o=!0}let r=t.spring("press").x<-.4,s=n.flare??0,a=z()?0:r?Math.min(1,s+e/.06):Math.max(0,s-e/.55);return n.flare=a,o||a>0&&a!==s},bind(t){let e=F(),n=t.el,o=n.querySelector("select"),r=t.state;if(Y(n,"vx-select-face"),!o)return e.done;r.control=o;let s=t.spring("press"),a=t.spring("hover"),c=(u,{k:d,c:f})=>z()?s.snap(u):s.to(u,d,f),i=()=>{r.off||r.held||(r.held=!0,r.t=0,r.heard=!1,c(-t.model.keyTravel,D),N("press"),t.invalidate())};r.up=()=>{r.held&&(r.held=!1,c(0,j),N("release"),t.invalidate())};let l=()=>{r.held&&(r.heard=!0,t.invalidate())};e(o,"pointerdown",u=>{u.button===0&&i()}),e(o,"keydown",u=>{Hs.includes(u.key)&&!u.repeat&&i()});for(let u of["pointerup","pointercancel","keyup","blur","change"])e(o,u,l);for(let u of["pointerup","pointermove","pointerdown","keydown","wheel"])e(window,u,d=>{d.target!==o&&l()},{passive:!0,capture:!0});return e(o,"change",()=>N("tick")),e(n,"pointerenter",u=>{u.pointerType==="mouse"&&!r.off&&!z()&&(a.to(.5,H.k*2,H.c*1.4),t.invalidate())}),e(n,"pointerleave",()=>{a.to(0,H.k*2,H.c*1.4),t.invalidate()}),e.watch(o,{attributes:!0,attributeFilter:["disabled"],childList:!0,subtree:!0,characterData:!0},()=>t.rebuild()),it(o,e,()=>t.rebuild()),e.done}};var mn={name:"table",selector:".vx-table",pad:6,glowRadius:2.6,glowStrength:T(.05),build(t,e){let{el:n,W:o,vx:r}=t,s=n.querySelector("thead");if(!s)return;let a=(t.cssH-t.H*r)/2,c=(s.getBoundingClientRect().bottom-n.getBoundingClientRect().top-a)/r-1,i=Math.round(c),l=Math.abs(c-i)<.01?0:c-i,{walls:u,floor:d}=C(t,e,{x:0,y:i,w:o,h:1,depth:t.look.groove??1,wall:"light-warm",floor:"light-warm"});if(l&&(u.ty=l,d.ty=l,t.well=[0,i+l,o,i+1+l]),n.dataset.vxTable==="register"){let f=e.part("faceplate");f.sunk=!0,f.tz=-1,f.ty=l,f.slab(0,0,0,o,t.H,1,"gasket",1);let g=Math.round(parseFloat(getComputedStyle(n).paddingInlineStart)/r);f.carve(g,i,0,o-g*2,1,1);for(let m of[2,o-6])for(let p of[2,t.H-5])f.box(m+1,p,0,2,3,1,"steel"),f.box(m,p+1,0,4,1,1,"steel"),f.box(m+1,p+1,0,2,1,1,"slate")}},pose(t){t.glowStrength=T(.05)*yt(t)},bind(t){let e=t.el.querySelector("thead");if(!e)return null;let n=!0,o=new ResizeObserver(()=>{n?n=!1:t.rebuild()});return o.observe(e),()=>o.disconnect()}};var qt=t=>t.matches(":disabled")||t.getAttribute("aria-disabled")==="true",At=t=>t.getAttribute("aria-pressed")==="true";function gn(t,e){t.hasAttribute("aria-pressed")||t.setAttribute("aria-pressed","false"),e(t,"click",()=>{if(qt(t))return;let n=!At(t);t.setAttribute("aria-pressed",String(n)),t.dispatchEvent(new CustomEvent("vx-change",{bubbles:!0,detail:{pressed:n}}))})}var bn={name:"toggle-button",selector:".vx-toggle-button",pad:9,soft:.65,build(t,e){let{W:n,H:o,el:r}=t,s=t.look,a=qt(r),c=At(r),i=Y(r),l=t.state;l.off=a;let u=1;if(a&&c){let g=Math.max(1,s.travel-u);C(t,e,{depth:g,wall:"slate",floor:"steel"}),l.top=-g,t.label(i,()=>-g)}else{let g=Pt(t,e,a,"key",B(r)),m=l.top;a||(g.carve(0,o-3,1,n,3,m),e.byName.light.carve(0,o-3,0,n,3,1),l.indicator=Tt(t,"",0,0,n,o,B(r),0)),t.label(i,()=>l.top+g.tz)}let d=c&&!a?-t.model.keyTravel:0,f=t.spring("press");!l.built||z()?(f.snap(d),l.flare=0,l.lit=d?1:0):l.held||f.to(d,d?D.k:j.k,d?D.c:j.c),l.built=!0},pose(t){let e=t.model.byName.cap;if(t.state.off||!e){e&&(e.tz=0),t.el.style.setProperty("--lit","0");return}let n=t.spring("press").x,o=t.spring("hover").x;e.tz=n+o,t.state.indicator(-n/Math.max(1,t.model.keyTravel));let r=t.state.flare??0,s=t.state.lit??0;$t(t,o,r,s),t.el.style.setProperty("--lit",Math.max(r,s*.5).toFixed(3))},step(t,e){let n=t.state;if(n.off)return!1;let o=z(),r=n.held&&t.spring("press").x<-.4,s=n.flare??0,a=o?0:r?Math.min(1,s+e/.06):Math.max(0,s-e/.55);n.flare=a;let c=At(t.el)?1:0,i=n.lit??0,l=o?c:i<c?Math.min(c,i+e/.12):Math.max(c,i-e/.3);return n.lit=l,a!==s||l!==i},bind(t){let e=t.el,n=F(),o=t.state;gn(e,n);let r=t.spring("press"),s=t.spring("hover"),a=(p,h,y,b)=>{z()?p.snap(h):p.to(h,y,b),t.invalidate()},c=()=>At(e)&&!o.off?-t.model.keyTravel:0,i=()=>{o.held=!1;let p=c();a(r,p,p?D.k:j.k,p?D.c:j.c)},l=()=>{At(e)&&!o.off&&!z()&&(o.flare=Math.max(o.flare??0,1))},u=()=>{if(o.off||o.held)return;o.held=!0;let p=t.model.keyStop??t.model.keyTravel+(At(e)?t.look.step:0);a(r,-p,D.k,D.c),N("press")},d=()=>{o.held&&i()},f=null,g=p=>{f!==null||o.off||(f=p,u())},m=(p,h)=>{f!==p||f===null||(f=null,h&&o.held&&t.model.keyStop!=null&&N("release"),d())};return n(e,"pointerdown",p=>{p.button===0&&g(p.pointerId)}),n(e,"pointerup",p=>m(p.pointerId,!0)),n(e,"pointercancel",p=>m(p.pointerId,!1)),n(e,"pointerenter",p=>{p.pointerType==="mouse"&&!o.off&&!z()&&a(s,.5,H.k*2,H.c*1.4)}),n(e,"pointerleave",p=>{a(s,0,H.k*2,H.c*1.4),m(p.pointerId,!1)}),n(e,"keydown",p=>{p.key!=="Enter"&&p.key!==" "||(p.repeat?p.key==="Enter"&&t.model.keyStop!=null&&p.preventDefault():g(p.key))}),n(e,"keyup",p=>m(p.key,!0)),n(e,"blur",()=>m(f,!1)),n(window,"blur",()=>m(f,!1)),n(e,"click",()=>{o.off||(t.model.keyStop==null&&!At(e)&&N("release"),(t.model.keyStop==null||!o.held)&&i(),l())}),it(e,n,()=>{qt(e)&&(o.held=!1,s.snap(0),r.snap(0)),t.rebuild()}),n.watch(e,{attributes:!0,attributeFilter:["aria-pressed","disabled","aria-disabled","data-vx-light"]},p=>{if(qt(e)&&(o.held=!1,r.snap(0),s.snap(0)),o.off||qt(e)||p.some(h=>h.attributeName!=="aria-pressed"))return t.rebuild();o.held||(l(),i())}),n.done},plain:gn};var Ye=t=>t.getAttribute("role")!=="toolbar",Us=t=>[...t.querySelectorAll(":scope > label")];function qs(t){let e=t.querySelector(":scope > .vx-label");if(e)return e;e=document.createElement("span"),e.className="vx-label";for(let n of[...t.childNodes])n.nodeType===1&&n.matches("input, .vx-canvas")||e.append(n);return t.append(e),e}function xn(t,e){let n=()=>[...t.querySelectorAll('button, [role="button"]')].filter(r=>!r.disabled),o=r=>{for(let s of n())s.tabIndex=s===r?0:-1};o(n().find(r=>r.getAttribute("tabindex")==="0")??n()[0]),e(t,"focusin",r=>{let s=r.target.closest('button, [role="button"]');s&&t.contains(s)&&o(s)}),e(t,"keydown",r=>{let s=n(),a=s.indexOf(document.activeElement);if(a<0||r.altKey||r.ctrlKey||r.metaKey)return;let c=getComputedStyle(t).direction==="rtl",i=t.dataset.vxWay==="down"?["ArrowDown","ArrowUp"]:c?["ArrowLeft","ArrowRight"]:["ArrowRight","ArrowLeft"],l=Ne(r.key,a,s.length,i);l<0||(r.preventDefault(),o(s[l]),s[l].focus())})}var yn={name:"toggle-group",selector:".vx-toggle-group",draws:Ye,pad:7,glowRadius:3.4,glowStrength:T(.07),build(t,e){let{el:n,vx:o}=t,r=t.state,s=t.look,a=s.well,c=r.seats=Us(n),i=r.inputs=c.map(p=>p.querySelector("input"));kt(e,0,0,t.W,t.H),C(t,e,{depth:a,wall:"slate",floor:"slate"});let l=(t.cssW-t.W*o)/2,u=(t.cssH-t.H*o)/2,d=p=>Math.round(p*o)/o,f=r.at=c.map(p=>{let h=Math.round(p.offsetWidth/o),y=Math.round(p.offsetHeight/o);return[d((p.offsetLeft+p.offsetWidth/2-l)/o-h/2),d((p.offsetTop+p.offsetHeight/2-u)/o-y/2),h,y]}),g=r.top=1+s.travel,m=B(n,"light");r.caps=[],r.indicators=[],f.forEach(([p,h,y,b],x)=>{let w=!!i[x]?.matches(":disabled"),M=e.part("ring"+x);M.sunk=!0,M.grounded=!1,_(M,0,0,-a,y-2,b-2,"steel"),M.tx=p+1,M.ty=h+1;let k=e.part("cap"+x);if(k.grounded=!1,at(k,0,0,1-a,y-2,b-4,a+s.travel,w?"steel":"key"),!w&&y>=12&&b>=10)for(let R of[1,y-4])k.box(R,2,g,1,b-8,1,"key");k.tx=p+1,k.ty=h+1,r.indicators.push(Tt(t,x,p+1,h+1,y-2,b-2,m)),r.caps.push(k);let v=i[x]?.checked?1:0,S=t.spring("on"+x,v);!r.built||z()?S.snap(v):S.target!==v&&S.to(v,v?D.k:j.k,v?D.c:j.c),t.spring("hold"+x,0),t.label(qs(c[x]),()=>g+k.tz)}),r.index=i.findIndex(p=>p?.checked),r.built=!0},pose(t){let e=t.state;if(!e.caps)return;let n=t.look.travel,o=0;e.caps.forEach((r,s)=>{let a=t.spring("on"+s).x;r.tz=-n*a+t.spring("hold"+s).x;let c=a>.5&&!e.inputs[s]?.matches(":disabled");e.indicators[s](e.inputs[s]?.matches(":disabled")?0:a),c&&(o=1)}),t.glowStrength=T(.07)*W(t)*o},bind(t){let e=t.el,n=F(),o=t.state;if(!Ye(e))return xn(e,n),n.done;let r=(d,f,{k:g,c:m})=>{z()?d.snap(f):d.to(f,g,m)},s=(d,f=!1)=>{let g=!1;(o.inputs??[]).forEach((m,p)=>{let h=m?.checked?1:0,y=t.spring("on"+p);y.target!==h&&(f?y.snap(h):r(y,h,h?D:j),g=!0)}),o.index=(o.inputs??[]).findIndex(m=>m?.checked),g&&(!d&&!t.form.recordedReturn&&N("tick"),t.invalidate())},a=null,c=(d,f)=>{a||d<0||o.inputs[d]?.matches(":disabled")||(a={i:d,by:f},r(t.spring("hold"+d),-t.look.step,D),N("press"),t.invalidate())},i=d=>{!a||a.by!==d||(r(t.spring("hold"+a.i),0,j),t.form.recordedReturn&&N("release"),a=null,t.invalidate())},l=d=>(o.seats??[]).findIndex(f=>f.contains(d));n(e,"pointerdown",d=>{d.button===0&&c(l(d.target),"pointer")});for(let d of["pointerup","pointercancel","pointerleave"])n(e,d,()=>i("pointer"));n(e,"keydown",d=>{d.key===" "&&!d.repeat&&c(l(d.target),"key")}),n(e,"keyup",d=>{d.key===" "&&i("key")}),n(e,"focusout",()=>i("key")),n(e,"change",d=>s(!1,t.form.instantKeyboardChoice&&d.target.matches(":focus-visible")));for(let d of e.querySelectorAll(":scope > label > input"))n.heed(d,"checked",()=>s(!0));let u=e.querySelector("input")?.form;return u&&n(u,"reset",()=>setTimeout(()=>s(!0))),it(e,n,()=>t.rebuild()),n.watch(e,{attributes:!0,attributeFilter:["disabled"],subtree:!0},()=>t.rebuild()),n.watch(e,{attributes:!0,attributeFilter:["data-vx-light","data-vx-way"]},()=>t.rebuild()),(o.inputs??[]).some((d,f)=>t.spring("on"+f).target!==(d?.checked?1:0))&&(o.inputs.forEach((d,f)=>t.spring("on"+f).snap(d?.checked?1:0)),o.index=o.inputs.findIndex(d=>d?.checked),t.invalidate()),n.done},plain(t,e){Ye(t)||xn(t,e)}};var js=(t,e)=>t.hasAttribute(e)&&t.getAttribute(e)!=="false";function wn(t,e="a"){return[...t.querySelectorAll(e)].find(n=>js(n,"aria-current"))??null}function jt(t,e,n=!1){let{el:o,vx:r}=t,s=o.getBoundingClientRect(),a=e.getBoundingClientRect();if(!a.width||!a.height)return null;let c=(t.cssW-t.W*r)/2,i=(t.cssH-t.H*r)/2,l=a.left,u=a.right;if(n){let g=getComputedStyle(e);l+=parseFloat(g.paddingLeft)||0,u-=parseFloat(g.paddingRight)||0}let d=Math.round((l-s.left-c)/r),f=Math.round((a.top-s.top-i)/r);return[d,f,Math.max(1,Math.round((u-s.left-c)/r)-d),Math.max(1,Math.round((a.bottom-s.top-i)/r)-f)]}function Vs(t,e,n,{way:o="under",light:r="light",clip:s}={}){let a=n&&jt(t,n,o==="under");if(!a)return!1;let[c,i,l,u]=a;if(o==="under")i=i+u-2,u=1;else{let d=u>4?2:0;c=getComputedStyle(t.el).direction==="rtl"?t.W-2:1,l=1,i+=d,u-=d*2}if(s){let d=Math.max(i,s[0]),f=Math.min(i+u,s[1]);i=d,u=f-d}return u<1||l<1?!1:(C(t,e,{x:c,y:i,w:l,h:u,depth:t.look.groove,wall:r,floor:r}),!0)}function Gs(t,e,n){let o=e.part("rail"),r=new Map;for(let s of t.el.querySelectorAll("a")){let a=jt(t,s);if(!a)continue;let[c,i,l,u]=a,d=i+u,f=r.get(d)??[];f.push({x:c,w:l,on:s===n}),r.set(d,f)}for(let[s,a]of r){let c=Math.min(...a.map(l=>l.x)),i=Math.max(...a.map(l=>l.x+l.w));o.slab(c,s-3,0,i-c,3,1,"steel",1);for(let{x:l,w:u,on:d}of a){let f=Math.min(5,u),g=l+Math.floor((u-f)/2);if(o.box(g,s-2,0,f,1,1,"lens"),d){let m=f>=3?1:0;o.box(g+m,s-2,0,f-2*m,1,1,"light")}}}t.faceZ=1}var kn=.05,Ks=.07,Xs=t=>["index","seats","groove"].includes(t.dataset.vxMark)?t.dataset.vxMark:"plain";function Mn(t,e){return t.el.dataset.vxMark==="index"?[...t.el.querySelectorAll("a")].map(n=>jt(t,n)?.join()).join("|"):e?jt(t,e)?.join():""}var Ys=t=>/^column/.test(getComputedStyle(t).flexDirection),vn={name:"navs",selector:".vx-nav",pad:7,glowRadius:3,glowStrength:T(kn),build(t,e){let{el:n}=t,o=t.state,r=o.kind=Xs(n),s=wn(n);if(o.has=!1,o.sig=Mn(t,s),r==="index"){Gs(t,e,s);return}if(r==="plain")return;if(r==="groove"){Vs(t,e,s,{way:Ys(n)?"beside":"under"});return}let a=t.look.well;C(t,e,{depth:a,wall:"slate",floor:"slate"});for(let y of n.querySelectorAll("a"))y.style.transform="",t.label(y,()=>t.faceZ);let c=o.glide&&!z();o.glide=!1;let i=s&&s.getAttribute("aria-disabled")!=="true"?jt(t,s):null;if(!i)return;let[l,u,d,f]=i,g=e.part("block");g.grounded=!1,_(g,1,1,-a,d-2,f-2,"light"),at(g,1,1,1-a,d-2,f-2,Math.max(1,a-1),"key"),o.has=!0;let m=t.spring("x",l,$.k*1.25,$.c*1.12),p=t.spring("y",u,$.k*1.25,$.c*1.12),h=o.shape===`${d},${f}`;c&&h&&o.was?(m.to(l),p.to(u),o.was!==`${l},${u}`&&N("slide")):(m.snap(l),p.snap(u)),o.was=`${l},${u}`,o.shape=`${d},${f}`},pose(t){let e=t.state;if(e.has){let n=t.model.byName.block;n.tx=t.spring("x").x,n.ty=t.spring("y").x}t.glowStrength=T(e.kind==="seats"?Ks:kn)*W(t)},bind(t){let e=F(),n=t.el;e.watch(n,{subtree:!0,childList:!0,characterData:!0,attributes:!0,attributeFilter:["aria-current","aria-disabled","data-vx-mark","data-vx-way","dir","hidden"]},s=>{let a=s.filter(c=>c.target!==t.canvas&&!(c.type==="childList"&&[...c.addedNodes,...c.removedNodes].every(i=>i===t.canvas)));a.length&&(t.canvas.isConnected||n.prepend(t.canvas),t.state.glide=a.every(c=>c.type==="attributes"&&c.attributeName==="aria-current"),t.rebuild())});let o=()=>{let s=wn(n);Mn(t,s)!==t.state.sig&&t.rebuild()},r=new ResizeObserver(o);for(let s of n.querySelectorAll("a"))r.observe(s);return e(window,"resize",o),document.fonts?.ready.then(()=>{t.canvas.isConnected&&o()}),e({addEventListener(){},removeEventListener(){r.disconnect()}},"end",o),e.done}};function Zs(t,e){let n=t.querySelector(".vx-navbar-key"),o=n?.getAttribute("aria-controls")&&document.getElementById(n.getAttribute("aria-controls"))||t.querySelector(".vx-navbar-fold");if(!n||!o)return;n.hasAttribute("aria-expanded")||n.setAttribute("aria-expanded","false");let r=()=>n.getAttribute("aria-expanded")==="true",s=()=>getComputedStyle(n).display!=="none",a=c=>n.setAttribute("aria-expanded",String(c));e(n,"click",()=>a(!r())),e(t,"keydown",c=>{c.key!=="Escape"||!r()||!s()||c.defaultPrevented||c.target.closest?.(":popover-open")||(c.preventDefault(),a(!1),n.focus())}),e(o,"click",c=>{s()&&r()&&c.target.closest?.("a[href]")&&a(!1)}),t.setAttribute("data-vx-on",""),e({addEventListener(){},removeEventListener(){t.removeAttribute("data-vx-on")}},"end",a)}var Sn={name:"navbar",selector:".vx-navbar",plain:Zs};var pe=[Wt,qo,te,Zo,Yo,jo,pn,yn,bn,wo,rn,Sn,vn,fn,mn,cn,un,Io,zo,_o];for(let t of pe)t.plain&&Ce(t.selector,t.plain);var V=null,Nt,ht=null,me=[];function Ze(){Nt!==void 0||ht||V||typeof document>"u"||document.documentElement.hasAttribute("data-vx-plain")||globalThis.navigator?.gpu&&$s(ge().then(t=>t??An(),An))}function An(){try{return St.supported()?new St:null}catch{return null}}function $s(t){if(V)throw new Error("voxelmorphism: use() must come before the first adopt()");let e=ht=Promise.resolve(t).catch(()=>null).then(n=>{if(ht!==e)return V;Nt=n&&typeof n.draw=="function"?n:null,ht=null;let o=me;me=[];for(let[r,s]of o)(s===document||s.isConnected)&&r(s);return V});return e}var he=null;function En(){if(he||typeof document>"u"||!document.fonts?.load)return he??Promise.resolve();let t=getComputedStyle(document.documentElement).getPropertyValue("--vx-key-font").trim();return he=t?Promise.all([400,700].map(e=>document.fonts.load(`${e} 20px ${t}`).catch(()=>{}))):Promise.resolve(),he}function Qs(){return Ze(),ht?ht.then(()=>Qs()):En().then(()=>Rn())}function Js(){return Ze(),document.documentElement.hasAttribute("data-vx-plain")||ht?!0:Nt===void 0?!St.supported():Nt===null}function Rn(){if(V||Js())return V;try{V=new re(Nt??new St)}catch{V=null}return V&&(V.onfail=tr),V}function tr(){V&&(Pn(document),V=null,Nt=null,document.dispatchEvent(new CustomEvent("vx-plain")))}function Tn(t=document){if(Ze(),ht&&!document.documentElement.hasAttribute("data-vx-plain"))return me.push([Tn,t]),null;En(),or();let e=Rn();if(!e)return Ie(t),null;for(let n of pe){let o=t.querySelectorAll?[...t.querySelectorAll(n.selector)]:[];t.matches?.(n.selector)&&o.unshift(t);for(let r of o)bo(r),e.add(r,n)}return e}function Pn(t=document){if(ht){me.push([Pn,t]);return}if(!V)return;let e=V.boundUnder(t);for(let n of e)V.remove(n);for(let n of e)Ie(n,!1)}function Tc(t){V?.lives.get(t)?.rebuild();for(let e of V?.bindings.get(t)?.values()??[])e.def.refresh?.(e)}function er(t){return V?.lives.get(t)??null}var Ln=null;function or(){let t=document.documentElement.dataset;Ln||!t.shell||nr({shell:t.shell,caps:t.caps,profile:t.profile,rail:t.rail})}function nr(t){let e=Ho(t);return Ln=e,Wo(e,document.documentElement,V),e}function Pc(t){pe.includes(t)||(pe.push(t),t.plain&&Ce(t.selector,t.plain))}var Lc=$o(t=>Tn(t),t=>er(t));export{X as a,bt as b,It as c,rt as d,zt as e,F as f,rr as g,Cn as h,N as i,C as j,Q as k,Wt as l,Xt as m,ve as n,Yo as o,$s as p,Qs as q,Rn as r,Tn as s,Pn as t,Tc as u,er as v,nr as w,Pc as x,Lc as y};
