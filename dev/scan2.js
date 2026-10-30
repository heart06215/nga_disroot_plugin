(function(){
  var t = document.body ? document.body.innerText.replace(/\s+/g, ' ') : '';
  return JSON.stringify({ head: t.slice(0, 220), len: t.length });
})()
