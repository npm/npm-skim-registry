'use strict';

var
    lab      = require('lab'),
    describe = lab.describe,
    it       = lab.it,
    before   = lab.before,
    after    = lab.after,
    demand   = require('must'),
    http     = require('http'),
    parse    = require('parse-json-response'),
    skim     = require('../skim.js'),
    url      = require('url'),
    util     = require('util')
    ;

var createTestClient = require('./client');

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


    it('emits expected events on a first sync', { timeout: 20000 }, function(done)
    {
        var client = createTestClient();
        var skimmer;
        var expected =
        {
            'put test-package' : 1,
            'attachment test-package/_attachments/test-package-0.0.0.tgz' : 1,
            'sent test-package/doc.json' : 1,
            'sent test-package/_attachments/test-package-0.0.0.tgz' : 1,
            'complete test-package': 1
        };

        function checkEvent()
        {
            var str = util.format.apply(util, arguments);
            expected.must.have.property(str);

            expected[str]--;
            if (expected[str] === 0)
                delete expected[str];

            if (Object.keys(expected).length === 0)
            {
                skimmer.destroy();
                done();
            }
        }

        var opts =
        {
            debug         : true,
            client        : client,
            db            : 'http://localhost:15984/registry',
            path          : '.',
            seq           : 0,
            inactivity_ms : 10000
        };

        skimmer = skim(opts)
        .on('put', function(change) { checkEvent('put %s', change.id); })
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
        var opts = url.parse('http://localhost:15984/registry/test-package');
        opts.headers = { 'connection': 'close' };
        http.get(opts, parse(function(err, data, response)
        {
            demand(err).be.falsy();
            data.must.be.an.object();
            data.must.not.have.property('_attachments');
            done();
        }));
    });

    it('removes attachments on unpublish (if delete is set)');
    it('does not remove attachments if delete is not set');
});
