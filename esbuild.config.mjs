import { build, context } from 'esbuild';

const isWatch = process.argv.includes('--watch');

const commonOptions = {
  bundle: true,
  format: 'iife',
  target: 'chrome100',
  sourcemap: false,
  minify: false,        // Keep readable for debugging
  keepNames: true,
  legalComments: 'none',
};

const configs = [
  {
    ...commonOptions,
    entryPoints: ['src/popup/main.js'],
    outfile: 'popup.js',
  },
  {
    ...commonOptions,
    entryPoints: ['src/content/main.js'],
    outfile: 'onload.js',
  },
];

async function run() {
  if (isWatch) {
    for (const config of configs) {
      const ctx = await context(config);
      await ctx.watch();
      console.log(`Watching ${config.entryPoints[0]}...`);
    }
  } else {
    for (const config of configs) {
      await build(config);
      console.log(`Built ${config.outfile} from ${config.entryPoints[0]}`);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
