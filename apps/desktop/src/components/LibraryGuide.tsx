import { useState } from "react";
import { libraryRequest } from "@/data/library-manager";
import type { LibraryController } from "@/data/use-library-controller";
const LESSONS=[
 {title:"收藏集就是普通文件夹",text:"在资料库内创建同名文件夹，Ceas 会按真实目录组织素材。原件可以继续用其他软件查看和管理。"},
 {title:"用整理信息快速找到素材",text:"给素材填写描述、来源、评分和标签。常见图片还可以通过颜色索引查找相似颜色。"},
 {title:"随时管理你的资料库",text:"点击顶部库名旁的管理入口，可以打开其他资料库、修改名称或迁移位置。你也可以在设置里重新查看这份引导。"},
];
export function LibraryGuide({controller}:{controller:LibraryController}){
 const [step,setStep]=useState(controller.snapshot.guide.done?0:controller.snapshot.guide.step),[saving,setSaving]=useState(false);
 const lesson=LESSONS[step]??LESSONS[0];
 const go=async(next:number)=>{setSaving(true);try{await libraryRequest({action:"guide",step:next,done:false});setStep(next);}catch(reason){controller.setError(String(reason));}finally{setSaving(false);}};
 return <section className="library-card library-form" aria-label="新手引导">
  <p className="library-small">使用引导 · {step+1} / {LESSONS.length}</p><h1 tabIndex={-1}>{lesson?.title}</h1><p className="library-muted">{lesson?.text}</p>
  <div className="library-actions">
   {step>0?<><button className="library-btn" disabled={saving} onClick={()=>void go(step-1)}>上一步</button><button className="library-btn" disabled={saving} onClick={()=>void go(0)}>从头查看</button></>:null}
   <button className="library-btn" data-primary disabled={saving} onClick={()=>void(step<2?go(step+1):controller.finishGuide())}>{step<2?"下一步":controller.snapshot.active?"进入资料库":"完成引导"}</button>
   <button className="library-btn" disabled={saving} onClick={()=>void(step<2?go(step+1):controller.finishGuide())}>跳过此步</button>
   <button className="library-btn" disabled={saving} onClick={()=>void controller.finishGuide()}>结束引导</button>
  </div><p className="library-small">可在“设置 → 新手引导”再次查看。</p>
 </section>;
}
