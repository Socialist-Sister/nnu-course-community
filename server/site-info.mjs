export function siteInfo(env=process.env){
  const email=env.PUBLIC_CONTACT_EMAIL?.trim();
  return {contactEmail:email&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)?email:null,policyUpdatedAt:'2026-09-15'};
}
