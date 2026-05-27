import { run } from './index';

const isDrift = process.argv.includes('--drift');
run({ drift: isDrift });
