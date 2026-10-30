(function(){
  var out = [];
  var all = document.querySelectorAll('*');
  for (var i = 0; i < all.length && out.length < 30; i++) {
    var el = all[i];
    for (var k = 0; k < el.attributes.length; k++) {
      var a = el.attributes[k];
      var v = a.value || '';
      if (v.indexOf('disroot') >= 0) {
        out.push({ attr: a.name, val: v.slice(0, 180), tag: el.tagName });
      }
    }
  }
  return JSON.stringify({ count: out.length, hits: out.slice(0, 10) }, null, 1);
})()
