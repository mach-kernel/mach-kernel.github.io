require('bootstrap-loader');
require('font-awesome-loader');


import clippy from 'clippyjs';
import * as heros from 'hero-patterns';

clippy.load('Clippy', (agent) => {
    // do anything with the loaded agent
    agent.show();
    agent.speak('Can you believe I\'ve been fucking webpacked?');
});

var randomHero = function() {
  var heros = Object.values(this);

  document.body
          .style
          .backgroundImage = heros[Math.floor(Math.random() * (heros.length - 1))](
    '#BBC0D4', 0.25
  );
}.bind(heros);

$(document).ready(randomHero);
