
// It will not work unless you do this, for some reason.
// #4530: https://github.com/webpack/webpack/issues/4530#issuecomment-289446592
const path = require('path');

module.exports = {
    entry: ['bootstrap-loader', __dirname + '/_assets/webpack_entry.js'],
    output: {
        path:  __dirname + '/_assets/javascripts',
        filename: 'webpack_bundle.js'
    },
    module: {
        loaders: [
            {
              test: /\.(png|woff|woff2|eot|ttf|svg)(\?v=[0-9]\.[0-9]\.[0-9])?$/,
              loader: 'url-loader'
            }
        ]
    }
};