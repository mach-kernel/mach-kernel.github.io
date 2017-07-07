require('jquery');
require('bootstrap-loader');

import * as heros from 'hero-patterns';

// TODO: awful
var randomHero = function() {
  var heros = Object.values(this);

  var rgb = $('#contrast').css('background-color')
                          .split('(')[1]
                          .split(')')[0]
                          .split(',');

  var hex = rgb.map(function(a) {
    return (parseInt(a)).toString(16);
  });

  document.body
          .style
          .backgroundImage = heros[Math.floor(Math.random() * (heros.length - 1))](
    '#' + hex.join(''), 0.50
  );
}.bind(heros);

$(document).ready(randomHero);
