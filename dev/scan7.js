(function(){
  var t = document.body ? (document.body.textContent || '') : '';
  var compact = t.replace(/[^A-Za-z0-9?#]/g, '');
  var hasDisroot = /disroot/i.test(compact);
  var m = compact.match(/\?([0-9a-fA-F]{16})#([1-9A-HJ-NP-Za-km-z]{20,60})/g) || [];
  return JSON.stringify({
    textLen: t.length,
    compactLen: compact.length,
    hasDisrootInCompact: hasDisroot,
    fpCount: m.length,
    fps: m.slice(0, 6)
  }, null, 1);
})()
