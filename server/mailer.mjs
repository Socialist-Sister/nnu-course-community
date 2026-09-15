import nodemailer from 'nodemailer';
import {ApiError} from './catalog.mjs';

export function definitelyNotSent(cause){
  return !!(cause.mailDefinitelyNotSent||cause.responseCode>=400||['EDNS','EAUTH'].includes(cause.code)||['CONN','AUTH','MAIL FROM','RCPT TO'].includes(cause.command));
}

export function createMailer(env=process.env){
  const ready=!!(env.SMTP_HOST&&env.SMTP_USER&&env.SMTP_PASS&&env.MAIL_FROM);
  let transport;
  return {
    ready,
    async send({email,code,purpose}){
      if(!ready)throw new ApiError(503,'邮件服务暂未开通，请稍后再试');
      const port=Number(env.SMTP_PORT||465);
      if(!Number.isInteger(port)||port<1||port>65535)throw new ApiError(503,'邮件服务配置有误，请联系站点管理员');
      transport ||= nodemailer.createTransport({host:env.SMTP_HOST,port,secure:port===465,requireTLS:true,
        auth:{user:env.SMTP_USER,pass:env.SMTP_PASS},connectionTimeout:8000,greetingTimeout:8000,socketTimeout:10000,
        logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true});
      const label={register:'注册账号',recover:'重设密码',bind:'绑定校园邮箱'}[purpose];
      try{
        const result=await transport.sendMail({from:env.MAIL_FROM,to:email,subject:`南师选课簿：${label}验证码`,
          text:`你正在${label}。\n\n验证码：${code}\n\n10 分钟内有效，仅限本次操作，重新发送后旧码失效。请勿向他人透露验证码。\n若不是你本人操作，请忽略此邮件。\n\n南师选课簿 · 学生自发建设，非学校官方网站`});
        if(!result.accepted?.length)throw Object.assign(Error('recipient rejected'),{mailDefinitelyNotSent:true});
      }catch(cause){
        const error=new ApiError(503,'验证码发送失败，请稍后重试');
        // SMTP rejection or failure before DATA is certain; a DATA/socket timeout is not.
        error.mailDefinitelyNotSent=definitelyNotSent(cause);
        throw error;
      }
    }
  };
}
