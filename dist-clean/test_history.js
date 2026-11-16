#!/usr/bin/env node
/*
 * Legacy entry point. History/report tests now live in test/history.test.js
 * and are run by `npm test` (node --test test/). This shim keeps
 * `node test_history.js` working; it starts its own throwaway server on a free
 * port with a temp data dir, so the old "start server on 3000 first" step is
 * no longer required.
 */
'use strict';
require('./test/history.test.js');
