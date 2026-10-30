(function(){
  var t = document.body ? (document.body.textContent || '') : '';
  var m = t.match(/(?:[a-z0-9-]+\.)*disroot\.org\/[^\s]{0,140}/ig) || [];
  var uniq = [];
  for (var i = 0; i < m.length; i++) if (uniq.indexOf(m[i]) < 0) uniq.push(m[i]);
  return JSON.stringify({ count: m.length, uniq: uniq.slice(0, 6) }, null, 1);
})()
