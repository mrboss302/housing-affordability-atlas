"use strict";
// Run after: node tools/generate.js. No npm dependencies.
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname,"..");
const read=(p)=>fs.readFileSync(path.join(root,p),"utf8");
const w={};const context=vm.createContext({window:w,document:undefined,console,Intl});
for(const f of ["assets/data/assumptions.js","assets/data/states.js","assets/data/market-data.js",
  "assets/data/census-data.js","assets/js/affordability.js","assets/data/source-metadata.js","assets/js/compare.js"]){
  vm.runInContext(read(f),context,{filename:f});
}
const H=w.HAM,C=w.HAM_COMPARE,A=w.HAM_ASSUMPTIONS;
assert.ok(H&&C&&A,"Missing core comparison modules");
const md=w.HAM_STATES.find(s=>s.abbr==="MD");
const cs=w.HAM_CENSUS.regions.find(s=>s.abbr==="MD");
const original=H.evaluateState(md,{layer:"median"});
assert.equal(original.provenance.income,"census");
const zori=w.HAM_MARKET.regions.filter(r=>Number(r.zori)>0).length;
if(zori===0){
  assert.equal(original.provenance.rent,"census");
  assert.equal(original.region.rent.value,cs.medianGrossRent);
  assert.equal(w.HAM_SOURCES.fields.rent.status,"real");
}
assert.ok(original.rentBurden>0&&original.rentBurden<100,"Incorrect rent percent");
assert.equal(H.rentBurden(1500,60000),30);
const link=new URL(H.atlasCalcUrl(400000,{income:75000}));
assert.equal(link.origin,"https://homepaymentatlas.com");
assert.equal(link.searchParams.get("tax"),String(Math.round(400000*A.propertyTaxRate)));
assert.equal(link.searchParams.get("ins"),String(Math.round(400000*A.insuranceRate)));
assert.equal(link.searchParams.get("income"),"75000");
const base=C.calc(md,{layer:"median",income:75000,down:10,rate:6.7,term:30});
assert.ok(base&&base.monthly>0);
assert.equal(base.monthly,original.monthlyPayment);
assert.equal(base.rentSource,original.provenance.rent);
assert.ok(base.stressedIncrease>0);
assert.ok(Math.abs(base.left-(75000/12*0.28-base.monthly))<0.05);
const lower=C.calc(md,{layer:"median",income:75000,down:10,rate:5,term:30});
const zero=C.calc(md,{layer:"median",income:75000,down:20,rate:0,term:30});
assert.ok(lower.monthly<base.monthly);
assert.equal(zero.payment.pmi,0);
const va=C.calc(w.HAM_STATES.find(s=>s.abbr==="VA"),
  {layer:"median",income:75000,down:10,rate:6.7,term:30});
assert.ok(va);
assert.equal(C.comparison(base,va).delta,va.monthly-base.monthly);

const compare=read("compare/index.html"),coverage=read("data-updates/index.html");
for(const id of ["ha-first","ha-second","ha-income","ha-down","ha-rate","ha-share",
 "ha-summary","ha-a-payment","ha-b-payment"])
  assert.ok(compare.includes('id="'+id+'"'),"Compare control missing: "+id);
assert.ok(compare.includes("assets/js/compare.js"));
assert.ok(coverage.includes(w.HAM_MARKET.vintage));
assert.ok(coverage.includes(w.HAM_CENSUS.vintage));
assert.ok(coverage.includes(zori+" Zillow ZORI states"));
const methodology=read("methodology/index.html");
assert.ok(methodology.includes("not the official Census"));
assert.ok(methodology.includes("compare/index.html"));
const privacy=read("privacy/index.html");
assert.ok(!privacy.includes("starting template")&&!privacy.includes("contact placeholder"));
assert.ok(privacy.includes("housing-affordability-atlas/issues/new"));
assert.ok(read("states/maryland/index.html").includes("Compare Maryland"));
assert.ok(!read("sitemap.xml").includes("<lastmod>"));
assert.match(read("ads.txt"),/^google\.com, pub-\d+, DIRECT, f08c47fec0942fa0/m);
assert.ok(read("index.html").includes("google-adsense-account"));

function listHtml(dir){
 let out=[];
 for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
  const p=path.posix.join(dir,e.name);
  if(e.isDirectory())out.push(...listHtml(p));
  else if(e.name.endsWith(".html"))out.push(p);
 }
 return out;
}
const pages=["index.html",...["map","states","places","income","rankings",
 "methodology","about","privacy","terms","compare","data-updates"].flatMap(listHtml)];
const sitemap=read("sitemap.xml");
const urls=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
const paths=new Set(urls.map(u=>new URL(u).pathname));
assert.ok(urls.length>=70,"Unexpectedly few sitemap pages");
assert.equal(paths.size,urls.length,"Duplicate sitemap paths");
for(const file of pages){
 const html=read(file);
 assert.match(html,/<title>[^<]+<\/title>/,file+" title");
 assert.equal((html.match(/<h1(?:\s|>)/g)||[]).length,1,file+" headings");
 assert.ok(!html.includes("ad-placeholder"),file+" empty ad placeholder");
 assert.ok(!html.includes('data-ad-slot="1111111111"'),file+" fake ad slot");
 assert.ok(!html.includes('license":"https://creativecommons.org/licenses/by/4.0/'),file+" misleading license");
 const expected="/"+file.replace(/index\.html$/,"");
 const noindex=/<meta name="robots" content="noindex,follow">/.test(html);
 if(noindex) assert.ok(!paths.has(expected),file+" noindex page in sitemap");
 else assert.ok(paths.has(expected),file+" indexable page missing in sitemap");
 const canon=html.match(/<link rel="canonical" href="([^"]+)"/);
 assert.ok(canon&&new URL(canon[1]).pathname===expected,file+" bad canonical");
 for(const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g))JSON.parse(m[1]);
}
for(const url of urls){
 const pathname=new URL(url).pathname;
 const file=pathname==="/"?"index.html":pathname.slice(1)+"index.html";
 assert.ok(fs.existsSync(path.join(root,file)),url+" missing indexed document");
}
console.log("Verified "+pages.length+" HTML pages, "+urls.length+" indexed URLs, source provenance and affordability arithmetic.");
