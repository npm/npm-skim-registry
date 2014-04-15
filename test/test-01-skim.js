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
    skim     = require('../skim.js'),
    util     = require('util')
    ;

var createTestClient = require('./client');
var skimmer, mclient;

describe('skimming', function()
{
    it('requires an options object', function(done)
    {
        function shouldThrow() { return skim(); }
        shouldThrow.must.throw(TypeError);
        done();
    });

    it('requires a MultiFS client option', function(done)
    {
        function shouldThrow() { return skim({}); }
        shouldThrow.must.throw(/MultiFS/);
        done();
    });

    it('requires that a `seqFile` option be a string', function(done)
    {
        function shouldThrow() { return skim({ client: createTestClient(), seqFile: 20 }); }
        shouldThrow.must.throw(/seqFile/);
        done();
    });

    it('requires a url in opts.db', function(done)
    {
        function shouldThrow() { return skim({ client: createTestClient(), db: 'I am not a url' }); }
        shouldThrow.must.throw(/is required/);
        done();
    });

    it('requires a number if opts.inactivity_ms is provided', function(done)
    {
        function shouldThrow() { return skim(
        {
            client: createTestClient(),
            db: 'http://localhost:15984/registry',
            inactivity_ms: 'foo'
        }); }
        shouldThrow.must.throw(/type number/);
        done();
    });

    it('requires a number if opts.seq is provided', function(done)
    {
        function shouldThrow() { return skim(
        {
            client: createTestClient(),
            db: 'http://localhost:15984/registry',
            seq: 'foo'
        }); }
        shouldThrow.must.throw(/type number/);
        done();
    });

    // TODO note duplication with the semver test
    it('emits expected events on a first sync', { timeout: 20000 }, function(done)
    {
        mclient = createTestClient();
        var expected =
        {
            'put test-package' : 1,
            'attachment test-package/_attachments/test-package-0.0.0.tgz' : 2,
            'sent test-package/doc.json' : 2,
            'sent test-package/_attachments/test-package-0.0.0.tgz' : 1,
            'complete test-package': 1
        };

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
                skimmer.removeListener('put', checkPut);
                skimmer.removeAllListeners('rm');
                skimmer.removeAllListeners('send');
                skimmer.removeAllListeners('delete');
                skimmer.removeAllListeners('attachment');
                skimmer.removeAllListeners('complete');
                skimmer.removeAllListeners('error');
                done();
            }
        }

        var opts =
        {
            debug         : true,
            client        : mclient,
            db            : 'http://localhost:15984/registry',
            registry      : 'http://registry.example.com/',
            seq           : 0,
            seqFile       : './test/couch-tmp/sequence',
            inactivity_ms : 20000
        };

        function checkPut(change) { checkEvent('put %s', change.id); }

        skimmer = skim(opts)
        .once('put', checkPut)
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
            demand(err).be.falsy();
        });
    });

    it('writes files with correct md5 sums', { timeout: 20000 }, function(done)
    {
        var client = createTestClient();
        var target = 'test-package/_attachments/test-package-0.0.0.tgz';
        client.md5(target, function(err, res, data)
        {
            demand(err).be.falsy();
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
            demand(err).be.falsy();
            body.must.be.an.object();
            body.must.not.have.property('_attachments');
            done();
        });
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
            demand(err).be.falsy();
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

        function checkEvent()
        {
            var str = util.format.apply(util, arguments);
            // console.log(str);
            expected2.must.have.property(str);

            expected2[str]--;
            if (expected2[str] === 0)
                delete expected2[str];

            if (Object.keys(expected2).length === 0)
            {
                skimmer.removeListener('put', checkPut);
                skimmer.removeAllListeners('rm');
                skimmer.removeAllListeners('send');
                skimmer.removeAllListeners('delete');
                skimmer.removeAllListeners('attachment');
                skimmer.removeAllListeners('complete');
                skimmer.removeAllListeners('error');
                done();
            }
        }

        function checkPut(change) { checkEvent('put %s', change.id); }

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
            demand(err).be.falsy();
        });

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

                mclient.stat('semver/_attachments/semver-0.1.0.tgz', function(err, response)
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
