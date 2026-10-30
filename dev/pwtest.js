(function(){
  var old = document.getElementById('pwtest');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  var wrap = document.createElement('div');
  wrap.className = 'contentBox';
  wrap.id = 'pwtest';
  wrap.innerHTML =
    '<div class="columnItem"><div class="articleBlock">说明：后面的密码全都是 ardan</div></div>' +
    '<div class="columnItem"><div class="articleBlock">内容：bin.disroot.org/?87705269a6ca6c4c#watTcvH6BHy672wQYfkmPMwfeiFVTWfSiR8brXGqE6j</div></div>';
  document.body.appendChild(wrap);
  return 'ADDED';
})()
