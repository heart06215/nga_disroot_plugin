(function(){
  var t = document.body ? document.body.innerText : '';
  var lines = t.split('\n').filter(function(l){ return l.indexOf('disroot') >= 0; });
  var m = t.match(/(?:[a-z0-9-]+\.)*disroot\.org\/[^\s]{0,120}/ig) || [];
  return JSON.stringify({
    title: document.title,
    len: t.length,
    lineCount: lines.length,
    sampleLines: lines.slice(0, 3).map(function(l){ return l.slice(0, 160); }),
    links: m.slice(0, 5)
  }, null, 1);
})()
