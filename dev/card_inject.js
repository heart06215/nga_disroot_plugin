(function(){
  var old = document.getElementById('cardtest');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  var d = document.createElement('div');
  d.id = 'cardtest';
  d.innerHTML =
    '<div class="columnItem"><div class="articleBlock">A: bin.disroot.org/?f3f54101fc9b62f3#BqQAEd22GBRyjKfr6NrUUERDeULFHMzCtUbKpJR2YZYd</div></div>' +
    '<div style="height:700px;background:#eee">占位内容</div>' +
    '<div class="columnItem"><div class="articleBlock">B: bin.disroot.org/?0123456789abcdef#11111111111111111111111111111111111111111111</div></div>';
  document.body.appendChild(d);
  return 'CARD_TEST_ADDED';
})()
