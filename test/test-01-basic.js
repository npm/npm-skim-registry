var client = require('./client.js')
var http = require('http')
var parse = require('parse-json-response')
var skim = require('../skim.js')
var test = require('tap').test
var url = require('url')
var util = require('util');

test('first sync', function(t) {
    var evs =
        [ 'put test-package',
            'attachment test-package/_attachments/test-package-0.0.0.tgz',
            'sent test-package/doc.json',
            'sent test-package/_attachments/test-package-0.0.0.tgz',
            'complete test-package'
        ]

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
        if (!evs[s])
            throw new Error('Unexpected event: ' + s)
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
        path: '.',
        seq: 0,
        inactivity_ms: 10000
    }).on('put', function(change) {
        ev('put %s', change.id);
    }).on('rm', function(change) {
        ev('rm %s', change.id);
    }).on('send', function(change, file) {
        ev('sent %s/%s', change.id, file);
    }).on('delete', function(change, file) {
        ev('delete %s/%s', change.id, file);
    }).on('attachment', function(change, file) {
        ev('attachment %s/%s', change.id, file);
    }).on('complete', function(change, results) {
        ev('complete %s', change.id);
    });
}

test('check destinations', function(t) {
    t.end();
})

test('check doc after skim', function(t) {
    var g = url.parse('http://localhost:15984/registry/test-package');
    g.headers = { 'connection': 'close' };
    http.get(g, parse(function(er, data, res) {
        if (er)
            throw er;
        t.same(data._attachments, undefined);
        t.end();
    }))
});

test('close client', function(t) {
    client.close();
    t.end();
    // TODO okay but this means I have a bug
    process.exit();
});
