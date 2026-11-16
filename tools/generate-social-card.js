/*
 * Deterministic 1200×630 Open Graph PNG for Housing Affordability Atlas.
 * Pure Node.js, no raster/image dependencies, no network. Generated during build.
 */
"use strict";
const { writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const { deflateSync } = require("node:zlib");

const WIDTH=1200, HEIGHT=630;
const rgba=new Uint8Array(WIDTH*HEIGHT*4);
const COLOR={
  navy:[15,27,45], dark:[20,44,60], forest:[19,104,99],
  sea:[31,147,132], mint:[118,211,185], butter:[245,211,125],
  cream:[250,252,245], muted:[174,205,204], faint:[38,65,80]
};
function rect(x,y,w,h,hex){
  const c=COLOR[hex]||COLOR.navy;
  const minX=Math.max(0,Math.floor(x)),maxX=Math.min(WIDTH,Math.ceil(x+w));
  const minY=Math.max(0,Math.floor(y)),maxY=Math.min(HEIGHT,Math.ceil(y+h));
  for(let j=minY;j<maxY;j++){
    for(let i=minX;i<maxX;i++){
      const o=(j*WIDTH+i)*4;rgba[o]=c[0];rgba[o+1]=c[1];rgba[o+2]=c[2];rgba[o+3]=255;
    }
  }
}
const GLYPHS={
 A:"01110/10001/10001/11111/10001/10001/10001",
 B:"11110/10001/10001/11110/10001/10001/11110",
 C:"01111/10000/10000/10000/10000/10000/01111",
 D:"11110/10001/10001/10001/10001/10001/11110",
 E:"11111/10000/10000/11110/10000/10000/11111",
 F:"11111/10000/10000/11110/10000/10000/10000",
 G:"01111/10000/10000/10111/10001/10001/01111",
 H:"10001/10001/10001/11111/10001/10001/10001",
 I:"11111/00100/00100/00100/00100/00100/11111",
 L:"10000/10000/10000/10000/10000/10000/11111",
 M:"10001/11011/10101/10101/10001/10001/10001",
 N:"10001/11001/10101/10011/10001/10001/10001",
 O:"01110/10001/10001/10001/10001/10001/01110",
 P:"11110/10001/10001/11110/10000/10000/10000",
 R:"11110/10001/10001/11110/10100/10010/10001",
 S:"01111/10000/10000/01110/00001/00001/11110",
 T:"11111/00100/00100/00100/00100/00100/00100",
 U:"10001/10001/10001/10001/10001/10001/01110",
 V:"10001/10001/10001/10001/10001/01010/00100",
 Y:"10001/10001/01010/00100/00100/00100/00100",
 " ":"00000/00000/00000/00000/00000/00000/00000",
 ".":"00000/00000/00000/00000/00000/00110/00110"
};
function drawText(text,x,y,scale,color){
  for(const ch of text.toUpperCase()){
    const pattern=(GLYPHS[ch]||GLYPHS[" "]).split("/");
    for(let j=0;j<7;j++)for(let i=0;i<5;i++){
      if(pattern[j][i]==="1")rect(x+i*scale,y+j*scale,scale-1,scale-1,color);
    }
    x+=6*scale;
  }
}
function crc32(buf){
  let crc=0xffffffff;
  for(const b of buf){
    crc^=b;
    for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
function chunk(name,bytes){
  const type=Buffer.from(name,"ascii"),len=Buffer.alloc(4),crc=Buffer.alloc(4);
  len.writeUInt32BE(bytes.length);
  crc.writeUInt32BE(crc32(Buffer.concat([type,bytes])));
  return Buffer.concat([len,type,bytes,crc]);
}
function generate(output=join(__dirname,"..","assets","og-card.png")){
  rect(0,0,WIDTH,HEIGHT,"navy");
  rect(0,0,18,HEIGHT,"sea");
  rect(64,69,92,8,"mint");
  drawText("HOUSING",72,122,12,"cream");
  drawText("AFFORDABILITY",72,240,8,"mint");
  drawText("ATLAS",72,338,12,"cream");
  rect(72,469,605,2,"faint");
  drawText("HOME VALUES   INCOME   MAPS",73,508,4,"muted");

  // A recognizable atlas-style abstract heatmap, not a fictitious real-data map.
  const tiles=[
    [0,1,1,0,0,0],[1,1,2,2,0,0],[1,2,2,3,3,0],[0,2,3,4,4,3],
    [0,1,2,3,4,4],[0,0,1,2,3,0],[0,0,0,1,2,0]
  ];
  const colors=["navy","dark","forest","sea","mint"];
  const ox=819,oy=139,cell=44,gap=10;
  tiles.forEach((row,y)=>row.forEach((v,x)=>{
    if(v)rect(ox+x*(cell+gap),oy+y*(cell+gap),cell,cell,colors[v]);
  }));
  rect(815,550,36,7,"butter");
  rect(865,550,36,7,"forest");
  rect(915,550,36,7,"sea");
  rect(965,550,36,7,"mint");

  const rowStride=WIDTH*4+1,raw=Buffer.alloc(rowStride*HEIGHT);
  for(let y=0;y<HEIGHT;y++) {
    raw[y*rowStride]=0;
    raw.set(rgba.subarray(y*WIDTH*4,(y+1)*WIDTH*4),y*rowStride+1);
  }
  const header=Buffer.alloc(13);
  header.writeUInt32BE(WIDTH,0);header.writeUInt32BE(HEIGHT,4);
  header[8]=8;header[9]=6;header[10]=0;header[11]=0;header[12]=0;
  const png=Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),
    chunk("IDAT",deflateSync(raw,{level:9})),chunk("IEND",Buffer.alloc(0))
  ]);
  mkdirSync(require("node:path").dirname(output),{recursive:true});
  writeFileSync(output,png);
  return {output,bytes:png.length,width:WIDTH,height:HEIGHT};
}
if(require.main===module){console.log(generate());}
module.exports={generate};
