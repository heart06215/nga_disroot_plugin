(function(){
  window.NGAEXT_VER = { code: 90970, name: '9.9.70', targetCode: 90969, targetName: '9.9.69', ok: false };
  try { window.__ngaext.scan(); } catch (e) {}
  var b = document.getElementById('ngaext-ver');
  return JSON.stringify({
    banner: !!b,
    text: b ? b.textContent.slice(0, 80) : null
  });
})()
