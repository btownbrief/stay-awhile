#!/usr/bin/env node
/* Verifies that js/answers.js reimplements the question-of-the-week rotation
   exactly as js/app.js does. Run: node scripts/check-rotation.js
   The expected qids were read off the live rotation (weeks 30–34, seed
   20260711, epoch Mon 2026-01-05). If a question batch lands that changes the
   classic pool, these expectations move with it — re-derive from app.js. */
'use strict';

var fs = require('fs');
var path = require('path');

var rotation = require(path.join(__dirname, '..', 'js', 'answers.js'));
var doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'questions.json'), 'utf8'));

var expected = { 30: 'q197', 31: 'q239', 32: 'q048', 33: 'q020', 34: 'q163' };
var failed = false;

Object.keys(expected).forEach(function (week) {
  var got = rotation.qidForWeek(doc.questions, Number(week));
  var ok = got === expected[week];
  if (!ok) failed = true;
  console.log('week ' + week + ': ' + got + (ok ? ' ✓' : ' ✗ expected ' + expected[week]));
});

console.log('current week index: ' + rotation.currentWeekIndex());
console.log(failed ? 'MISMATCH — answers.js rotation drifted from app.js' : 'rotation matches app.js');
process.exit(failed ? 1 : 0);
