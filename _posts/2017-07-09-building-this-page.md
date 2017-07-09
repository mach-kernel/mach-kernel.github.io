---
title: Building a new portfolio site (again)
published: true
layout: post
categories: foss
date: 2017-07-09T14:21:37Z
blurb: If anyone other than this reads my page, they'll know that I rarely have time to make blog entries. Every time I do have something neat to write about, I always feel discouraged by the theme that I'm using because of CSS glitches or ridiculously large background textures (although, this is my fault too). I decided that since I'm still technically on vacation up until today, that I might build my own page. 
---

If anyone other than this reads my page, they'll know that I rarely have time to make blog entries. Every time I do have something neat to write about, I always feel discouraged by the theme that I'm using because of CSS glitches or ridiculously large background textures (although, this is my fault too). I decided that since I'm still technically on vacation up until today, that I might build my own page. 

My only two real requirements are: I must use Jekyll or something similar (because of Netlify hosting), and that it must look OK on a phone. Let's begin.


### Configuring Jekyll

There is a lot of implicit magic happening here. I remember older versions of Jekyll attempting to not obscure any of the things that it does, but as of Jekyll 3, your default theme comes bundled in a RubyGem and all you really get to see are some folders where you can drop your posts in. Not the most convenient. 

We are going to want the `jekyll-assets` gem so that we can get Rails-style asset pipelining. It gives us some liquid tags that we can use to import JS and CSS files into our views. 

```ruby
# You'll have to put your plugin under the `jekyll_plugins` group.
group :jekyll_plugins do
  gem "jekyll-feed", "~> 0.6"
  gem 'jekyll-assets'
end
```

Now, go over to your `_config.yml` and make sure that you exclude the `node_modules` directory from your build. Nothing bad will happen if you don't, other than each build taking an excruciating minute.

```yaml
# Build settings
markdown: kramdown
plugins:
  - jekyll-feed
assets:
  compress:
    js: true
  sources:
    - _assets/css
    - _assets/javascripts
sass:
  style: compressed
exclude:
  - node_modules
```

### Living with JavaScript

Apparently, [they've made some interesting steps](https://docs.npmjs.com/how-npm-works/npm3) towards real dependency management, but `npm` still remains non-deterministic. Everybody that I know that doesn't hate their life uses [yarn](https://yarnpkg.com). You should too. It is actually pleasant and deterministic, provided you don't ever fuck up your `yarn.lock` file. 

Invoke `yarn init`, fill out the fields (it's OK if you mess up), and then make sure that you end up with something that looks like this:

```json
{
  "name": "mach-kernel.github.io",
  "version": "1.0.0",
  "description": "dstancu's blag",
  "main": "n/a",
  "repository": "git@github.com:mach-kernel/mach-kernel.github.io.git",
  "author": "David Stancu <dstancu@nyu.edu>",
  "license": "MIT",
  "dependencies": {
    "babel-register": "^6.24.1",
    "bloodhound-js": "^1.2.1",
    "bootstrap": "^3.3.7",
    "bootstrap-loader": "^2.1.0",
    "bootstrap-sass": "^3.3.7",
    "clippyjs": "^0.0.3",
    "css-loader": "^0.28.4",
    "exports-loader": "^0.6.4",
    "file-loader": "^0.11.2",
    "font-awesome": "^4.7.0",
    "font-awesome-loader": "^1.0.2",
    "hero-patterns": "^1.3.3",
    "jquery": "^3.2.1",
    "node-sass": "^4.5.3",
    "resolve-url-loader": "^2.1.0",
    "sass-loader": "^6.0.6",
    "style-loader": "^0.18.2",
    "typeahead.js": "^0.11.1",
    "url-loader": "^0.5.9",
    "webpack": "^3.1.0"
  }
}

```

#### Configuring WebPack

`webpack` is great because it uses a [dependency graph](https://en.wikipedia.org/wiki/Dependency_graph) to create a JS bundles that contain only modules that you are using. The value add is that it is a lot lighter to only include things that you are using to render one page/view than to include a fat bundle everywhere. 

For this site, there is not a lot of JavaScript, but I do want to make my life easier by using some external packages. The hero backgrounds and `typeahead.js` encompass all I ever really want to do to this page. At any rate, this is what my `webpack.config.js` looks like:

```javascript
// It will not work unless you do this, for some reason.
// #4530: https://github.com/webpack/webpack/issues/4530#issuecomment-289446592
const path = require('path');
const webpack = require('webpack');
const jquery = require('jquery');

module.exports = {
    entry: ['bootstrap-loader', __dirname + '/_assets/bundle.js'],
    output: {
      path:  __dirname + '/_assets/javascripts',
      filename: 'webpacked_bundle.js'
    },
    module: {
      loaders: [
        {
          loader: 'babel-loader',
          include: [
            path.resolve(__dirname, '_assets/javascripts'),
          ],
          test: /\.jsx?$/,
        },
        {
          test: /\.(png|woff|woff2|eot|ttf|svg)(\?v=[0-9]\.[0-9]\.[0-9])?$/,
          loader: 'url-loader'
        },
        {
          test: /\.(ttf|eot|svg)(\?[\s\S]+)?$/,
          use: 'file-loader'
        }
      ]
    },
    plugins: [
      new webpack.ProvidePlugin({
          $: "jquery",
          jQuery: "jquery",
          "window.jQuery": "jquery"
      })// ,
        // new webpack.LoaderOptionsPlugin({
        //   debug: true
        // })
    ]
};
```

It is worth noting that this was very irritating to get down correctly. The `loaders` block defines a bunch of different handlers you can configure `webpack` with to support things like CSS. Intuitively meta, you can use some JavaScript to load your other JavaScript (`babel` transpiles ES6, [a beautiful uniform standard everybody agrees on](https://kangax.github.io/compat-table/es6/), into ES5, [a standard slightly more people agree on](http://kangax.github.io/compat-table/es5/). I like the ES6 syntax, and it was easy to set-up!

I'm using `font-awesome` for my glyphicons so I needed to handle some some images and files. At some point, I switched the font I was using and concatenated to it was a version number as a querystring argument which broke one of the regexes above. I think that this is something [easy that really](https://github.com/webpack-contrib/css-loader/issues/38) immediately [clicks with people](https://github.com/webpack-contrib/less-loader/issues/53).

Build your stuff with `yarn webpack`. Watch it with `--watch`.

### Orchestrating the build process

Jekyll automatically watches the directory you spawned it from for changes so that it may rebuild those static assets. Unfortunately, it does not know that `webpack` even exists, so it cannot trigger a rebuild of your JS changes. 

I decided to make a `Procfile` with the following contents:

```yaml
webpack: webpack --devtool source-map --watch
jekyll: bundle exec jekyll s
```

I used a [Ruby foreman](https://github.com/ddollar/foreman) but you can use any package. It doesn't matter as long as you spawn both processes. `webpack` produces a new bundle and writes it to the disk triggering `jekyll` to rebuild. I expected this to be the most breaky part but it has actually been very easy to live with. 

### Make some templates

Since `webpack` can also import CSS, we don't actually need to care about external CSS dependencies in our local Jekyll SASS. Make your styles here. I didn't do anything complex so I had no reason to import from external packages. If you want to do this, disable Jekyll's SASS build step and just have `webpack` bundle it with `sass-loader`. 

In a template:

```html
{% raw %}
<!DOCTYPE html>
<html lang="{{ page.lang | default: site.lang | default: "en" }}">
  ...
  {% js webpacked_bundle %}
  {% css dstancu %}
  ...
</html>
{% endraw %}
```

That should be it. Make some templates and try them out.
