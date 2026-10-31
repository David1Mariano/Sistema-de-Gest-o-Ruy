export function isAuthorizedAttachmentDownload(value,origin){
 try{const url=new URL(value);return url.origin===origin&&!url.username&&!url.password&&!url.search&&!url.hash&&/^\/api\/d1\/(?:history\/)?attachments\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/download$/.test(url.pathname);}catch{return false;}
}
