import {useEffect,useState} from 'react';
export function Avatar({src,className=''}){
  const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[src]);
  return <span className={`profile-avatar ${className}`} aria-hidden="true">{src&&!failed?<img src={src} alt="" onError={()=>setFailed(true)}/>:<span>🦁</span>}</span>;
}
export async function prepareAvatar(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('请选择 JPG、PNG 或 WebP 图片');
  if(file.size>5*1024*1024)throw Error('图片不能超过 5 MB');
  let bitmap;try{
    bitmap=await createImageBitmap(file);
    if(bitmap.width*bitmap.height>16000000)throw Error('图片尺寸过大，请选择较小的图片');
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
    const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,256,256);
    const side=Math.min(bitmap.width,bitmap.height);
    context.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,256,256);
    return canvas.toDataURL('image/jpeg',0.9);
  }catch(e){throw Error(e.message==='图片尺寸过大，请选择较小的图片'?e.message:'无法读取这张图片，请换一张再试');}finally{bitmap?.close();}
}
