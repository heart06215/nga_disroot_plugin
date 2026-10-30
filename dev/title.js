(function(){
  var t = document.querySelector('.articleTitle, .titleBlock, .wrapBox h1, .title');
  var head = document.body ? (document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 120) : '';
  return JSON.stringify({
    titleEl: t ? t.textContent.trim().slice(0, 80) : null,
    docTitle: document.title,
    head: head
  });
})()
