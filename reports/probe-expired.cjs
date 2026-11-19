const fs=require("fs");
const raw=JSON.parse(fs.readFileSync("src/data/seed-shelf.json","utf8"));
const cut=new Date(2026,10,12);
const p=(s)=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s||"").trim());return m?new Date(+m[1],+m[2]-1,+m[3]):null};
const days=(a,b)=>Math.round((b-a)/86400000);
const rows=raw.map(r=>({...r,d:p(r.expiresAt)})).filter(r=>r.d);
rows.sort((a,b)=>a.d-b.d);
console.log("--- датированные, ближайшие 6 ---");
for(const r of rows.slice(0,6)){
  console.log(String(r.expiresAt), days(cut,r.d), r.status, "|", r.supplier, "|", r.name.slice(0,45));
}
const exp=rows.filter(r=>days(cut,r.d)<0);
console.log("--- просроченные (все, любой статус): "+exp.length+" ---");
for(const r of exp) console.log(String(r.expiresAt), r.status, "|", r.supplier, "|", r.name.slice(0,45));
const instk=rows.filter(r=>days(cut,r.d)<0 && r.status==="in_stock");
console.log("--- просроченные В НАЛИЧИИ: "+instk.length+" ---");
for(const r of instk) console.log(String(r.expiresAt), r.status, "|", r.supplier, "|", r.name.slice(0,45));
