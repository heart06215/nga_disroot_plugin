(function(){
  var html = document.documentElement.outerHTML;
  var out = [];
  var idx = 0;
  while (out.length < 8) {
    var i = html.toLowerCase().indexOf('disroot', idx);
    if (i < 0) break;
    out.push(html.slice(Math.max(0, i - 90), i + 120).replace(/\s+/g, ' '));
    idx = i + 7;
  }
  return JSON.stringify({ count: out.length, snippets: out }, null, 1);
})()
