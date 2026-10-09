// In-process access to the real App.jsx engine functions (no per-call child process, no argv limit). Needs the golden stubs
// on NODE_PATH; sets it up itself.
const path=require('path');process.env.NODE_PATH=[path.join(__dirname,'stubs'),'/home/claude/.npm-global/lib/node_modules'].join(path.delimiter);require('module')._initPaths();
const Module=require('module');const o=Module._resolveFilename;Module._resolveFilename=function(r,...x){if(r.includes('?'))return r;return o.call(this,r,...x)};
const l=Module._load;Module._load=function(r,...x){if(r.includes('?'))return {};return l.call(this,r,...x)};
const {buildBundle}=require('./load-engine.cjs');
require(buildBundle());
module.exports=globalThis.__BW_TEST_EXPORTS__;
