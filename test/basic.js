var client = require('./client.js')
var test = require('tap').test
var mpath = '~~/stor/npm-skim-registry-testing'
var skim = require('../skim.js')
var util = require('util');

test('first sync', function(t) {
  var evs =
    [ 'put test-package',
      'attachment test-package/_attachments/test-package-0.0.0.tgz',
      'sent test-package/doc.json',
      'sent test-package/_attachments/test-package-0.0.0.tgz',
      'complete test-package',
      'put test-package',
      'sent test-package/doc.json',
      'complete test-package' ]

  testEvents(evs, t);
});

// Second time, nothing else gets sent
// digests are not trustworthy for our purposes.
test('second sync', function(t) {
  var evs =
    [ 'put test-package',
      'complete test-package' ]

  testEvents(evs, t);
});

function testEvents(evs, t) {
  evs = evs.reduce(function(set, e) {
    set[e] = (set[e] || 0) + 1
    return set;
  }, {})

  function ev() {
    var s = util.format.apply(util, arguments);
    t.ok(evs[s], s);
    evs[s]--;
    if (evs[s] === 0)
      delete evs[s];
    if (Object.keys(evs).length === 0) {
      mc.destroy();
      t.end();
    }
  }

  var mc = skim({
    debug: true,
    client: client,
    db: 'http://localhost:15984/registry',
    path: mpath,
    seq: 0,
    inactivity_ms: 10000
  }).on('put', function(doc) {
    ev('put %s', doc._id);
  }).on('rm', function(doc) {
    ev('rm %s', doc._id);
  }).on('send', function(doc, file) {
    ev('sent %s/%s', doc._id, file.name);
  }).on('delete', function(doc, file) {
    ev('delete %s/%s', doc._id, file.name);
  }).on('attachment', function(doc, file) {
    ev('attachment %s/%s', doc._id, file.name);
  }).on('complete', function(doc, results) {
    ev('complete %s', doc._id);
  });
}
