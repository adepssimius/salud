const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, '../../dist/api'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      // The migrations have to travel with the bundle: the runtime image copies dist/api only,
      // and drizzle-kit is a devDependency that never survives into it. Without this the
      // container starts against an empty volume and 500s on every query.
      // `input` is workspace-relative; `output` is relative to the output path.
      assets: [
        './src/assets',
        {
          input: 'apps/api/src/db/migrations',
          output: 'assets/migrations',
          glob: '**/*',
        },
      ],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMaps: true,
    }),
  ],
};
