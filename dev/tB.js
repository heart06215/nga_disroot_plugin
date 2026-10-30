(function(){
  var a = document.getElementById('tA');
  if (a && a.parentNode) a.parentNode.removeChild(a);
  var w = document.createElement('div');
  w.className = 'contentBox';
  w.id = 'tB';
  w.innerHTML =
    '<div class="columnItem"><div class="headBlock"><a class="photo" href="javascript:window.ngaObj.doAction(304,[\'222\'])"></a></div>' +
      '<div class="articleBlock">另一个帖子，没有写密码：bin.disroot.org/?87705269a6ca6c4c#watTcvH6BHy672wQYfkmPMwfeiFVTWfSiR8brXGqE6j</div></div>';
  document.body.appendChild(w);
  try { window.__ngaext.scan(); } catch (e) {}
  return 'B_ADDED';
})()
