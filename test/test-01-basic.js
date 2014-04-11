var
    client = require('./client.js'),
    http   = require('http'),
    parse  = require('parse-json-response'),
    skim   = require('../skim.js'),
    test   = require('tap').test,
    url    = require('url'),
    util   = require('util')
    ;

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
        ev('sent %s', file);
    }).on('delete', function(change, file) {
        ev('delete %s', file);
    }).on('attachment', function(change, file) {
        ev('attachment %s', file);
    }).on('complete', function(change, results) {
        ev('complete %s', change.id);
    }).on('error', function(err) {
        if (err.stackTrace)
            console.error(err.stackTrace());
        else
            console.error(err);
        throw(err);
    });
}

test('check destinations', function(t) {
    // verify that files are where we expect them in the multifs client & their md5s match
    client.md5('test-package/_attachments/test-package-0.0.0.tgz', function(err, res, data) {
        if (err) throw(err);
        console.log(res);
        t.end();
    });
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
});
