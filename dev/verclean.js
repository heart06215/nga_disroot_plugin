(function(){
  var a = document.getElementById('pwtest');
  if (a && a.parentNode) a.parentNode.removeChild(a);
  var b = document.getElementById('ngaext-ver');
  if (b && b.parentNode) b.parentNode.removeChild(b);
  try { window.NGAEXT_VER = { code: 90969, name: '9.9.69', targetCode: 90969, targetName: '9.9.69', ok: true }; } catch (e) {}
  return 'CLEANED';
})()
