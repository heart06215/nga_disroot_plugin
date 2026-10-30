(function(){
  var html = document.documentElement ? document.documentElement.outerHTML : '';
  var blocks = document.querySelectorAll('.articleBlock');
  var sample = '';
  if (blocks.length) {
    sample = (blocks[0].textContent || '').replace(/\s+/g, ' ').slice(0, 200);
  }
  var scripts = '';
  var ss = document.querySelectorAll('script');
  for (var i = 0; i < ss.length; i++) scripts += ss[i].textContent || '';
  return JSON.stringify({
    blocks: blocks.length,
    htmlLen: html.length,
    disrootInHtml: /disroot/i.test(html),
    disrootInScripts: /disroot/i.test(scripts),
    httpCount: (html.match(/http/gi) || []).length,
    sample: sample
  }, null, 1);
})()
