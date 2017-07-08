# davidstancu.me

An attempt at a not shitty personal blog powered by Jekyll and roughly 30 JavaScript packages so I can alternate a background on every page load. Boy, have marquee tags gotten sophisticated these days.

Thanks to [lowmess/hero-patterns](https://github.com/lowmess/hero-patterns) for the nice backgrounds. 

## Building

### Development

`foreman` just watches for JS changes, `jekyll` rebuilds after `webpack` makes a new bundle. It's a website in 2017, so you like doing these things. 

```
npm install -g yarn
yarn i
bundle
bundle exec foreman start
```