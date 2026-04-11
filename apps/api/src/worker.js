import { ensureSyncState, getDatabase } from './db.js';
import { apiConfig } from './config.js';
import { startIndexerLoop } from './indexer.js';

const once = process.argv.includes('--once');

getDatabase();
ensureSyncState('core', apiConfig.contractStartBlocks.core);
ensureSyncState('usernames', apiConfig.contractStartBlocks.usernames);

startIndexerLoop({ once }).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
