(function(){
  var imgs = [].map.call(document.querySelectorAll('img'), function(i){
    return { src: (i.currentSrc || i.src || '').slice(0, 120), w: i.naturalWidth, h: i.naturalHeight };
  }).filter(function(x){ return x.src; });
  return JSON.stringify({ imgCount: imgs.length, imgs: imgs.slice(0, 8) }, null, 1);
})()
