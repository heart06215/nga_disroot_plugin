(function(){
  var clicked = 0;
  var all = document.querySelectorAll('a,div,span,button');
  for (var i = 0; i < all.length && clicked < 8; i++) {
    var t = (all[i].textContent || '').trim();
    if (t.length > 0 && t.length < 8 && t.indexOf('展开') >= 0) {
      try { all[i].click(); clicked++; } catch (e) {}
    }
  }
  return 'clicked=' + clicked;
})()
