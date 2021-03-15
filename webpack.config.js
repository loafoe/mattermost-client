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
    externals: [
        'events',
        'https-proxy-agent',
        'log',
        'request',
        'text-encoding',
        'ws',
    ],
};