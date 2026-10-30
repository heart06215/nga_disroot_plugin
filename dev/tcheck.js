(function(){
  function info(id){
    var w = document.getElementById(id);
    if (!w) return null;
    var c = w.querySelector('.ngaext-card');
    return {
      tag: c ? (c.querySelector('.ngaext-tag') || {}).textContent : null,
      src: c ? (c.querySelector('.ngaext-src') || {}).textContent : null,
      err: c ? (c.querySelector('.ngaext-err') || {}).textContent : null
    };
  }
  var store = {};
  try { store = JSON.parse(localStorage.getItem('ngaext.pwstore.v2') || '{}'); } catch (e) {}
  return JSON.stringify({
    A: info('tA'),
    B: info('tB'),
    storeKeys: Object.keys(store),
    store: store
  });
})()
