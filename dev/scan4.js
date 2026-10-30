(function(){
  var html = document.documentElement ? document.documentElement.outerHTML : '';
  var text = document.body ? (document.body.textContent || '') : '';
  var anchors = [].map.call(document.querySelectorAll('a[href]'), function(a){ return a.getAttribute('href'); });
  var ext = anchors.filter(function(h){ return h && !/^javascript:/i.test(h); });
  var chars = {};
  var t = text.replace(/\s+/g, '');
  for (var i = 0; i < t.length; i++) chars[t.charAt(i)] = (chars[t.charAt(i)] || 0) + 1;
  return JSON.stringify({
    frames: window.frames ? window.frames.length : -1,
    textLen: text.length,
    htmlLen: html.length,
    disrootInText: text.indexOf('disroot') >= 0,
    disrootInHtml: html.indexOf('disroot') >= 0,
    binCount: (text.match(/bin/gi) || []).length,
    httpCount: (text.match(/http/gi) || []).length,
    anchors: ext.slice(0, 10),
    tail: text.slice(-160).replace(/\s+/g, ' ')
  }, null, 1);
})()
