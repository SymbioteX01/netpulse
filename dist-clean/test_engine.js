#!/usr/bin/env node
/*
 * Legacy entry point. The engine test suite now lives in test/engine.test.js
 * and is run by `npm test` (node --test test/). This shim keeps
 * `node test_engine.js` working.
 */
'use strict';
require('./test/engine.test.js');
