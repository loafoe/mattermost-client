const path = require('path');

module.exports = {
    entry: './src/client.js',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'mattermost-client.js',
        library: {
            name: 'MatterMostClient',
            type: 'umd',
        },
    },
    externals: {
        'events': 'commonjs2 events',
        'https-proxy-agent': 'commonjs2 https-proxy-agent',
        'log': 'commonjs2 log',
        'request': 'commonjs2 request',
        'text-encoding': 'commonjs2 text-encoding',
        'ws': 'commonjs2 ws',
    },
};