(function(){
  var wrap = document.getElementById('pwtest');
  if (!wrap) return JSON.stringify({ ok: false, reason: 'no test floor' });
  var card = wrap.querySelector('.ngaext-card');
  var block = wrap.querySelectorAll('.articleBlock')[1];
  var original = block ? block.textContent : '';
  return JSON.stringify({
    card: !!card,
    tag: card ? (card.querySelector('.ngaext-tag') || {}).textContent : null,
    src: card ? (card.querySelector('.ngaext-src') || {}).textContent : null,
    chars: card && card.querySelector('.ngaext-body') ? card.querySelector('.ngaext-body').textContent.length : 0,
    err: card ? (card.querySelector('.ngaext-err') || {}).textContent : null,
    linkStillInOriginal: original.indexOf('87705269a6ca6c4c') >= 0,
    originalLen: original.length
  });
})()
