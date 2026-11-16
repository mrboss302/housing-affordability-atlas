/*
 * Strict SEO regression checks run after node tools/generate.js.
 * No browser, network, or external dependencies required.
 */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const origin="https://housingaffordabilityatlas.com";
const read=(p)=>fs.readFileSync(path.join(root,p),"utf8");
const exists=(p)=>fs.existsSync(path.join(root,p));
const directories=["map","states","places","income","rankings","methodology",
  "about","privacy","terms","compare","data-updates"];

function list(dir) {
  if(!exists(dir))return [];
  const out=[];
  for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
    const name=path.posix.join(dir,e.name);
    if(e.isDirectory())out.push(...list(name));
    else if(e.name==="index.html")out.push(name);
  }
  return out;
}
const htmlFiles=["index.html",...directories.flatMap(list)];
const sitemap=read("sitemap.xml");
const urls=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
const canonicalPaths=new Set(urls.map(u=>new URL(u).pathname));
assert.ok(urls.length>=70,"Expected substantive set of indexable pages");
assert.equal(urls.length,canonicalPaths.size,"Duplicate URLs in sitemap");
assert.ok(!sitemap.includes("<lastmod>"),"Build time is not source-update date");
assert.ok(read("robots.txt").includes(origin+"/sitemap.xml"),"Incorrect robots sitemap");

const indexable=new Map();
const graph=new Map();
const titles=new Map();
const descriptions=new Map();
for(const file of htmlFiles){
  const html=read(file);
  const pagePath="/"+file.replace(/index\.html$/,"");
  const expected=origin+pagePath;
  const match=(regex,label)=>{
    const m=html.match(regex);
    assert.ok(m,file+" missing "+label);
    return m[1];
  };
  const title=match(/<title>([^<]+)<\/title>/i,"title").trim();
  const desc=match(/<meta name="description" content="([^"]+)"/i,"description").trim();
  assert.ok(desc.length>=45,file+" meta description too vague");
  assert.equal((html.match(/<h1(?:\s|>)/ig)||[]).length,1,file+" H1 count");
  const canonical=match(/<link rel="canonical" href="([^"]+)"/i,"canonical");
  assert.equal(canonical,expected,file+" canonical mismatch");
  const image=match(/<meta property="og:image" content="([^"]+)"/i,"Open Graph image");
  assert.equal(image,origin+"/assets/og-card.png");
  assert.ok(html.includes('name="twitter:image"'),file+" Twitter image missing");
  assert.ok(html.includes('property="og:image:alt"'),file+" image alt missing");
  assert.ok(html.includes('name="google-adsense-account"'),file+" AdSense verification removed");
  const noindex=/<meta name="robots" content="noindex,follow">/.test(html);
  if(noindex){
    assert.ok(!canonicalPaths.has(pagePath),file+" noindex URL in sitemap");
  }else{
    assert.ok(canonicalPaths.has(pagePath),file+" indexable URL missing from sitemap");
    assert.ok(!titles.has(title),file+" repeats title from "+titles.get(title));
    assert.ok(!descriptions.has(desc),file+" repeats description from "+descriptions.get(desc));
    titles.set(title,file);descriptions.set(desc,file);
    indexable.set(pagePath,file);
  }
  let hasWebPageOrSite=false;
  for(const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)){
    const value=JSON.parse(m[1]);
    if(value["@type"]==="WebPage"){
      assert.equal(value.url,expected,file+" WebPage JSON-LD mismatch");
      hasWebPageOrSite=true;
    }
    if(value["@type"]==="WebSite"){
      assert.equal(file,"index.html","WebSite schema should describe the homepage");
      hasWebPageOrSite=true;
    }
    if(value["@type"]==="BreadcrumbList"){
      const list=value.itemListElement;
      assert.ok(Array.isArray(list)&&list.length>=2,file+" invalid breadcrumbs");
      assert.equal(list[list.length-1].name.length>0,true);
    }
  }
  assert.ok(hasWebPageOrSite,file+" missing page/schema identity");
  const linked=new Set();
  for(const m of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)){
    const raw=m[1];
    if(!raw || raw.startsWith("#") || /^(?:mailto|tel|javascript|data):/i.test(raw))continue;
    let url;
    try{url=new URL(raw,expected)}catch{throw Error(file+" bad link "+raw)}
    if(url.origin!==origin)continue;
    const target=url.pathname;
    const resource=target==="/"?"index.html":target.endsWith("/")?
      target.slice(1)+"index.html":target.slice(1);
    assert.ok(exists(resource),file+" broken internal link "+raw);
    // The site uses both /section/ and /section/index.html links.
    // Both are real crawlable anchors to the same canonical page.
    const route=target.endsWith("/index.html") ? target.slice(0,-"index.html".length) : target;
    if(canonicalPaths.has(route))linked.add(route);
  }
  graph.set(pagePath,linked);
}
for(const target of canonicalPaths)assert.ok(indexable.has(target),
  "Sitemap references no generated indexable HTML: "+target);
for(const rank of ["best-buyer-opportunity-markets","markets-with-most-price-cuts",
 "least-competitive-housing-markets"]){
  const html=read("rankings/"+rank+"/index.html");
  assert.ok(html.includes('name="robots" content="noindex,follow"'),
    "Unavailable market-signal ranking is indexable: "+rank);
}
assert.ok(read("states/index.html").includes("Housing affordability by state"));
const stateLinks=[...read("states/index.html").matchAll(/href="\.\.\/states\/[^"]+\/"/g)];
assert.equal(stateLinks.length,51,"Directory must contain 51 links to state profiles");
assert.ok(read("rankings/index.html").includes("Housing affordability rankings"));
assert.ok(read("index.html").includes('href="states/index.html"') ||
          read("index.html").includes('href="states/"'),
          "Homepage lacks a plain crawlable link to the states directory");

const seen=new Set(["/"]),queue=["/"];
while(queue.length){
  const from=queue.shift();
  for(const to of graph.get(from)||[]){
    if(indexable.has(to)&&!seen.has(to)){seen.add(to);queue.push(to)}
  }
}
const orphans=[...indexable.keys()].filter(p=>!seen.has(p));
assert.deepEqual(orphans,[],"Indexable pages not reachable through ordinary links");

const notFound=read("404.html");
assert.ok(notFound.includes('name="robots" content="noindex,follow"'));
assert.ok(notFound.includes("states/"));
assert.ok(!canonicalPaths.has("/404.html"));
const image=fs.readFileSync(path.join(root,"assets/og-card.png"));
assert.ok(image.length>1000,"Social image not generated");
assert.equal(image.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
assert.equal(image.readUInt32BE(16),1200);
assert.equal(image.readUInt32BE(20),630);
console.log("SEO checks passed: "+htmlFiles.length+" pages, "+indexable.size+
  " indexable URLs, "+seen.size+" reached from homepage, unique titles/descriptions and valid image.");
