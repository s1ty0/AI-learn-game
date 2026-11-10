// A guard against an old tab posting its draft after the cookie changes accounts.
let account="";
export function setAccountIdentity(value:string){account=value;}
export function accountHeaders():Record<string,string>{return account?{"X-LearnAI-Account":account}:{};}
