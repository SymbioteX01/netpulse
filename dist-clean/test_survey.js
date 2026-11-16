#!/usr/bin/env node
/*
 * Legacy entry point. Survey/export tests now live in test/survey.test.js and
 * are run by `npm test` (node --test test/). This shim keeps
 * `node test_survey.js` working; it starts its own throwaway server on a free
 * port with temp data dirs.
 */
'use strict';
require('./test/survey.test.js');
