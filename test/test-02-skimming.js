'use strict';

var
    lab      = require('lab'),
    describe = lab.describe,
    it       = lab.it,
    before   = lab.before,
    after    = lab.after,
    demand   = require('must'),
    fs       = require('fs'),
    path     = require('path'),
    Request  = require('request'),
    Skimmer  = require('../multiskimmer.js'),
    util     = require('util')
    ;

var createTestClient = require('./client');
var skimmer, mclient;

describe('skimming', function()
{
    function createSkimmer(seq)
    {
        var opts =
        {
            client:        createTestClient(),
            source:        'http://localhost:15984/registry',
            registry:      'http://registry.example.com/',
            sequenceFile:  './test/couch-tmp/sequence',
            inactivity_ms: 20000
        };
        var skimmer = new Skimmer(opts);
        skimmer.on('log', function(msg) { console.log('LOG: ' + msg); });
        return skimmer;
    }

    function verifyExpectedEvents(expected, callback)
    {
        function checkEvent()
        {
            var str = util.format.apply(util, arguments);
            // console.log(str)
            expected.must.have.property(str);

            expected[str]--;
            if (expected[str] === 0)
                delete expected[str];

            if (Object.keys(expected).length === 0)
            {
                skimmer.destroy();
                callback();
            }
        }

        function checkPut(change) { checkEvent('put %s', change.id); }

        skimmer = createSkimmer();

        skimmer
        .on('put', checkPut)
        .on('rm', function(change) { checkEvent('rm %s', change.id); })
        .on('send', function(change, file) { checkEvent('sent %s', file); })
        .on('delete', function(change, file) { checkEvent('delete %s', file); })
        .on('attachment', function(change, file) { checkEvent('attachment %s', file); })
        .on('complete', function(change, results) { checkEvent('complete %s', change.id); })
        .on('error', function(err)
        {
            console.log('woah skimmer threw an error!');
            if (err.stackTrace)
                console.error(err.stackTrace());
            else
                console.error(err);
            demand(err).not.exist();
        });
    }

    it('emits expected events on a first sync', { timeout: 20000 }, function(done)
    {
        var expected =
        {
            'put test-package' : 2,
            'attachment test-package/_attachments/test-package-0.0.0.tgz' : 2,
            'sent test-package/doc.json' : 2,
            'sent test-package/_attachments/test-package-0.0.0.tgz' : 1,
            'complete test-package': 2
        };

        verifyExpectedEvents(expected, done);
        skimmer.start();
    });

    it('writes files with correct md5 sums', { timeout: 20000 }, function(done)
    {
        var client = createTestClient();
        var target = 'test-package/_attachments/test-package-0.0.0.tgz';
        client.md5(target, function(err, res, data)
        {
            demand(err).not.exist();
            res.must.be.a.string();
            res.must.equal('d952d40c43c1f88387999986572ea0e1');
            client.close();
            done();
        });
    });

    it('removes the attachment from couch', { timeout: 10000 }, function(done)
    {
        Request.get('http://localhost:15984/registry/test-package', {json: true}, function(err, response, body)
        {
            demand(err).not.exist();
            body.must.be.an.object();
            body.must.not.have.property('_attachments');
            done();
        });
    });

    it('it does not recopy attachments it already has', function(done)
    {
        // TODO
        // make a second skimmer
        // verify that it only gets 'put test-package' && 'complete test-package' events

        done();
    });

    function publishPackage(callback)
    {
        var testPkg = require('./fixtures/semver.json');
        var tf = path.resolve(__dirname, 'fixtures/test-package-0.0.0.tgz');
        var tgzData = fs.readFileSync(tf, 'base64');
        testPkg._attachments['semver-0.1.0.tgz'].data = tgzData;
        testPkg._attachments['semver-0.1.0.tgz'].stub = false;

        var opts =
        {
            uri:    'http://admin:admin@localhost:15984/registry/semver',
            method: 'PUT',
            json:   testPkg,
        };

        Request(opts, function(err, response, body)
        {
            demand(err).not.exist();
            response.statusCode.must.equal(201);
            callback();
        });
    }

    it('a live publish is handled correctly', { timeout: 20000 }, function(done)
    {
        var client = createTestClient();
        var expected2 =
        {
            'put semver' : 2,
            'attachment semver/_attachments/semver-0.1.0.tgz' : 2,
            'sent semver/doc.json' : 2,
            'sent semver/_attachments/semver-0.1.0.tgz' : 2,
            'complete semver': 2,
        };
        verifyExpectedEvents(expected2, done);
        publishPackage(function()
        {
            // console.log('published a second package');
        });
    });

    it('updated the registry url properly', function(done)
    {
        Request.get('http://admin:admin@localhost:15984/registry/semver', {json: true}, function(err, res, body)
        {
            var tarball = body.versions['0.1.0'].dist.tarball;
            tarball.must.be.a.string();
            tarball.must.match(/registry.example.com/);
            done();
        });
    });

    // TODO is this test a valid exercise of the delete flag feature? What does the feature even mean?
    it('leaves files in place on a registry doc delete (if delete is not set)', function(done)
    {
        Request.get('http://admin:admin@localhost:15984/registry/semver', {json: true}, function(err, res, body)
        {
            var opts =
            {
                uri: 'http://admin:admin@localhost:15984/registry/semver',
                method: 'DELETE',
                json: true,
                qs: { rev: body._rev}
            };
            Request(opts, function(err, res, body)
            {
                demand(err).not.exist();
                res.statusCode.must.equal(200);
                body.must.be.an.object();
                body.must.have.property('ok');
                body.ok.must.be.true();

                var client = createTestClient();
                client.stat('semver/_attachments/semver-0.1.0.tgz', function(err, response)
                {
                    demand(err).not.exist();
                    response.must.be.an.object();
                    response.isFile.must.be.true();
                    done();
                });
            });
        });
    });

    after(function(done)
    {
        skimmer.destroy();
        setTimeout(done, 1000);
    });
});
