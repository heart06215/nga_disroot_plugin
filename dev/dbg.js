(function(){
  var d = window.__ngaext && window.__ngaext._dbg;
  if (!d) return JSON.stringify({ dbg: false });
  function snap(key) {
    var e = d.entry(key);
    return { sticky: e.sticky, pws: e.pws, cands: d.cands('', e.sticky, e.pws) };
  }
  return JSON.stringify({
    dbg: true,
    currentThread: d.threadKey(),
    u111: snap('u111'),
    u222: snap('u222'),
    falsePositiveTest: {
      linkText: d.pw('另一个帖子，没有写密码：bin.disroot.org/?87705269a6ca6c4c#x'),
      normalText: d.pw('密码：ardan'),
      stickyText: d.pw('后面的密码全都是 ardan')
    }
  }, null, 1);
})()
