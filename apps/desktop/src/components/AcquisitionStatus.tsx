import type {AcquisitionTarget} from "@ceas/core/acquisition";
import "./acquisition.css";
export function AcquisitionStatus({target}:{target:AcquisitionTarget|null}){
 if(!target)return null;
 return <div className="query-summary acquisition-status" data-rejected={!!target.error||undefined} role="status" aria-live="polite">{target.error??`松开以复制到「${target.label}」${target.path?` · ${target.path}`:""}，文件夹保留完整层级`}</div>;
}
