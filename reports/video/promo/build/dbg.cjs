const fs = require('fs');
let src = fs.readFileSync(__dirname + '/../music.cjs', 'utf8');
const marker = "const out = process.argv[2]";
src = src.slice(0, src.indexOf(marker));
src += `
console.log("buf max", Math.max(...Array.from(buf).map(Math.abs)));
console.log("buf[1000]", buf[1000], "buf[50000]", buf[50000]);
console.log("pcm max", Math.max(...Array.from(pcm).map(Math.abs)));
`;
fs.writeFileSync(__dirname + '/dbg2.cjs', src);
