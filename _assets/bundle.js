// import clippy from 'clippyjs';

import * as heros from 'hero-patterns';
import 'typeahead.js'
import 'bootstrap-loader'
import 'font-awesome-loader'
import Bloodhound from 'bloodhound-js';

// // Clappy
// clippy.load('Clippy', (agent) => {
//     agent.show();
//     agent.speak('Can you believe I\'ve been fucking webpacked?');
// });

// Do hero background
// TODO: needs refactor
var randomHero = function() {
  var heros = Object.values(this);
  document.body
          .style
          .backgroundImage = heros[Math.floor(
            Math.random() * (heros.length - 1))
          ]('#BBC0D4', 0.25);
}.bind(heros);

$(document).ready(randomHero);


// Typeahead
// TODO: needs sep file
var initTypeahead = function() {
  var allPosts = $('#all-posts li').map(function(n, li) {
    return Object.assign({},
      ...['blurb', 'href', 'title'].map((attr) =>{
        return {[attr]: $(li).attr(attr)};
      })
    );
  }).get();

  var bloodhoundPosts = new Bloodhound({
    datumTokenizer: Bloodhound.tokenizers.whitespace,
    queryTokenizer: Bloodhound.tokenizers.whitespace,
    local: allPosts.map((p) => p.title)
  });

  $('#ta-search').typeahead({
    hint: true,
    highlight: true,
    minLength: 1
  },
  {
    name: 'bloodhoundPosts',
    source: bloodhoundPosts,
    templates: {
      suggestion: function(s) {
        var fat_post = allPosts.find((p) => p.title === s);
        if (fat_post === undefined) { return; }

        return [
          '<div>',
          '<h4 class="list-group-item-heading">',
          fat_post.title,
          '</h4>',
          '<p>',
          fat_post.blurb,
          '</p>',
          '</div>'
        ].join('\n')
      }
    }
  });


  var onSelect = function(ev, s) {
    var fat_post = allPosts.find((p) => p.title === s);
    if (fat_post === undefined) { return; }
    window.location.href = fat_post.href;
  };

  $('#ta-search').bind('typeahead:select', onSelect);
  $('#ta-search').keypress(function(k) {
    if (k.which !== 13) { return; }
    onSelect(undefined, $('#ta-search').val());
  });
};

$(document).ready(initTypeahead);
