const http=require("http"),fs=require("fs"),path=require("path");
const root=path.resolve(__dirname,"..");
const mime={".html":"text/html",".css":"text/css",".js":"text/javascript",".json":"application/json",".geojson":"application/json",".xml":"application/xml",".txt":"text/plain"};
http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split("?")[0]);if(p.endsWith("/"))p+="index.html";let f=path.join(root,p);
fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);res.end("404");return;}res.writeHead(200,{"Content-Type":mime[path.extname(f)]||"application/octet-stream"});res.end(d);});
}).listen(8766,()=>console.log("serving on 8766"));
