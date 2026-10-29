/* 仓库预览只用原创几何素材，绝不读取用户参考图库。 */
import {chromium} from "playwright";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
const fixtures=resolve(".cache/tmp/repository-presentation/fixtures");mkdirSync(fixtures,{recursive:true});mkdirSync("docs/media",{recursive:true});
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
try{
 if(process.argv.includes("--generate")){
  const images=await page.evaluate(()=>Array.from({length:24},(_,index)=>{
   const sizes=[[640,800],[800,640],[640,720],[720,960],[800,600],[640,640]];const [w,h]=sizes[index%6];
   const c=document.createElement("canvas");c.width=w;c.height=h;const x=c.getContext("2d");
   const palette=["#c9795b","#6b8791","#9ca88e","#c4bba9","#b7adc8","#242825"];
   const color=palette[index%palette.length],paper=index%8===7?"#242825":"#eeeae2",ink=index%8===7?"#eeeae2":"#242825";
   x.fillStyle=paper;x.fillRect(0,0,w,h);x.fillStyle=color;
   if(index%6===0){x.fillRect(w*.23,h*.34,w*.54,h*.46);x.beginPath();x.arc(w*.5,h*.34,w*.27,Math.PI,0);x.fill();x.fillStyle=paper;x.fillRect(w*.38,h*.48,w*.24,h*.33);x.beginPath();x.arc(w*.5,h*.48,w*.12,Math.PI,0);x.fill();}
   if(index%6===1){for(let n=0;n<6;n++){x.fillStyle=n%2?paper:color;x.fillRect(w*.15+n*w*.05,h*.15+n*h*.08,w*.7-n*w*.1,h*.7-n*h*.12);}x.strokeStyle=ink;x.lineWidth=2;x.strokeRect(w*.12,h*.12,w*.76,h*.76);}
   if(index%6===2){x.fillStyle=color;for(let n=0;n<5;n++){x.beginPath();x.ellipse(w*.5,h*.4+n*h*.075,w*(.3-n*.028),h*.055,0,0,Math.PI*2);x.fill();}x.strokeStyle=paper;x.lineWidth=2;for(let n=0;n<4;n++){x.beginPath();x.ellipse(w*.5,h*.4+n*h*.075,w*(.3-n*.028),h*.055,0,0,Math.PI);x.stroke();}}
   if(index%6===3){x.fillStyle=ink;x.font=`500 ${w*.21}px sans-serif`;x.fillText("FORM",w*.09,h*.38);x.fillText("&",w*.09,h*.55);x.fillText("SPACE",w*.09,h*.72);x.fillStyle=color;x.fillRect(w*.1,h*.79,w*.8,h*.035);}
   if(index%6===4){for(let row=0;row<4;row++)for(let col=0;col<5;col++){x.fillStyle=(row+col)%3===0?color:(row+col)%2===0?ink:"#d8d3c8";x.fillRect(w*.13+col*w*.15,h*.2+row*h*.15,w*.13,h*.13);}}
   if(index%6===5){x.fillStyle="#d8d3c8";x.fillRect(w*.1,h*.13,w*.8,h*.73);x.strokeStyle=ink;x.lineWidth=w*.018;for(let n=0;n<7;n++){x.beginPath();x.arc(w*.5,h*.51,w*(.08+n*.04),0,Math.PI*2);x.stroke();}x.fillStyle=color;x.beginPath();x.arc(w*.72,h*.27,w*.065,0,Math.PI*2);x.fill();}
   x.fillStyle=ink;x.font=`500 ${w*.022}px sans-serif`;x.fillText(`CEAS / VISUAL STUDY ${String(index+1).padStart(2,"0")}`,w*.08,h*.075);
   x.globalAlpha=.55;x.font=`${w*.016}px monospace`;x.fillText("ORIGINAL GEOMETRY · REPOSITORY DEMO",w*.08,h*.95);
   return c.toDataURL("image/png").split(",")[1];
  }));
  images.forEach((data,index)=>writeFileSync(join(fixtures,`study-${String(index+1).padStart(2,"0")}.png`),Buffer.from(data,"base64")));console.log(`原创预览素材：${images.length} 个，${fixtures}`);
 }else{
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(process.env.APP_URL??"http://127.0.0.1:5174",{waitUntil:"networkidle"});
  await page.waitForFunction(()=>document.querySelectorAll(".cell").length===24);
  await page.evaluate(async()=>{
   const manifest=await (await fetch("/__fixtures/manifest.json")).json();
   const {importSources}=await import("/src/data/importer.ts");
   const {saveTagGroups}=await import("/src/data/collections.ts");
   const result=await importSources(manifest.map((item,index)=>({url:item.url,name:item.name,relativePath:index<8?`形态研究/${item.name}`:index<16?`版式与色彩/${item.name}`:index<22?`空间与构成/${item.name}`:item.name,tags:[index%2?"构成":"几何",index%3?"色彩":"留白"],description:"为 Ceas 仓库预览绘制的原创几何样张。"}))).promise;
   if(result.failed.length)throw Error(JSON.stringify(result.failed));
   await saveTagGroups([{id:"demo-visual",name:"视觉语言",color:"#6b8791",tags:["几何","构成","留白","色彩"]}]);
  });
  await page.reload({waitUntil:"networkidle"});await page.waitForFunction(()=>document.querySelectorAll(".cell").length>=18);
  // 仅隐藏开发性能诊断；发布界面本身不会渲染该角标。
  await page.addStyleTag({content:".perf-hud { display: none !important; }"});
  await page.locator(".cell img").evaluateAll(images=>Promise.all(images.map(img=>img.decode().catch(()=>{}))));
  await page.screenshot({path:"docs/media/grid.png"});
  await page.keyboard.press("Alt+2");await page.waitForTimeout(700);await page.screenshot({path:"docs/media/canvas.png"});
  await page.keyboard.press("Alt+3");await page.waitForTimeout(700);await page.screenshot({path:"docs/media/infinity.png"});
  await page.keyboard.press("Alt+1");await page.evaluate(()=>{document.documentElement.dataset.theme="dark";});await page.waitForTimeout(250);await page.screenshot({path:"docs/media/grid-dark.png"});
  if(errors.length)throw Error(JSON.stringify(errors));console.log("四张真实界面截图完成；内容均为原创几何样张，页面错误 0。");
 }
}finally{await browser.close();}
