(function(){
  var old = document.getElementById('expTest');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  var d = document.createElement('div');
  d.className = 'columnItem';
  d.id = 'expTest';
  d.innerHTML =
    '<div class="articleBlock">可见链接：bin.disroot.org/?0123456789abcdef#11111111111111111111111111111111111111111111</div>' +
    '<div id="hid" style="display:none">隐藏链接：bin.disroot.org/?fedcba9876543210#11111111111111111111111111111111111111111111</div>' +
    '<button id="expBtn" style="padding:10px 16px;border:1px solid #888;background:#fff;color:#000">展开</button>';
  document.body.appendChild(d);
  document.getElementById('expBtn').addEventListener('click', function(){
    document.getElementById('hid').style.display = 'block';
    this.style.display = 'none';
  });
  return 'EXP_TEST_ADDED';
})()
