import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', root), 'utf8'));

function png(file) {
  const bytes = readFileSync(file);
  assert.equal(bytes.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8);
  assert.equal(bytes[25], 6); // 8bit RGBA，便于验证透明度及裁切区域。
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii',offset+4,offset+8) === 'IDAT') chunks.push(bytes.subarray(offset+8,offset+8+size));
    offset += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), pixels = Buffer.alloc(width*height*4), stride = width*4;
  const paeth = (a,b,c) => { const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c); return pa<=pb&&pa<=pc?a:pb<=pc?b:c; };
  for (let y=0;y<height;y++) {
    const filter=raw[y*(stride+1)];
    for(let x=0;x<stride;x++) {
      const i=y*stride+x,a=x>=4?pixels[i-4]:0,b=y?pixels[i-stride]:0,c=y&&x>=4?pixels[i-stride-4]:0;
      const predict=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];
      assert.notEqual(predict, undefined);
      pixels[i]=(raw[y*(stride+1)+1+x]+predict)&255;
    }
  }
  return { width, height, pixels };
}

test('manifest名称不变，启动与图标路径在GitHub Pages子路径内有效', () => {
  assert.equal(manifest.name, '我的记账');
  assert.equal(manifest.short_name, '记账');
  const base = 'https://xbing9698-ai.github.io/jizhang-app/manifest.webmanifest';
  for(const path of [manifest.start_url,...manifest.icons.map(icon=>icon.src)]) {
    assert.equal(new URL(path,base).pathname.startsWith('/jizhang-app/'), true);
    assert.ok(existsSync(new URL(path,root)));
  }
  assert.ok(manifest.icons.some(icon=>(icon.purpose||'').split(' ').includes('maskable')));
});

for(const size of [192,512]) {
  test(`${size}图标为正确尺寸PNG，美元符号位于maskable安全圆内`, () => {
    const icon = png(new URL(`icons/icon-${size}.png`,root));
    assert.equal(icon.width,size); assert.equal(icon.height,size);
    let foreground = 0;
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
      const i=(y*size+x)*4;
      assert.equal(icon.pixels[i+3],255);
      if(icon.pixels[i]!==247||icon.pixels[i+1]!==246||icon.pixels[i+2]!==243) {
        foreground++;
        assert.ok(Math.hypot(x+.5-size/2,y+.5-size/2)<=size*.4, '核心内容必须在裁切安全区内');
      }
    }
    assert.ok(foreground>size*size*.01 && foreground<size*size*.1, '主体清晰且保留充分留白');
  });
}

test('美元图标有可维护向量源，Apple图标与manifest主题匹配浅色界面',()=>{
  const svg=readFileSync(new URL('icons/icon.svg',root),'utf8');
  const html=readFileSync(new URL('index.html',root),'utf8');
  assert.ok(svg.includes('$')); assert.ok(!svg.includes('¥')); assert.ok(!svg.includes('<text'));
  assert.match(html,/rel="apple-touch-icon" href="icons\/icon-192.png"/);
  assert.match(html,new RegExp('name="theme-color" content="'+manifest.theme_color+'"'));
  assert.equal(manifest.background_color,'#f7f6f3');
});
