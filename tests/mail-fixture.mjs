import assert from 'node:assert/strict';

// Only tests inject this mailer. No development endpoint exposes verification codes.
export function testMailbox(){
  const messages=[];
  return {messages,ready:true,async send(message){messages.push({...message});}};
}
export async function emailProof(call,client,mailbox,email,purpose='register'){
  const sent=await call(client,'/api/account/send-code','POST',{email,purpose});
  assert.equal(sent.status,200,JSON.stringify(sent.data));
  const message=mailbox.messages.findLast(m=>m.email===email.toLowerCase()&&m.purpose===purpose);
  assert.ok(message);
  return {email,challengeId:sent.data.challengeId,emailCode:message.code};
}
