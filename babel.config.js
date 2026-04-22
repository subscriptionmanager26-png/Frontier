const path = require('path');

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    /** Metro does not reliably resolve `@/…` from tsconfig paths alone; rewrite at transform time. */
    plugins: [
      [
        'module-resolver',
        {
          root: [path.resolve(__dirname)],
          alias: {
            '@': path.resolve(__dirname),
          },
          extensions: ['.ios.js', '.android.js', '.native.js', '.js', '.jsx', '.json', '.tsx', '.ts'],
        },
      ],
    ],
  };
};
