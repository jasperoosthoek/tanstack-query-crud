const path = require('path');
const pkg = require('./package.json');

module.exports = {
  mode: 'production',
  entry: './src/index.ts',
  target: 'web',
  externals: {
    react: 'react',
    'react-dom': 'react-dom',
    '@tanstack/react-query': '@tanstack/react-query',
    axios: 'axios',
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: 'ts-loader',
          options: {
            configFile: 'tsconfig.build.json',
          },
        },
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  output: {
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist'),
    library: pkg.name,
    libraryTarget: 'umd',
    globalObject: 'this',
    clean: true,
  },
};
