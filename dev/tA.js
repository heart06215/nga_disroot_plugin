(function(){
  ['tA','tB'].forEach(function(id){ var e=document.getElementById(id); if(e && e.parentNode) e.parentNode.removeChild(e); });
  var w = document.createElement('div');
  w.className = 'contentBox';
  w.id = 'tA';
  w.innerHTML =
    '<div class="columnItem"><div class="headBlock"><a class="photo" href="javascript:window.ngaObj.doAction(304,[\'111\'])"></a></div>' +
      '<div class="articleBlock">说明：后面的密码全都是 ardan</div></div>' +
    '<div class="columnItem"><div class="headBlock"><a class="photo" href="javascript:window.ngaObj.doAction(304,[\'111\'])"></a></div>' +
      '<div class="articleBlock">内容：bin.disroot.org/?87705269a6ca6c4c#watTcvH6BHy672wQYfkmPMwfeiFVTWfSiR8brXGqE6j</div></div>';
  document.body.appendChild(w);
  return 'A_ADDED';
})()
